#!/usr/bin/env node
// Black-box acceptance of the released SQLite/opaque-token contract. Never accepts a remote URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const SHARED = "synthetic-shared";
const OTHER = "synthetic-other";
const PROJECT = "synthetic-workspace";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function parseArgs(args, env = process.env) {
  let binary = env.LOOMTRACER_BIN;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--binary" || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Usage: node scripts/shared-workspace/run.mjs --binary /path/to/loomtracer (no URL or existing store is accepted)");
    }
    binary = args[++i];
  }
  if (!binary) throw new Error("Provide --binary or LOOMTRACER_BIN; use the repository's pinned release.");
  return { binary };
}

export function childEnvironment(scratch, adminKey, fallbackKey, parent = process.env) {
  // Deliberately omit inherited database URLs, WorkOS, API, model, Slack and capture settings.
  return {
    PATH: parent.PATH || "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TMPDIR: scratch,
    HOME: scratch,
    XDG_CONFIG_HOME: scratch,
    XDG_DATA_HOME: scratch,
    NO_COLOR: "1",
    RUST_LOG: "info",
    LOOMTRACER_API_KEY: fallbackKey,
    LOOMTRACER_ADMIN_KEY: adminKey,
  };
}

export async function runSharedWorkspace(options) {
  for (const key of Object.keys(options)) {
    if (!["binary", "timeoutMs"].includes(key)) throw new Error(`Unsupported harness option: ${key}`);
  }
  const binary = await realpath(resolve(options.binary));
  assert((await stat(binary)).isFile(), "Backend binary must be a file");
  await access(binary, constants.X_OK);
  const timeoutMs = options.timeoutMs ?? 60_000;
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 300_000, "Invalid harness timeout");
  const scratch = await mkdtemp(join(tmpdir(), "loomtracer-shared-workspace-"));
  const adminKey = randomBytes(24).toString("hex");
  const fallbackKey = randomBytes(24).toString("hex");
  const secrets = new Set([adminKey, fallbackKey]);
  const env = childEnvironment(scratch, adminKey, fallbackKey);
  const children = new Set();
  const controller = new AbortController();
  const checks = [];
  let report;
  let failure;
  const redact = text => {
    let safe = String(text);
    for (const secret of secrets) safe = safe.replaceAll(secret, "[redacted]");
    return safe.replace(/lt_tk_[A-Za-z0-9_-]+/g, "[redacted token]");
  };
  const abort = reason => { if (!controller.signal.aborted) controller.abort(new Error(reason)); };
  const onInterrupt = () => abort("Harness interrupted by SIGINT");
  const onTerminate = () => abort("Harness interrupted by SIGTERM");
  const onHangup = () => abort("Harness interrupted by SIGHUP");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  process.on("SIGHUP", onHangup);
  const timer = setTimeout(() => abort("Shared-workspace harness timed out"), timeoutMs);

  function start(args) {
    controller.signal.throwIfAborted();
    const child = spawn(binary, args, { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    child.on("close", () => children.delete(child));
    return child;
  }

  async function command(args, label) {
    const child = start(args);
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-32_768); });
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => { child.kill("SIGTERM"); reject(controller.signal.reason); };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      const closed = new Promise((fulfill, reject) => {
        child.once("error", reject);
        child.once("close", fulfill);
      });
      const code = await Promise.race([closed, aborted]);
      controller.signal.throwIfAborted();
      if (code !== 0) throw new Error(`${label} exited ${code}: ${redact(output)}`);
      return output.trim();
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
    }
  }

  const check = (name, condition, message = name) => { assert(condition, message); checks.push(name); };
  try {
    const binaryVersion = await command(["--version"], "Backend version");
    for (const tenant of [SHARED, OTHER]) {
      await command(["--loomtracer-dir", scratch, "tenant", "create", tenant], "Scratch tenant creation");
    }
    await command(["--actor", "human:fixture-owner@example.test", "--loomtracer-dir", scratch, "--tenant", SHARED, "project", "register", PROJECT], "Scratch project creation");
    await command(["--actor", "human:fixture-owner@example.test", "--loomtracer-dir", scratch, "--tenant", SHARED, "project", "declare-topic", PROJECT, "synthetic-workspace"], "Scratch topic declaration");

    const server = start(["--loomtracer-dir", scratch, "serve", "--bind", "127.0.0.1", "--port", "0"]);
    let logs = "";
    let base;
    let spawnFailure;
    server.on("error", error => { spawnFailure = error; });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => {
      logs = (logs + chunk).slice(-65_536);
      for (const line of logs.replace(/\u001b\[[0-9;]*m/g, "").split("\n")) {
        if (!line.includes("HTTP API listening")) continue;
        const address = line.match(/127\.0\.0\.1:([0-9]+)/);
        if (address && Number(address[1]) > 0) base = `http://127.0.0.1:${address[1]}`;
      }
    });
    while (!base) {
      controller.signal.throwIfAborted();
      if (spawnFailure) throw spawnFailure;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Scratch server exited before readiness: ${redact(logs)}`);
      await delay(25, undefined, { signal: controller.signal });
    }

    async function request(path, { token, method = "GET", body, headers = {}, status = 200 } = {}) {
      controller.signal.throwIfAborted();
      assert(path.startsWith("/") && !path.startsWith("//"), "Only relative fixture API paths are allowed");
      const response = await fetch(`${base}${path}`, {
        method, redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      assert.equal(response.status, status, `${method} ${path}: expected ${status}, got ${response.status}; ${redact(text)}`);
      return { body: text ? JSON.parse(text) : null, headers: response.headers };
    }
    const version = (await request("/v1/version")).body;
    const tenantBody = (tenant, data) => ({ ...data, tenant_id: tenant });
    async function provision(kind, data, tenant = SHARED) {
      const credential = (await request(kind === "human" ? "/v1/users" : "/v1/agent-tokens", {
        token: adminKey, method: "POST", body: tenantBody(tenant, data), status: 201,
      })).body;
      assert.equal(typeof credential.token_secret, "string");
      secrets.add(credential.token_secret);
      return { ...credential, tenant };
    }
    const alice = await provision("human", { email: "alice@example.test", display_name: "Synthetic Alice", role: "member" });
    const bob = await provision("human", { email: "bob@example.test", display_name: "Synthetic Bob", role: "member" });
    const agentA = await provision("agent", { agent_tool: "codex", agent_name: "synthetic-alice" });
    const agentB = await provision("agent", { agent_tool: "codex", agent_name: "synthetic-bob" });
    const outsider = await provision("human", { email: "outside@example.test", display_name: "Synthetic outsider" }, OTHER);
    const expectedActors = ["human:alice@example.test", "human:bob@example.test", "agent:codex:synthetic-alice", "agent:codex:synthetic-bob"];
    const members = [alice, bob, agentA, agentB];
    check("four distinct shared credentials", new Set(members.map(item => item.token_secret)).size === 4);
    for (const [i, member] of members.entries()) {
      const identity = (await request("/v1/whoami", { token: member.token_secret, headers: { "X-Loomtracer-Tenant": OTHER, "X-Loomtracer-Actor": "human:override@example.test" } })).body;
      assert.deepEqual(identity, { tenant_id: SHARED, actor_id: expectedActors[i] });
    }
    checks.push("REST identities and tenant selection are credential-bound");
    await request("/v1/whoami", { status: 401 });
    await request("/v1/users", { method: "POST", body: { email: "forbidden@example.test", display_name: "Forbidden" }, status: 401 });
    await request("/v1/agent-tokens", { token: alice.token_secret, method: "POST", body: { agent_tool: "codex", agent_name: "forbidden" }, status: 401 });
    checks.push("missing credentials and member admin requests are refused");

    const capture = title => ({
      title, rationale: "Entirely synthetic shared-workspace acceptance fixture.", topic_keys: ["synthetic-workspace"],
      options: [{ label: "Use the synthetic fixture", description: "Verify only this disposable ledger." }],
      grounding: [{ kind: "bet" }], binds: { level: "something", statement: "Only this synthetic integration test depends on the fixture." }, undo_cost: { level: "cheap" },
    });
    const humanIds = [];
    for (const [i, member] of [alice, bob].entries()) {
      const result = (await request("/v1/decisions", { token: member.token_secret, method: "POST", body: capture(`Synthetic human ${i + 1} proposal`) })).body;
      assert.equal(typeof result.decision_id, "string");
      humanIds.push(result.decision_id);
    }

    let rpcId = 0;
    async function initialize(member) {
      const result = await request("/mcp", { token: member.token_secret, method: "POST", body: {
        jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-shared-workspace", version: "1" } },
      } });
      assert(!result.body.error, "MCP initialize must succeed");
      const session = result.headers.get("mcp-session-id");
      assert(session, "MCP initialize must issue a session");
      return session;
    }
    async function toolResponse(member, session, name, args) {
      const result = (await request("/mcp", { token: member.token_secret, method: "POST", headers: { "Mcp-Session-Id": session }, body: {
        jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args },
      } })).body;
      assert(!result.error && result.result?.isError === false, `MCP ${name} failed: ${redact(JSON.stringify(result))}`);
      return result.result;
    }
    async function tool(member, session, name, args) {
      return (await toolResponse(member, session, name, args)).structuredContent;
    }
    const sessionA = await initialize(agentA);
    const sessionB = await initialize(agentB);
    const humanSessions = [await initialize(alice), await initialize(bob)];
    const sharedHumanIds = [];
    for (const [i, member] of [alice, bob].entries()) {
      // Under human credentials MCP defaults to a session agent. An explicit actor label is
      // supported, but unlike REST it is caller supplied, not proof of authenticated authorship.
      const result = await tool(member, humanSessions[i], "capture_decision", {
        ...capture(`Synthetic shared human ${i + 1} proposal`), project: PROJECT, actor_id: expectedActors[i],
      });
      assert.equal(typeof result.decision_id, "string");
      sharedHumanIds.push(result.decision_id);
    }
    const agentIds = [];
    for (const [member, session, number] of [[agentA, sessionA, 1], [agentB, sessionB, 2]]) {
      const result = await tool(member, session, "capture_decision", { ...capture(`Synthetic agent ${number} proposal`), project: PROJECT });
      assert.equal(typeof result.decision_id, "string");
      agentIds.push(result.decision_id);
    }
    const allIds = [...humanIds, ...agentIds];
    for (const member of members) {
      for (const id of allIds) {
        const decision = (await request(`/v1/decisions/${encodeURIComponent(id)}`, { token: member.token_secret })).body.data;
        assert.equal(decision.id, id);
        assert.equal(decision.status, "proposed");
      }
      const graph = (await request("/v1/graph", { token: member.token_secret })).body;
      assert(allIds.every(id => graph.decisions.some(decision => decision.id === id)), "Every member must see all shared fixture decisions in the graph");
    }
    checks.push("two humans and two agents capture proposals and read each other's REST records and graph");
    for (const [member, session] of [[agentA, sessionA], [agentB, sessionB]]) {
      for (const [i, id] of allIds.entries()) {
        const context = await tool(member, session, "get_decision_context", { decision_id: id });
        assert.equal(context.data.proposer_id, expectedActors[i]);
      }
    }
    checks.push("independent MCP sessions retrieve all fixture authors and shared-project captures");
    const sharedIds = [...sharedHumanIds, ...agentIds];
    for (const member of members) {
      const graph = (await request(`/v1/graph?project=${PROJECT}`, { token: member.token_secret })).body;
      assert(sharedIds.every(id => graph.decisions.some(decision => decision.id === id)), "All four credentials must see all four shared-project contributions");
    }
    for (const [member, session] of [[agentA, sessionA], [agentB, sessionB]]) {
      for (const [i, id] of sharedIds.entries()) {
        const context = await tool(member, session, "get_decision_context", { decision_id: id });
        assert.equal(context.data.proposer_id, expectedActors[i]);
      }
    }
    checks.push("all four credentials see four shared-project contributions; human MCP labels are explicit assertions");

    for (const id of [...allIds, ...sharedHumanIds]) await request(`/v1/decisions/${encodeURIComponent(id)}`, { token: outsider.token_secret, headers: { "X-Loomtracer-Tenant": SHARED }, status: 404 });
    const otherGraph = (await request("/v1/graph", { token: outsider.token_secret, headers: { "X-Loomtracer-Tenant": SHARED } })).body;
    check("other tenant cannot read shared records even with a forged tenant header", otherGraph.decisions.length === 0);
    const outsiderSession = await initialize(outsider);
    for (const [session, label] of [
      [outsiderSession, "outside tenant's own MCP session"],
      [sessionA, "shared agent's MCP session reused with outside credentials"],
    ]) {
      const result = await toolResponse(outsider, session, "get_decision_context", { decision_id: agentIds[0] });
      // This read is HTTP 200 / isError:false with an empty query result, not HTTP 403.
      // Session identifiers are transport metadata; the bearer still selects the tenant.
      assert.equal(result.structuredContent.data, null, `${label} must expose no decision context`);
      assert.equal(result.structuredContent.result_count, 0, `${label} must return zero records`);
      assert.equal(result.structuredContent.truncated, false, `${label} must be a complete empty result`);
      for (const block of result.content) {
        if (block.type === "text") assert.equal(JSON.parse(block.text).data, null, `${label} must not leak a decision through text content`);
      }
      const serialized = JSON.stringify(result);
      for (const privateValue of [agentIds[0], "Synthetic agent 1 proposal", expectedActors[2]]) {
        assert(!serialized.includes(privateValue), `${label} must not disclose shared record identity, title or actor`);
      }
      checks.push(`${label} cannot read the shared decision (empty MCP result)`);
    }

    const overrideActor = "agent:codex:synthetic-explicit-override";
    const override = await tool(agentA, sessionA, "capture_decision", { ...capture("Synthetic explicit actor override observation"), project: PROJECT, actor_id: overrideActor });
    const overrideContext = await tool(agentB, sessionB, "get_decision_context", { decision_id: override.decision_id });
    check("intentional MCP actor override is observed (not rejected)", overrideContext.data.proposer_id === overrideActor);

    for (const member of [alice, agentA]) {
      await request(`/v1/users/${member.user_id || NIL_UUID}/tokens/${member.token_id}?tenant_id=${SHARED}`, { token: adminKey, method: "DELETE", status: 204 });
      await request("/v1/whoami", { token: member.token_secret, status: 401 });
    }
    await request("/mcp", { token: agentA.token_secret, method: "POST", headers: { "Mcp-Session-Id": sessionA }, body: {
      jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "get_decision_context", arguments: { decision_id: agentIds[0] } },
    }, status: 401 });
    const survivingContext = await tool(agentB, sessionB, "get_decision_context", { decision_id: agentIds[0] });
    assert.equal(survivingContext.data.proposer_id, expectedActors[2]);
    for (const member of [bob, agentB]) await request(`/v1/decisions/${humanIds[0]}`, { token: member.token_secret });
    check("individual human and agent revocation preserves other access and historical records", true);
    report = {
      status: "passed", backend: { binaryVersion, version }, storage: "disposable SQLite", authentication: "opaque tokens",
      checks, fixture: { sharedHumans: 2, sharedAgents: 2, isolatedTenant: true, importedHistory: false },
      limits: ["No Postgres or WorkOS evidence", "No deployed service or real user onboarding tested", "MCP session IDs are reusable transport metadata, not authorization boundaries; tested reads remain bearer-tenant scoped", "MCP actor overrides remain allowed; human shared-project actor labels are explicit assertions, not authenticated authorship", "Separate REST capture checks use personal projects; MCP captures explicitly use the shared project", "No history migration or commitment authority validation"],
    };
  } catch (error) {
    failure = new Error(redact(controller.signal.aborted ? controller.signal.reason?.message : error.message));
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    process.removeListener("SIGHUP", onHangup);
    for (const child of children) child.kill("SIGTERM");
    const stopDeadline = Date.now() + 1_500;
    while (children.size && Date.now() < stopDeadline) await delay(25);
    for (const child of children) child.kill("SIGKILL");
    const killDeadline = Date.now() + 2_000;
    while (children.size && Date.now() < killDeadline) await delay(25);
    if (children.size) {
      failure = new Error("Could not stop scratch child process; refusing to remove its working directory.");
    } else {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  if (failure) throw failure;
  return { ...report, cleanup: "scratch server stopped and directory removed" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runSharedWorkspace(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`Shared-workspace test failed: ${error.message}`);
    process.exitCode = 1;
  }
}
