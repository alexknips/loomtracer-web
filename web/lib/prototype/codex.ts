import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { graphInstructions, outputSchema } from "./chat";

export class ChatUnavailable extends Error {}

const macBinary =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const disabledFeatures = [
  "shell_tool",
  "apps",
  "plugins",
  "hooks",
  "memories",
  "multi_agent",
  "goals",
  "view_image",
  "image_generation",
  "browser_use",
  "computer_use",
  "in_app_browser",
  "code_mode",
  "code_mode_host",
  "skill_search",
  "workspace_dependencies",
];
const envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  params: z
    .object({
      turn: z.object({ status: z.string() }).optional(),
      item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
    })
    .optional(),
});
type Message = z.infer<typeof envelope>;
const connectorPage = z.object({
  data: z.array(z.object({ name: z.string(), tools: z.record(z.string(), z.unknown()) })),
  nextCursor: z.string().nullable(),
});
const threadResult = z.object({
  thread: z.object({ id: z.string(), ephemeral: z.literal(true) }),
  instructionSources: z.array(z.string()),
  runtimeWorkspaceRoots: z.array(z.string()).length(0),
  approvalPolicy: z.literal("never"),
  modelProvider: z.literal("openai"),
  sandbox: z.object({ type: z.literal("readOnly"), networkAccess: z.literal(false) }),
});

export function sessionIsIsolated(instructionSources: string[], configHome: string) {
  return instructionSources.every(
    (source) =>
      dirname(resolve(source)) === resolve(configHome) &&
      ["AGENTS.md", "AGENTS.override.md"].includes(basename(source)),
  );
}

export function codexArgs(runtimeDir: string) {
  const settings = [
    'web_search="disabled"',
    "apps._default.enabled=false",
    "project_doc_max_bytes=0",
    "skills.include_instructions=false",
    'approval_policy="never"',
    'sandbox_mode="read-only"',
    'forced_login_method="chatgpt"',
    'model_provider="openai"',
    `sqlite_home=${JSON.stringify(join(runtimeDir, "state"))}`,
    `log_dir=${JSON.stringify(join(runtimeDir, "logs"))}`,
  ];
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...disabledFeatures.flatMap((name) => ["--disable", name]),
    ...settings.flatMap((setting) => ["-c", setting]),
  ];
}

// Codex manages its own saved sign-in. No API key, application secrets or project environment is forwarded.
function childEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of [
    "HOME",
    "PATH",
    "SystemRoot",
    "LOCALAPPDATA",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "USER",
    "LOGNAME",
    "CODEX_HOME",
  ]) {
    if (process.env[name]) result[name] = process.env[name];
  }
  return result;
}

type ModelTask = {
  instructions: string;
  schema: z.core.JSONSchema.JSONSchema;
  effort?: "low" | "medium";
};

export async function askCodex(
  prompt: string,
  signal: AbortSignal,
  task: ModelTask = { instructions: graphInstructions, schema: outputSchema },
): Promise<string> {
  if (signal.aborted) throw new ChatUnavailable("The question was canceled.");
  const runtimeDir = await mkdtemp(join(tmpdir(), "loomtracer-graph-"));
  try {
    const cwd = join(runtimeDir, "workspace");
    await mkdir(cwd);
    return await runSession(runtimeDir, cwd, prompt, signal, task);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

async function runSession(
  runtimeDir: string,
  cwd: string,
  prompt: string,
  signal: AbortSignal,
  task: ModelTask,
) {
  const binary =
    process.env.LOOMTRACER_CODEX_BIN ||
    (process.platform === "darwin" && existsSync(macBinary) ? macBinary : "codex");
  const child = spawn(binary, codexArgs(runtimeDir), {
    cwd,
    env: childEnvironment(),
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  let failure: ChatUnavailable | undefined;
  const stop = (message: string) => {
    failure = new ChatUnavailable(message);
    child.kill("SIGKILL");
  };
  const onAbort = () => stop("The question was canceled.");
  const timeout = setTimeout(
    () => stop("Codex took too long to answer. Try the question again."),
    90_000,
  );
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  child.on("error", () => stop("Codex could not start. Open the signed-in Codex app and try again."));
  child.stdin.on("error", () => stop("The local Codex connection closed. Try again."));
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const messages = lines[Symbol.asyncIterator]();
  let sequence = 0;
  let finalText = "";
  let completed = false;

  async function nextMessage(): Promise<Message> {
    const { done, value } = await messages.next();
    if (done)
      throw (
        failure ??
        new ChatUnavailable(
          "Codex is unavailable. Check that the local Codex app is signed in and try again.",
        )
      );
    if (value.length > 1_000_000) throw new ChatUnavailable("Codex returned an oversized response.");
    const message = envelope.parse(JSON.parse(value));
    if (message.method && message.id !== undefined)
      throw new ChatUnavailable("Codex requested a capability outside the graph viewer.");
    if (message.method === "item/started" || message.method === "item/completed") {
      const item = message.params?.item;
      if (item && !["userMessage", "agentMessage", "reasoning"].includes(item.type))
        throw new ChatUnavailable("The graph assistant attempted to use an unavailable capability.");
      if (message.method === "item/completed" && item?.type === "agentMessage" && item.text)
        finalText = item.text;
    }
    if (message.method === "turn/completed") {
      if (message.params?.turn?.status !== "completed")
        throw new ChatUnavailable(
          "Codex could not complete the answer. Check your Codex connection and try again.",
        );
      completed = true;
    }
    return message;
  }
  function write(message: unknown) {
    if (failure) throw failure;
    child.stdin.write(JSON.stringify(message) + "\n");
  }
  async function request(method: string, params: unknown) {
    const id = ++sequence;
    write({ id, method, params });
    while (true) {
      const message = await nextMessage();
      if (message.id !== id) continue;
      if (message.error)
        throw new ChatUnavailable(
          "The installed Codex could not open an isolated graph session. Update or sign in to Codex and try again.",
        );
      return message.result;
    }
  }
  async function connectors(threadId?: string) {
    const servers: z.infer<typeof connectorPage>["data"] = [];
    let cursor: string | null = null;
    do {
      const raw = await request("mcpServerStatus/list", {
        threadId,
        cursor,
        limit: 100,
        detail: "toolsAndAuthOnly",
      });
      const page = connectorPage.parse(raw);
      servers.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return servers;
  }

  try {
    await request("initialize", {
      clientInfo: { name: "loomtracer_prototype", version: "1" },
      capabilities: { experimentalApi: true },
    });
    write({ method: "initialized" });
    const account = await request("account/read", { refreshToken: false });
    if (!z.object({ account: z.object({ type: z.literal("chatgpt") }) }).safeParse(account).success) {
      throw new ChatUnavailable(
        "Sign in to the local Codex app with ChatGPT, then ask your question again.",
      );
    }
    const configured = await connectors();
    const config = Object.fromEntries(
      configured.map((server) => [`mcp_servers.${server.name}.enabled`, false]),
    );
    const rawThread = await request("thread/start", {
      cwd,
      config,
      approvalPolicy: "never",
      sandbox: "read-only",
      modelProvider: "openai",
      ephemeral: true,
      environments: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      baseInstructions: "You are a decision graph analyst.",
      developerInstructions: task.instructions,
    });
    const isolated = threadResult.safeParse(rawThread);
    const configHome = process.env.CODEX_HOME || join(homedir(), ".codex");
    if (!isolated.success || !sessionIsIsolated(isolated.data.instructionSources, configHome)) {
      throw new ChatUnavailable("Codex could not isolate the graph from workspace files.");
    }
    const threadId = isolated.data.thread.id;
    if ((await connectors(threadId)).some((server) => Object.keys(server.tools).length > 0)) {
      throw new ChatUnavailable("Codex could not isolate the graph from connected tools.");
    }
    await request("turn/start", {
      threadId,
      environments: [],
      effort: task.effort ?? "low",
      outputSchema: task.schema,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    });
    while (!completed) await nextMessage();
    return finalText;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    lines.close();
    child.stdin.end();
    // Ending the stdio session lets Codex release the thread and its child processes.
    const forceExit = setTimeout(() => child.kill("SIGKILL"), 1200);
    try {
      await closed;
    } finally {
      clearTimeout(forceExit);
    }
  }
}
