import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { childEnvironment, parseArgs, runSharedWorkspace } from "./run.mjs";

test("the runner accepts only a binary, never an endpoint or existing store", async () => {
  assert.deepEqual(parseArgs(["--binary", "/tmp/backend"], {}), { binary: "/tmp/backend" });
  assert.deepEqual(parseArgs([], { LOOMTRACER_BIN: "/tmp/backend" }), { binary: "/tmp/backend" });
  for (const args of [["--url", "https://example.test"], ["--store", "/tmp/existing"], ["--binary"], ["https://example.test"]]) {
    assert.throws(() => parseArgs(args, {}), /Usage/);
  }
  assert.throws(() => parseArgs([], { LOOMTRACER_API_URL: "https://example.test" }), /Provide --binary/);
  await assert.rejects(runSharedWorkspace({ binary: "/tmp/backend", url: "https://example.test" }), /Unsupported harness option/);
});

test("child configuration cannot inherit live services or model credentials", () => {
  const env = childEnvironment("/tmp/synthetic", "ephemeral-admin", "ephemeral-fallback", {
    PATH: "/usr/bin:/bin", HOME: "/private/home", LOOMTRACER_DATABASE_URL: "postgres://live", LOOMTRACER_API_URL: "https://live.example.test",
    LOOMTRACER_API_KEY: "live-secret", LOOMTRACER_ADMIN_KEY: "live-admin", WORKOS_DOMAIN: "https://login.example.test", ANTHROPIC_API_KEY: "model-key", SLACK_BOT_TOKEN: "slack-key",
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "LOOMTRACER_ADMIN_KEY", "LOOMTRACER_API_KEY", "NO_COLOR", "PATH", "RUST_LOG", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].sort());
  assert.equal(env.LOOMTRACER_ADMIN_KEY, "ephemeral-admin");
  assert.equal(env.LOOMTRACER_API_KEY, "ephemeral-fallback");
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TMPDIR"]) assert.equal(env[key], "/tmp/synthetic");
  assert(!JSON.stringify(env).includes("live"));
});

async function fakeBackend(t, phase, action) {
  const root = await mkdtemp(join(tmpdir(), "loomtracer-harness-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "backend.mjs");
  const marker = join(root, "child.json");
  await writeFile(binary, `#!${process.execPath}\nimport { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes(${JSON.stringify(phase)})) {
  writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ cwd: process.cwd(), pid: process.pid }));
  ${action}
} else if (args.includes("--version")) { console.log("synthetic test backend"); }
`, { mode: 0o700 });
  await chmod(binary, 0o700);
  return { binary, marker };
}

async function assertRemoved(marker) {
  const child = JSON.parse(await readFile(marker, "utf8"));
  await assert.rejects(access(child.cwd), { code: "ENOENT" });
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
}

test("server startup failure redacts tokens and removes its own process and directory", async t => {
  const before = process.listenerCount("SIGTERM");
  const fixture = await fakeBackend(t, "serve", 'console.error("lt_tk_synthetic_secret"); process.exit(7);');
  await assert.rejects(runSharedWorkspace({ binary: fixture.binary, timeoutMs: 5_000 }), error => {
    assert.match(error.message, /Scratch server exited/);
    assert.match(error.message, /\[redacted token\]/);
    assert(!error.message.includes("synthetic_secret"));
    return true;
  });
  await assertRemoved(fixture.marker);
  assert.equal(process.listenerCount("SIGTERM"), before);
});

for (const phase of ["--version", "serve"]) {
  test(`timeout kills a stubborn ${phase} child before removing its directory`, async t => {
    const fixture = await fakeBackend(t, phase, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 25);');
    await assert.rejects(runSharedWorkspace({ binary: fixture.binary, timeoutMs: 1_000 }), /timed out/);
    await assertRemoved(fixture.marker);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) test(`${signal} cancels the run and cleans its child`, async t => {
  const fixture = await fakeBackend(t, "serve", 'setInterval(() => {}, 25);');
  const before = process.listenerCount(signal);
  const result = assert.rejects(runSharedWorkspace({ binary: fixture.binary, timeoutMs: 5_000 }), new RegExp(signal));
  const deadline = Date.now() + 3_000;
  while (true) {
    try { await access(fixture.marker); break; } catch {
      assert(Date.now() < deadline, "Fake server did not start");
      await delay(20);
    }
  }
  process.emit(signal);
  await result;
  await assertRemoved(fixture.marker);
  assert.equal(process.listenerCount(signal), before);
});
