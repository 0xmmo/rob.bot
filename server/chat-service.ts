import type { RagPipeline } from "./rag/pipeline.js";
import type { PageImage } from "./rag/context-builder.js";

// ── Config ──────────────────────────────────────────────────────────────────
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.5-122b-a10b";
const SYSTEM_PROMPT =
  "You are a helpful and technical AI assistant. Be concise and direct. Use source citations to support your answers.";

const SEARCH_DOCUMENTS_TOOL = {
  type: "function" as const,
  function: {
    name: "search_documents",
    description:
      "Search indexed technical documents for relevant passages. Use when the user asks about specific details, procedures, or specifications that may be in the uploaded documents.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description:
            "One or more focused search queries to find relevant document passages. Use multiple queries to cover different aspects of the user's question.",
        },
      },
      required: ["queries"],
    },
  },
};

// ── Types ───────────────────────────────────────────────────────────────────
interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamDelta {
  content?: string;
  reasoning?: string;
  tool_calls?: ToolCallDelta[];
}

interface StreamChoice {
  delta: StreamDelta;
  finish_reason?: string | null;
}

interface StreamChunk {
  choices: StreamChoice[];
}

interface ApiMessage {
  role: string;
  content: MessageContent | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface SourceInfo {
  sourcesLine: string | null;
  pageImageCount: number;
}

export interface ChatCallbacks {
  onToolCall: (toolName: string, queries: string[]) => void;
  onRagContext: (info: SourceInfo) => void;
  onReasoningDone: (durationMs: number) => void;
  onToken: (content: string) => void;
  onDone: (fullReply: string, durationMs: number) => void;
  onError: (message: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface CallLLMOpts {
  tools?: boolean;
}

async function callLLM(
  messages: ApiMessage[],
  apiKey: string,
  opts: CallLLMOpts,
  signal?: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    stream: true,
  };

  if (opts.tools) {
    body.tools = [SEARCH_DOCUMENTS_TOOL];
    body.tool_choice = "auto";
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  if (!res.body) throw new Error("No response body");
  return res;
}

interface ConsumeResult {
  content: string;
  reasoning: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason: string | null;
}

async function consumeStream(
  response: Response,
  callbacks: Pick<ChatCallbacks, "onToken" | "onReasoningDone">,
  t0: number,
  signal?: AbortSignal,
): Promise<ConsumeResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let fullReasoning = "";
  let isReasoning = false;
  let reasoningDone = false;
  let finishReason: string | null = null;

  // Accumulate tool call fragments
  const toolCallAccum: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload) as StreamChunk;
          const choice = json.choices[0];
          if (!choice) continue;
          const delta = choice.delta;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (delta.reasoning) {
            if (!isReasoning) isReasoning = true;
            fullReasoning += delta.reasoning;
          }

          if (delta.content) {
            if (isReasoning && !reasoningDone) {
              reasoningDone = true;
              callbacks.onReasoningDone(performance.now() - t0);
            } else if (!reasoningDone) {
              reasoningDone = true;
            }

            fullContent += delta.content;
            callbacks.onToken(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccum.get(tc.index);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              } else {
                toolCallAccum.set(tc.index, {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? "",
                });
              }
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    content: fullContent,
    reasoning: fullReasoning,
    toolCalls: [...toolCallAccum.values()],
    finishReason,
  };
}

// ── Local mode (throttled output) ────────────────────────────────────────────

const LOCAL_WORDS_PER_SEC = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps ChatCallbacks so that onToken output is buffered and dripped at
 * ~LOCAL_WORDS_PER_SEC. The real API is still called; only the delivery
 * to the client is throttled to simulate local-model speeds.
 */
function throttledCallbacks(
  callbacks: ChatCallbacks,
  signal?: AbortSignal,
): { wrapped: ChatCallbacks; flush: () => Promise<void> } {
  let pending = "";       // raw text not yet emitted
  let draining = false;
  let resolveFlush: (() => void) | null = null;
  let done = false;

  const delayMs = 1000 / LOCAL_WORDS_PER_SEC;

  async function drain() {
    if (draining) return;
    draining = true;
    while (pending.length > 0) {
      if (signal?.aborted) break;
      // Grab leading whitespace + next word (or just whitespace)
      const match = pending.match(/^\s*\S+\s?/) ?? pending.match(/^\s+/);
      if (!match) break;
      const word = match[0];
      pending = pending.slice(word.length);
      callbacks.onToken(word);
      await sleep(delayMs);
    }
    draining = false;
    if (done && pending.length === 0 && resolveFlush) {
      resolveFlush();
    }
  }

  const wrapped: ChatCallbacks = {
    ...callbacks,
    onToken(content: string) {
      pending += content;
      drain();
    },
  };

  function flush(): Promise<void> {
    done = true;
    if (pending.length === 0 && !draining) return Promise.resolve();
    return new Promise((resolve) => {
      resolveFlush = resolve;
      drain();
    });
  }

  return { wrapped, flush };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function streamChat(
  userMessage: string,
  history: Message[],
  apiKey: string,
  ragPipeline: RagPipeline | null,
  callbacks: ChatCallbacks,
  signal?: AbortSignal,
  localMode?: boolean,
): Promise<void> {
  // In local mode, wrap callbacks to throttle token delivery to ~20 words/sec
  let activeCallbacks = callbacks;
  let flushThrottle: (() => Promise<void>) | null = null;
  if (localMode) {
    const { wrapped, flush } = throttledCallbacks(callbacks, signal);
    activeCallbacks = wrapped;
    flushThrottle = flush;
  }

  const t0 = performance.now();

  // Build messages: system + history + user
  const messages: ApiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role,
      content: m.content as MessageContent,
    })),
    { role: "user", content: userMessage },
  ];

  // ── Pass 1: LLM call with tool definition ─────────────────────────────
  const hasTools = ragPipeline !== null;
  const response1 = await callLLM(
    messages,
    apiKey,
    { tools: hasTools },
    signal,
  );

  const result1 = await consumeStream(response1, activeCallbacks, t0, signal);

  // ── Fast path: no tool call → content was already streamed ────────────
  if (result1.toolCalls.length === 0) {
    if (flushThrottle) await flushThrottle();
    const durationMs = performance.now() - t0;
    callbacks.onDone(result1.content, durationMs);
    return;
  }

  // ── Tool call path ────────────────────────────────────────────────────
  const toolCall = result1.toolCalls[0]!; // only process first tool call

  let searchQueries: string[];
  try {
    const parsed = JSON.parse(toolCall.arguments) as { queries?: string[] };
    searchQueries =
      Array.isArray(parsed.queries) && parsed.queries.length > 0
        ? parsed.queries
        : [userMessage];
  } catch {
    searchQueries = [userMessage]; // malformed args fallback
  }

  activeCallbacks.onToolCall(toolCall.name, searchQueries);

  // Run RAG pipeline for each query and dedupe results
  let toolResultText: string;
  let ragPageImages: PageImage[] = [];
  let ragSourceInfo: SourceInfo | null = null;

  if (!ragPipeline) {
    toolResultText = "Document search is not available yet.";
  } else {
    try {
      const results = await Promise.all(
        searchQueries.map((q) => ragPipeline.query(q)),
      );

      // Merge and dedupe context suffixes
      const contextParts: string[] = [];
      const seenSources = new Set<string>();
      const sourceLines: string[] = [];
      const seenImageUrls = new Set<string>();

      for (const ragResult of results) {
        if (ragResult.contextSuffix) {
          contextParts.push(ragResult.contextSuffix);
        }
        if (ragResult.sourcesLine && !seenSources.has(ragResult.sourcesLine)) {
          seenSources.add(ragResult.sourcesLine);
          sourceLines.push(ragResult.sourcesLine);
        }
        for (const img of ragResult.pageImages) {
          if (!seenImageUrls.has(img.dataUrl)) {
            seenImageUrls.add(img.dataUrl);
            ragPageImages.push(img);
          }
        }
      }

      if (contextParts.length > 0) {
        toolResultText = contextParts.join("\n\n");
        ragSourceInfo = {
          sourcesLine: sourceLines.join("; ") || null,
          pageImageCount: ragPageImages.length,
        };
      } else {
        toolResultText = "No relevant documents found.";
      }
    } catch {
      toolResultText = "Search encountered an error.";
    }
  }

  if (ragSourceInfo) {
    activeCallbacks.onRagContext(ragSourceInfo);
  }

  // ── Pass 2: LLM call with tool result (no tools → prevents loops) ────
  const pass2Messages: ApiMessage[] = [
    ...messages,
    // Assistant message with tool_call
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        },
      ],
    },
    // Tool result message
    {
      role: "tool",
      content: toolResultText,
      tool_call_id: toolCall.id,
    },
  ];

  // If page images exist, append as multimodal user message
  if (ragPageImages.length > 0) {
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: "Here are the relevant page images from the documents:",
      },
    ];
    for (const img of ragPageImages) {
      contentParts.push({
        type: "image_url",
        image_url: { url: img.dataUrl },
      });
    }
    pass2Messages.push({ role: "user", content: contentParts });
  }

  const response2 = await callLLM(
    pass2Messages,
    apiKey,
    { tools: false },
    signal,
  );

  const result2 = await consumeStream(response2, activeCallbacks, t0, signal);

  if (flushThrottle) await flushThrottle();
  const durationMs = performance.now() - t0;
  callbacks.onDone(result2.content, durationMs);
}
