import { Router, type Response } from "express";
import { initRagPipeline, type RagPipeline } from "../rag/pipeline.js";

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface RagState {
  pipeline: RagPipeline | null;
  ready: boolean;
  failed: boolean;
  failureMessage: string | null;
  messages: string[];
  documentCount: number;
  chunkCount: number;
}

export interface RagStatusRouter {
  router: Router;
  broadcast: (event: string, data: unknown) => void;
}

export function createRagStatusRouter(ragState: RagState): RagStatusRouter {
  const router = Router();
  const clients = new Set<Response>();

  function broadcast(event: string, data: unknown): void {
    const msg = sseEvent(event, data);
    for (const client of clients) {
      client.write(msg);
    }
  }

  router.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send current state immediately
    if (ragState.ready) {
      res.write(
        sseEvent("ready", {
          documentCount: ragState.documentCount,
          chunkCount: ragState.chunkCount,
          ready: true,
        }),
      );
      res.end();
      return;
    }

    if (ragState.failed) {
      res.write(
        sseEvent("error", {
          message: ragState.failureMessage,
          ready: false,
        }),
      );
      res.end();
      return;
    }

    // Replay progress so far
    for (const msg of ragState.messages) {
      res.write(sseEvent("progress", { message: msg, ready: false }));
    }

    clients.add(res);
    res.on("close", () => clients.delete(res));
  });

  return { router, broadcast };
}

export function startRagInit(
  apiKey: string,
  ragState: RagState,
  broadcast: (event: string, data: unknown) => void,
): void {
  initRagPipeline(apiKey, (msg) => {
    ragState.messages.push(msg);
    broadcast("progress", { message: msg, ready: false });
  })
    .then((pipeline) => {
      ragState.pipeline = pipeline;
      ragState.ready = true;
      ragState.documentCount = pipeline.documentCount;
      ragState.chunkCount = pipeline.chunkCount;
      broadcast("ready", {
        documentCount: pipeline.documentCount,
        chunkCount: pipeline.chunkCount,
        ready: true,
      });
    })
    .catch((err: unknown) => {
      ragState.failed = true;
      ragState.failureMessage =
        err instanceof Error ? err.message : String(err);
      broadcast("error", {
        message: ragState.failureMessage,
        ready: false,
      });
    });
}
