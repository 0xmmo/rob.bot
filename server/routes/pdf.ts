import { Router } from "express";
import type { RagPipeline } from "../rag/pipeline.js";

interface PdfOpts {
  getRagPipeline: () => RagPipeline | null;
}

export function createPdfRouter({ getRagPipeline }: PdfOpts) {
  const router = Router();

  router.get("/:source", (req, res) => {
    const pipeline = getRagPipeline();
    if (!pipeline) {
      res.status(503).json({ error: "RAG not ready" });
      return;
    }

    const pdfPath = pipeline.getPdfPath(req.params.source!);
    if (!pdfPath) {
      res.status(404).json({ error: "Source not found" });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(pdfPath);
  });

  return router;
}
