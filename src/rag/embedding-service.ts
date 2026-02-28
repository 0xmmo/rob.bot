import { RAG_CONFIG } from "./config.js";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

async function embedBatch(
  batch: string[],
  apiKey: string,
): Promise<number[][]> {
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RAG_CONFIG.embeddingModel,
      input: batch,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embedding API error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as EmbeddingResponse;
  return json.data.map((item) => item.embedding);
}

export async function embedTexts(
  texts: string[],
  apiKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  // Split into batches
  const batches: { texts: string[]; startIdx: number }[] = [];
  for (let i = 0; i < texts.length; i += RAG_CONFIG.embeddingBatchSize) {
    batches.push({
      texts: texts.slice(i, i + RAG_CONFIG.embeddingBatchSize),
      startIdx: i,
    });
  }

  const results: number[][] = new Array(texts.length);
  let completed = 0;

  // Process batches with concurrency limit
  const queue = [...batches];
  const workers = Array.from(
    { length: Math.min(RAG_CONFIG.embeddingConcurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const batch = queue.shift()!;
        const embeddings = await embedBatch(batch.texts, apiKey);
        for (let j = 0; j < embeddings.length; j++) {
          results[batch.startIdx + j] = embeddings[j]!;
        }
        completed += batch.texts.length;
        onProgress?.(Math.min(completed, texts.length), texts.length);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function embedQuery(
  query: string,
  apiKey: string,
): Promise<number[]> {
  const prefixed = RAG_CONFIG.queryPrefix + query;
  const [embedding] = await embedTexts([prefixed], apiKey);
  return embedding!;
}
