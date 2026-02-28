import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { LocalIndex } from "vectra";
import { RAG_CONFIG } from "./config.js";
import type { DocumentVectors, StoredChunk, ChunkMetadata } from "./types.js";

export interface VectorIndex {
  search(queryVector: number[], k: number): Promise<Array<{ id: number; score: number }>>;
  totalChunks: number;
}

export async function saveDocumentVectors(
  docVectors: DocumentVectors,
  vectorFile: string,
): Promise<void> {
  const filePath = path.join(RAG_CONFIG.vectorsDir, vectorFile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(docVectors));
}

export async function loadDocumentVectors(
  vectorFile: string,
): Promise<DocumentVectors> {
  const filePath = path.join(RAG_CONFIG.vectorsDir, vectorFile);
  const data = await readFile(filePath, "utf-8");
  return JSON.parse(data) as DocumentVectors;
}

export async function buildIndex(allChunks: StoredChunk[]): Promise<VectorIndex> {
  if (allChunks.length === 0) {
    return {
      totalChunks: 0,
      async search() {
        return [];
      },
    };
  }

  // Rebuild vectra index from scratch each startup
  const indexPath = path.join(RAG_CONFIG.cacheDir, "vectra-index");
  await rm(indexPath, { recursive: true, force: true });

  const index = new LocalIndex(indexPath);
  await index.createIndex();

  await index.beginUpdate();
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i]!;
    await index.insertItem({
      id: String(i),
      vector: chunk.vector,
      metadata: { chunkIndex: i },
    });
  }
  await index.endUpdate();

  return {
    totalChunks: allChunks.length,
    async search(queryVector: number[], k: number) {
      const count = Math.min(k, allChunks.length);
      if (count === 0) return [];
      const results = await index.queryItems(queryVector, count);
      return results.map((r) => ({
        id: (r.item.metadata as { chunkIndex: number }).chunkIndex,
        score: r.score,
      }));
    },
  };
}

export function getChunkById(
  chunks: StoredChunk[],
  id: number,
): StoredChunk | undefined {
  return chunks[id];
}
