import type { Manifest, RetrievedChunk } from "./types.js";
import { loadPageImageAsDataUrl } from "./page-renderer.js";
import { RAG_CONFIG } from "./config.js";

export interface RagContext {
  systemSuffix: string;
  sources: SourceRef[];
}

export interface SourceRef {
  source: string;
  pages: number[];
  filePath: string;
}

export function buildContext(chunks: RetrievedChunk[]): RagContext | null {
  if (chunks.length === 0) return null;

  const contextParts = chunks.map((chunk) => {
    const citation = `[Source: ${chunk.metadata.source}, Page ${chunk.metadata.page}]`;
    return `${citation}\n${chunk.text}`;
  });

  const systemSuffix =
    "\n\n--- Retrieved Context ---\n" +
    "Use the following document excerpts to answer the user's question. " +
    "Cite your sources using the [Source: file, Page N] labels when referencing specific information.\n\n" +
    contextParts.join("\n\n");

  // Deduplicate sources and collect pages
  const sourceMap = new Map<string, { pages: Set<number>; filePath: string }>();
  for (const chunk of chunks) {
    const key = chunk.metadata.source;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, { pages: new Set(), filePath: chunk.metadata.filePath });
    }
    sourceMap.get(key)!.pages.add(chunk.metadata.page);
  }

  const sources: SourceRef[] = [];
  for (const [source, { pages, filePath }] of sourceMap) {
    sources.push({
      source,
      pages: [...pages].sort((a, b) => a - b),
      filePath,
    });
  }

  return { systemSuffix, sources };
}

export interface PageImage {
  source: string;
  page: number;
  dataUrl: string;
}

export async function loadPageImages(
  sources: SourceRef[],
  manifest: Manifest,
): Promise<PageImage[]> {
  const images: PageImage[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    const entry = manifest[src.filePath];
    if (!entry?.imageHashPrefix) continue;

    for (const page of src.pages) {
      const key = `${src.filePath}:${page}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (images.length >= RAG_CONFIG.maxPageImages) break;

      const dataUrl = await loadPageImageAsDataUrl(entry.imageHashPrefix, page);
      if (dataUrl) {
        images.push({ source: src.source, page, dataUrl });
      }
    }
    if (images.length >= RAG_CONFIG.maxPageImages) break;
  }

  return images;
}

export function formatSourcesForUI(sources: SourceRef[]): string {
  return sources
    .map((s) => {
      const pageRefs = s.pages.map((p) => `p.${p}`).join(", ");
      return `${s.source} ${pageRefs}`;
    })
    .join(" | ");
}
