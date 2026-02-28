import type { ExtractedDocument, TextChunk } from "../types.js";

export interface ChunkingStrategy {
  readonly name: string;
  chunk(document: ExtractedDocument): TextChunk[];
}
