import { privateJson } from "@/lib/http";
import { prepareQuestion, questionSchema, validateAnswer } from "@/lib/prototype/chat";
import { askCodex, ChatUnavailable } from "@/lib/prototype/codex";
import { chartReviewTask, completeChartReview, needsChartReview } from "@/lib/prototype/chart-review";
import { desktopChatAvailable } from "@/lib/prototype/chat-access";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 48_000;
let running = 0;

function localRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (
    !desktopChatAvailable(url.host) ||
    !desktopChatAvailable(host ?? url.host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return false;
  // Next can normalize loopback addresses in request.url. Check the browser's actual Host for the origin comparison.
  try {
    const actual = new URL(`${url.protocol}//${host || url.host}`);
    return !origin || new URL(origin).origin === actual.origin;
  } catch {
    return false;
  }
}

async function readBody(request: Request) {
  if (!request.body || Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES)
    throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  if (!localRequest(request))
    return privateJson({ error: "The graph assistant runs on your local computer." }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return privateJson({ error: "Send a JSON question." }, { status: 415 });
  let input;
  try {
    input = questionSchema.parse(await readBody(request));
  } catch {
    return privateJson({ error: "Send a question and a valid timeline position." }, { status: 400 });
  }
  if (running >= 2)
    return privateJson(
      { error: "Codex is answering other questions. Try again shortly." },
      { status: 429 },
    );
  running += 1;
  try {
    const { snapshot, prompt } = prepareQuestion(input);
    const candidate = validateAnswer(await askCodex(prompt, request.signal), snapshot);
    if (!needsChartReview(candidate)) return privateJson(candidate);
    const review = await askCodex(prompt, request.signal, chartReviewTask);
    return privateJson(completeChartReview(review, candidate, snapshot));
  } catch (error) {
    if (error instanceof ChatUnavailable) return privateJson({ error: error.message }, { status: 503 });
    return privateJson(
      { error: "The answer could not be verified against this graph. Try the question again." },
      { status: 502 },
    );
  } finally {
    running -= 1;
  }
}
