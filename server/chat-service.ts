import type { RagPipeline } from "./rag/pipeline.js";
import type { PageImage } from "./rag/context-builder.js";

// ── Config ──────────────────────────────────────────────────────────────────
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.5-122b-a10b";
const SYSTEM_PROMPT =
  "You are a helpful and technical AI assistant. Be concise and direct. Use source citations to support your answers.";

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

interface ApiMessage {
  role: string;
  content: MessageContent;
}

interface StreamDelta {
  content?: string;
  reasoning?: string;
}

interface StreamChunk {
  choices: Array<{ delta: StreamDelta }>;
}

export interface SourceInfo {
  sourcesLine: string | null;
  pageImageCount: number;
}

export interface ChatCallbacks {
  onRagStatus: (message: string) => void;
  onRagContext: (info: SourceInfo) => void;
  onReasoningDone: (durationMs: number) => void;
  onToken: (content: string) => void;
  onDone: (fullReply: string, durationMs: number) => void;
  onError: (message: string) => void;
}

export async function streamChat(
  userMessage: string,
  history: Message[],
  apiKey: string,
  ragPipeline: RagPipeline | null,
  callbacks: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  // RAG: retrieve context for this query
  let ragSystemMessage = SYSTEM_PROMPT;
  let ragPageImages: PageImage[] = [];

  if (ragPipeline) {
    callbacks.onRagStatus("gathering context");
    try {
      const ragResult = await ragPipeline.query(userMessage);
      if (ragResult.contextSuffix) {
        ragSystemMessage = SYSTEM_PROMPT + ragResult.contextSuffix;
        ragPageImages = ragResult.pageImages;
        callbacks.onRagContext({
          sourcesLine: ragResult.sourcesLine,
          pageImageCount: ragPageImages.length,
        });
      }
    } catch {
      // RAG failure is non-fatal — continue without context
    }
  }

  const t0 = performance.now();

  // Build messages with dynamic system prompt (RAG context injected fresh each turn)
  const apiMessages: ApiMessage[] = [
    { role: "system", content: ragSystemMessage },
    ...history.map((m) => ({
      role: m.role,
      content: m.content as MessageContent,
    })),
  ];

  // Build the current user message — multimodal if page images are available
  if (ragPageImages.length > 0) {
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: userMessage }];
    for (const img of ragPageImages) {
      contentParts.push({
        type: "image_url",
        image_url: { url: img.dataUrl },
      });
    }
    apiMessages.push({ role: "user", content: contentParts });
  } else {
    apiMessages.push({ role: "user", content: userMessage });
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: apiMessages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  const body = res.body;
  if (!body) throw new Error("No response body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullReply = "";
  let fullReasoning = "";
  let buffer = "";
  let isReasoning = false;
  let reasoningDone = false;

  try {
    while (true) {
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
          const delta = json.choices[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning) {
            if (!isReasoning) isReasoning = true;
            fullReasoning += delta.reasoning;
          }

          if (delta.content) {
            if (isReasoning && !reasoningDone) {
              reasoningDone = true;
              const reasoningMs = performance.now() - t0;
              callbacks.onReasoningDone(reasoningMs);
            } else if (!reasoningDone) {
              reasoningDone = true;
            }

            fullReply += delta.content;
            callbacks.onToken(delta.content);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const durationMs = performance.now() - t0;
  callbacks.onDone(fullReply, durationMs);
}
