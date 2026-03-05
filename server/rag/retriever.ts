import { RAG_CONFIG } from "./config.js";
import { embedQuery } from "./embedding-service.js";
import type { VectorIndex } from "./vector-store.js";
import { getChunkById } from "./vector-store.js";
import type { StoredChunk, RetrievedChunk } from "./types.js";

export async function retrieve(
  query: string,
  chunks: StoredChunk[],
  index: VectorIndex,
  apiKey: string,
): Promise<RetrievedChunk[]> {
  if (index.totalChunks === 0) return [];

  const queryVector = await embedQuery(query, apiKey);
  const results = await index.search(queryVector, RAG_CONFIG.topK);

  return results
    .filter((r) => r.score >= RAG_CONFIG.scoreThreshold)
    .map((r) => {
      const chunk = getChunkById(chunks, r.id)!;
      return {
        text: chunk.text,
        metadata: chunk.metadata,
        score: r.score,
      };
    });
}
