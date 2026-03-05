import type { ChunkingStrategy } from "./types.js";
import { PageChunker } from "./page-chunker.js";

const registry = new Map<string, ChunkingStrategy>();

export function registerChunkingStrategy(strategy: ChunkingStrategy): void {
  registry.set(strategy.name, strategy);
}

export function getChunkingStrategy(name: string): ChunkingStrategy {
  const strategy = registry.get(name);
  if (!strategy) {
    throw new Error(`Unknown chunking strategy: ${name}`);
  }
  return strategy;
}

// Register defaults
registerChunkingStrategy(new PageChunker());

export { PageChunker } from "./page-chunker.js";
export type { ChunkingStrategy } from "./types.js";
