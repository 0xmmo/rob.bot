import { Router } from "express";
import { streamChat, type ChatCallbacks } from "../chat-service.js";
import type { RagPipeline } from "../rag/pipeline.js";

interface ChatRequestBody {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createChatRouter(deps: {
  getApiKey: () => string;
  getRagPipeline: () => RagPipeline | null;
}): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { message, history } = req.body as ChatRequestBody;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const abortController = new AbortController();
    res.on("close", () => abortController.abort());

    const callbacks: ChatCallbacks = {
      onRagStatus(statusMessage) {
        res.write(sseEvent("rag-status", { message: statusMessage }));
      },
      onRagContext(info) {
        res.write(sseEvent("rag-context", info));
      },
      onReasoningDone(durationMs) {
        res.write(sseEvent("reasoning-done", { durationMs }));
      },
      onToken(content) {
        res.write(sseEvent("token", { content }));
      },
      onDone(fullReply, durationMs) {
        res.write(sseEvent("done", { fullReply, durationMs }));
        res.end();
      },
      onError(errorMessage) {
        res.write(sseEvent("error", { message: errorMessage }));
        res.end();
      },
    };

    const safeHistory = Array.isArray(history) ? history : [];

    streamChat(
      message,
      safeHistory,
      deps.getApiKey(),
      deps.getRagPipeline(),
      callbacks,
      abortController.signal,
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chat] error:", msg);
      if (!abortController.signal.aborted) {
        callbacks.onError(msg);
      }
    });
  });

  return router;
}
