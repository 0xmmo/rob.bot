/**
 * End-to-end API tests for rob.bot server.
 *
 * Starts the server, tests the health, RAG status SSE, and chat SSE endpoints,
 * then shuts down.
 *
 * Usage: npx tsx test/e2e.ts          (quick mode — skips full LLM streaming)
 *        npx tsx test/e2e.ts --full    (full mode — waits for complete LLM response)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const SERVER_URL = "http://localhost:3000";
const FULL_MODE = process.argv.includes("--full");
let serverProcess: ChildProcess | null = null;
let passed = 0;
let failed = 0;

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function pass(name: string): void {
  console.log(`  \u2705 ${name}`);
  passed++;
}

function fail(name: string, error: string): void {
  console.log(`  \u274C ${name}: ${error}`);
  failed++;
}

// Helper to read SSE events from a fetch response body
async function readSSEEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: { timeoutMs: number; stopOn?: string[] },
): Promise<{ events: Array<{ event: string; data: string }>; timedOut: boolean }> {
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: string }> = [];
  let timedOut = false;
  const stopEvents = opts.stopOn ?? ["done", "error"];

  const timeoutId = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, opts.timeoutMs);

  while (!timedOut) {
    let result: { done: boolean; value?: Uint8Array };
    try {
      result = await reader.read();
    } catch {
      break;
    }

    if (result.done) break;
    if (result.value) {
      buffer += decoder.decode(result.value, { stream: true });
    }

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.trim().split("\n");
      let event = "";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (event && data) events.push({ event, data });
    }

    if (events.some((e) => stopEvents.includes(e.event))) {
      break;
    }
  }

  clearTimeout(timeoutId);
  reader.cancel().catch(() => {});
  return { events, timedOut };
}

// ── Server lifecycle ────────────────────────────────────────────────────────

async function startServer(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    serverProcess = spawn("npx", ["tsx", "server/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 15 seconds"));
    }, 15000);

    serverProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("listening on")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (!text.includes("ExperimentalWarning") && !text.includes("EBADENGINE")) {
        process.stderr.write(`  [server stderr] ${text}`);
      }
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

// ── Test: Health endpoint ───────────────────────────────────────────────────

async function testHealth(): Promise<void> {
  const testName = "GET /api/health";
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    if (!res.ok) {
      fail(testName, `status ${res.status}`);
      return;
    }

    const body = (await res.json()) as {
      status: string;
      rag: { ready: boolean; documentCount: number; chunkCount: number };
    };

    if (body.status !== "ok") {
      fail(testName, `expected status "ok", got "${body.status}"`);
      return;
    }

    if (typeof body.rag !== "object") {
      fail(testName, `expected rag object, got ${typeof body.rag}`);
      return;
    }

    if (typeof body.rag.ready !== "boolean") {
      fail(testName, `expected rag.ready boolean, got ${typeof body.rag.ready}`);
      return;
    }

    pass(`${testName} — status: ok, rag.ready: ${body.rag.ready}`);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: CORS headers ──────────────────────────────────────────────────────

async function testCORS(): Promise<void> {
  const testName = "CORS headers";
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, {
      method: "OPTIONS",
    });

    const allowOrigin = res.headers.get("access-control-allow-origin");
    if (allowOrigin !== "*") {
      fail(testName, `expected *, got "${allowOrigin}"`);
      return;
    }

    pass(testName);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: Chat validation ───────────────────────────────────────────────────

async function testChatValidation(): Promise<void> {
  const testName = "POST /api/chat (missing message)";
  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: [] }),
    });

    if (res.status !== 400) {
      fail(testName, `expected 400, got ${res.status}`);
      return;
    }

    const body = (await res.json()) as { error: string };
    if (!body.error) {
      fail(testName, "expected error field in response");
      return;
    }

    pass(testName);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: Chat empty message ────────────────────────────────────────────────

async function testChatEmptyMessage(): Promise<void> {
  const testName = "POST /api/chat (empty message)";
  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "", history: [] }),
    });

    if (res.status !== 400) {
      fail(testName, `expected 400, got ${res.status}`);
      return;
    }

    pass(testName);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: RAG Status SSE ────────────────────────────────────────────────────

async function testRagStatusSSE(): Promise<void> {
  const testName = "GET /api/rag/status (SSE)";
  try {
    const res = await fetch(`${SERVER_URL}/api/rag/status`);

    const contentType = res.headers.get("content-type");
    if (!contentType?.includes("text/event-stream")) {
      fail(testName, `expected text/event-stream, got "${contentType}"`);
      return;
    }

    const reader = res.body!.getReader();
    const { events } = await readSSEEvents(reader, {
      timeoutMs: 30000,
      stopOn: ["ready", "error"],
    });

    if (events.length === 0) {
      fail(testName, "no SSE events received within 30s");
      return;
    }

    const hasProgress = events.some((e) => e.event === "progress");
    const hasReady = events.some((e) => e.event === "ready");
    const hasError = events.some((e) => e.event === "error");

    if (!hasProgress && !hasReady && !hasError) {
      fail(testName, `unexpected events: ${events.map((e) => e.event).join(", ")}`);
      return;
    }

    // Validate JSON data
    for (const evt of events) {
      try {
        JSON.parse(evt.data);
      } catch {
        fail(testName, `event "${evt.event}" has invalid JSON`);
        return;
      }
    }

    // If ready, validate structure
    if (hasReady) {
      const readyData = JSON.parse(events.find((e) => e.event === "ready")!.data) as {
        documentCount: number;
        chunkCount: number;
        ready: boolean;
      };
      if (typeof readyData.documentCount !== "number" || typeof readyData.chunkCount !== "number") {
        fail(testName, "ready event missing documentCount/chunkCount");
        return;
      }
    }

    pass(`${testName} — ${events.length} event(s): ${events.map((e) => e.event).join(", ")}`);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: Chat SSE format ───────────────────────────────────────────────────

async function testChatSSEFormat(): Promise<void> {
  const testName = "POST /api/chat (SSE format)";
  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Hello",
        history: [],
      }),
    });

    const contentType = res.headers.get("content-type");
    if (!contentType?.includes("text/event-stream")) {
      fail(testName, `expected text/event-stream, got "${contentType}"`);
      return;
    }

    // Read just the first chunk to verify SSE format
    const reader = res.body!.getReader();
    const { done, value } = await reader.read();
    reader.cancel().catch(() => {});

    if (done || !value) {
      fail(testName, "no data received");
      return;
    }

    const text = new TextDecoder().decode(value);
    if (!text.includes("event:") || !text.includes("data:")) {
      fail(testName, `response not in SSE format: "${text.slice(0, 100)}"`);
      return;
    }

    // Parse first event(s) — should have valid JSON data
    const parts = text.split("\n\n").filter((p) => p.trim());
    for (const part of parts) {
      const lines = part.trim().split("\n");
      let data = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (data) {
        try {
          JSON.parse(data);
        } catch {
          fail(testName, `invalid JSON in SSE data: "${data}"`);
          return;
        }
      }
    }

    pass(testName);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: Chat with history ─────────────────────────────────────────────────

async function testChatWithHistory(): Promise<void> {
  const testName = "POST /api/chat (with history)";
  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "What did I just say?",
        history: [
          { role: "user", content: "My name is TestBot" },
          { role: "assistant", content: "Hello TestBot!" },
        ],
      }),
    });

    const contentType = res.headers.get("content-type");
    if (!contentType?.includes("text/event-stream")) {
      fail(testName, `expected text/event-stream, got "${contentType}"`);
      return;
    }

    const reader = res.body!.getReader();
    const { done, value } = await reader.read();
    reader.cancel().catch(() => {});

    if (done || !value) {
      fail(testName, "no data received");
      return;
    }

    const text = new TextDecoder().decode(value);
    if (!text.includes("event:") && !text.includes("data:")) {
      fail(testName, "response is not SSE format");
      return;
    }

    pass(testName);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Test: Full Chat Streaming (long) ────────────────────────────────────────

async function testFullChatStreaming(): Promise<void> {
  const testName = "POST /api/chat (full streaming)";
  log("Waiting for full LLM response (may take 3-5 minutes with RAG images)...");
  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Respond with exactly one word: hello",
        history: [],
      }),
    });

    const reader = res.body!.getReader();
    const { events, timedOut } = await readSSEEvents(reader, {
      timeoutMs: 300000, // 5 minutes
    });

    if (timedOut) {
      fail(testName, `timed out after 5 minutes. Got ${events.length} events: ${events.map((e) => e.event).join(", ")}`);
      return;
    }

    if (events.length === 0) {
      fail(testName, "no events received");
      return;
    }

    const eventTypes = events.map((e) => e.event);
    const hasError = eventTypes.includes("error");
    const hasToken = eventTypes.includes("token");
    const hasDone = eventTypes.includes("done");
    const hasToolCall = eventTypes.includes("tool-call");

    if (hasError) {
      const errorData = JSON.parse(events.find((e) => e.event === "error")!.data) as { message: string };
      fail(testName, `server error: ${errorData.message}`);
      return;
    }

    if (!hasToken) {
      fail(testName, `no token events. Got: ${eventTypes.join(", ")}`);
      return;
    }

    if (!hasDone) {
      fail(testName, "no done event");
      return;
    }

    // If tool-call event exists, validate its structure
    if (hasToolCall) {
      const toolCallData = JSON.parse(events.find((e) => e.event === "tool-call")!.data) as { tool: string; queries: string[] };
      if (!toolCallData.tool || !Array.isArray(toolCallData.queries) || toolCallData.queries.length === 0) {
        fail(testName, "tool-call event missing tool or queries");
        return;
      }
      log(`  (model used tool: ${toolCallData.tool}, queries: ${JSON.stringify(toolCallData.queries.map((q: string) => q.slice(0, 50)))})`);
    }

    const doneEvent = events.find((e) => e.event === "done")!;
    const doneData = JSON.parse(doneEvent.data) as { fullReply: string; durationMs: number };

    if (typeof doneData.fullReply !== "string" || !doneData.fullReply) {
      fail(testName, "done event missing fullReply");
      return;
    }

    // Verify token concatenation matches fullReply
    const tokenContent = events
      .filter((e) => e.event === "token")
      .map((e) => (JSON.parse(e.data) as { content: string }).content)
      .join("");

    if (tokenContent !== doneData.fullReply) {
      fail(testName, `token concat mismatch: "${tokenContent.slice(0, 50)}" vs "${doneData.fullReply.slice(0, 50)}"`);
      return;
    }

    const secs = (doneData.durationMs / 1000).toFixed(1);
    const flow = hasToolCall ? "tool-call" : "direct";
    pass(`${testName} — ${flow} flow, ${events.length} events, ${secs}s, reply: "${doneData.fullReply.slice(0, 50)}"`);
  } catch (err) {
    fail(testName, String(err));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n\u{1F9EA} rob.bot E2E API Tests\n");
  if (FULL_MODE) {
    log("Running in FULL mode (includes LLM streaming test)\n");
  }
  console.log("Starting server...");

  try {
    await startServer();
    log("Server started\n");

    await sleep(500);

    console.log("\u2500\u2500 API tests \u2500\u2500");
    await testHealth();
    await testCORS();
    await testChatValidation();
    await testChatEmptyMessage();

    console.log("\n\u2500\u2500 SSE tests \u2500\u2500");
    await testRagStatusSSE();
    await testChatSSEFormat();
    await testChatWithHistory();

    if (FULL_MODE) {
      console.log("\n\u2500\u2500 Full streaming test \u2500\u2500");
      await testFullChatStreaming();
    } else {
      log("\n  (Skipping full LLM streaming test — run with --full to include)");
    }

    console.log(
      `\n\u{1F4CA} Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`,
    );
  } catch (err) {
    console.error(`\n\u{1F4A5} Fatal error: ${err}\n`);
    failed++;
  } finally {
    stopServer();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
