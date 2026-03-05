import path from "node:path";

export const RAG_CONFIG = {
  dataDir: path.resolve("data"),
  cacheDir: path.resolve(".rag-cache"),
  vectorsDir: path.resolve(".rag-cache/vectors"),
  imagesDir: path.resolve(".rag-cache/images"),
  manifestPath: path.resolve(".rag-cache/manifest.json"),

  embeddingModel: "qwen/qwen3-embedding-8b",
  embeddingDimensions: 4096,
  embeddingBatchSize: 20,
  embeddingConcurrency: 5,

  queryPrefix: "Instruct: Retrieve relevant document passages\nQuery: ",

  topK: 5,
  scoreThreshold: 0.3,

  maxChunkLength: 2000,
  chunkOverlap: 100,

  defaultChunkingStrategy: "page-chunker",

  renderScale: 1.5,
  renderConcurrency: 3,
  maxPageImages: 4,
} as const;
