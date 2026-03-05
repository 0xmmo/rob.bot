import { RAG_CONFIG } from "../config.js";
import type { ExtractedDocument, TextChunk } from "../types.js";
import type { ChunkingStrategy } from "./types.js";

/**
 * Recursively splits text by trying separators in order: \n\n → \n → " " → hard char limit.
 */
function recursiveSplit(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const separators = ["\n\n", "\n", " "];
  for (const sep of separators) {
    const idx = text.lastIndexOf(sep, maxLength);
    if (idx > 0) {
      return [
        text.slice(0, idx),
        ...recursiveSplit(text.slice(idx + sep.length), maxLength),
      ];
    }
  }

  // Hard split at maxLength
  return [
    text.slice(0, maxLength),
    ...recursiveSplit(text.slice(maxLength), maxLength),
  ];
}

export class PageChunker implements ChunkingStrategy {
  readonly name = "page-chunker";

  chunk(document: ExtractedDocument): TextChunk[] {
    const chunks: TextChunk[] = [];

    for (const page of document.pages) {
      const text = page.text.trim();
      if (!text) continue;

      const subChunks = recursiveSplit(text, RAG_CONFIG.maxChunkLength);
      for (const subText of subChunks) {
        if (!subText.trim()) continue;
        chunks.push({
          text: subText.trim(),
          metadata: {
            source: document.source,
            page: page.pageNumber,
            filePath: document.filePath,
          },
        });
      }
    }

    return chunks;
  }
}
