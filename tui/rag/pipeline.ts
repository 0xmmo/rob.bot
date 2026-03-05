import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { RAG_CONFIG } from "./config.js";
import { extractPdf } from "./pdf-extractor.js";
import { getChunkingStrategy } from "./chunking/index.js";
import { embedTexts } from "./embedding-service.js";
import {
  saveDocumentVectors,
  loadDocumentVectors,
  buildIndex,
  type VectorIndex,
} from "./vector-store.js";
import { scanFiles, updateManifest, cleanupDeleted } from "./file-scanner.js";
import { retrieve } from "./retriever.js";
import {
  buildContext,
  formatSourcesForUI,
  loadPageImages,
  type RagContext,
  type PageImage,
} from "./context-builder.js";
import { renderPdfPages } from "./page-renderer.js";
import type { Manifest, StoredChunk } from "./types.js";

export interface RagPipeline {
  query(userMessage: string): Promise<{
    contextSuffix: string | null;
    sourcesLine: string | null;
    pageImages: PageImage[];
  }>;
  documentCount: number;
  chunkCount: number;
}

export async function initRagPipeline(
  apiKey: string,
  log: (msg: string) => void,
): Promise<RagPipeline> {
  const strategyName = RAG_CONFIG.defaultChunkingStrategy;
  const strategy = getChunkingStrategy(strategyName);

  log("RAG: scanning data/ for PDFs...");
  const { result: scanResult, manifest } = await scanFiles(strategyName);

  // Cleanup deleted files
  if (scanResult.deleted.length > 0) {
    log(`RAG: cleaning up ${scanResult.deleted.length} deleted file(s)`);
    await cleanupDeleted(manifest, scanResult.deleted);
  }

  // Process new/changed files
  if (scanResult.newOrChanged.length > 0) {
    log(`RAG: processing ${scanResult.newOrChanged.length} new/changed file(s)`);
  }

  for (const filePath of scanResult.newOrChanged) {
    const fileName = filePath.split("/").pop()!;
    log(`RAG: extracting ${fileName}...`);
    const doc = await extractPdf(filePath);

    log(`RAG: chunking ${fileName} (${doc.pages.length} pages)...`);
    const chunks = strategy.chunk(doc);

    if (chunks.length === 0) {
      log(`RAG: ${fileName} produced no chunks, skipping`);
      continue;
    }

    log(`RAG: embedding ${fileName} (${chunks.length} chunks)...`);
    const texts = chunks.map((c) => c.text);
    const vectors = await embedTexts(texts, apiKey, (done, total) => {
      log(`RAG: embedding ${fileName}: ${done}/${total}`);
    });

    const storedChunks: StoredChunk[] = chunks.map((chunk, i) => ({
      text: chunk.text,
      vector: vectors[i]!,
      metadata: chunk.metadata,
    }));

    const buffer = await readFile(filePath);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const hashPrefix = hash.slice(0, 16);
    const vectorFile = `${hashPrefix}.json`;

    await saveDocumentVectors(
      { source: doc.source, filePath: doc.filePath, chunks: storedChunks },
      vectorFile,
    );

    log(`RAG: rendering page images for ${fileName}...`);
    await renderPdfPages(filePath, hashPrefix, (done, total) => {
      log(`RAG: rendering ${fileName}: ${done}/${total} pages`);
    });

    const fileStat = await stat(filePath);
    await updateManifest(manifest, filePath, {
      hash,
      chunkCount: storedChunks.length,
      vectorFile,
      embeddingModel: RAG_CONFIG.embeddingModel,
      chunkingStrategy: strategyName,
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      imageHashPrefix: hashPrefix,
    });

    log(`RAG: ${fileName} done (${storedChunks.length} chunks)`);
  }

  if (scanResult.unchanged.length > 0) {
    log(`RAG: ${scanResult.unchanged.length} file(s) cached, skipping`);
  }

  // Migrate existing entries missing imageHashPrefix
  for (const [filePath, entry] of Object.entries(manifest)) {
    if (!entry.imageHashPrefix) {
      const hashPrefix = entry.vectorFile.replace(/\.json$/, "");
      entry.imageHashPrefix = hashPrefix;
      const fileName = filePath.split("/").pop()!;
      log(`RAG: rendering page images for ${fileName} (migration)...`);
      try {
        await renderPdfPages(filePath, hashPrefix, (done, total) => {
          log(`RAG: rendering ${fileName}: ${done}/${total} pages`);
        });
      } catch {
        log(`RAG: failed to render images for ${fileName}, skipping`);
      }
      await updateManifest(manifest, filePath, entry);
    }
  }

  // Load all cached vectors and build combined index
  const allChunks: StoredChunk[] = [];
  let documentCount = 0;

  for (const entry of Object.values(manifest)) {
    try {
      const docVectors = await loadDocumentVectors(entry.vectorFile);
      allChunks.push(...docVectors.chunks);
      documentCount++;
    } catch {
      // Skip corrupted cache entries
    }
  }

  const indexData = await buildIndex(allChunks);
  const totalDocuments = documentCount;

  log(
    `RAG ready: ${totalDocuments} document(s), ${allChunks.length} chunks`,
  );

  return {
    documentCount: totalDocuments,
    chunkCount: allChunks.length,
    async query(userMessage: string) {
      if (allChunks.length === 0) {
        return { contextSuffix: null, sourcesLine: null, pageImages: [] };
      }

      const retrieved = await retrieve(userMessage, allChunks, indexData, apiKey);
      if (retrieved.length === 0) {
        return { contextSuffix: null, sourcesLine: null, pageImages: [] };
      }

      const context = buildContext(retrieved);
      if (!context) {
        return { contextSuffix: null, sourcesLine: null, pageImages: [] };
      }

      const pageImages = await loadPageImages(context.sources, manifest);
      const sourcesLine = formatSourcesForUI(context.sources);
      return {
        contextSuffix: context.systemSuffix,
        sourcesLine,
        pageImages,
      };
    },
  };
}
