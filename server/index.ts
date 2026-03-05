import "dotenv/config";
import { join, resolve } from "node:path";
import express from "express";
import cors from "cors";
import { createChatRouter } from "./routes/chat.js";
import {
  createRagStatusRouter,
  startRagInit,
  type RagState,
} from "./routes/rag-status.js";

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error(
    "Error: OPENROUTER_API_KEY environment variable is required.",
  );
  console.error("  export OPENROUTER_API_KEY=your-key");
  process.exit(1);
}

// ── RAG State ───────────────────────────────────────────────────────────────
const ragState: RagState = {
  pipeline: null,
  ready: false,
  failed: false,
  failureMessage: null,
  messages: [],
  documentCount: 0,
  chunkCount: 0,
};

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
const chatRouter = createChatRouter({
  getApiKey: () => apiKey,
  getRagPipeline: () => ragState.pipeline,
});

const { router: ragStatusRouter, broadcast: ragBroadcast } =
  createRagStatusRouter(ragState);

app.use("/api/chat", chatRouter);
app.use("/api/rag/status", ragStatusRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    rag: {
      ready: ragState.ready,
      documentCount: ragState.documentCount,
      chunkCount: ragState.chunkCount,
    },
  });
});

// ── Production: Serve Client Build ──────────────────────────────────────────
if (process.env["NODE_ENV"] === "production") {
  const clientDist = resolve("client", "dist");
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for all non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });
}

// ── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`rob.bot server listening on http://localhost:${PORT}`);
});

// ── RAG Initialization (non-blocking) ───────────────────────────────────────
startRagInit(apiKey, ragState, ragBroadcast);
