import { readFile, writeFile, mkdir, stat, readdir, unlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { RAG_CONFIG } from "./config.js";
import type { Manifest, ManifestEntry } from "./types.js";

export interface ScanResult {
  newOrChanged: string[];
  unchanged: string[];
  deleted: string[];
}

async function hashFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadManifest(): Promise<Manifest> {
  try {
    const data = await readFile(RAG_CONFIG.manifestPath, "utf-8");
    return JSON.parse(data) as Manifest;
  } catch {
    return {};
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  await mkdir(path.dirname(RAG_CONFIG.manifestPath), { recursive: true });
  await writeFile(RAG_CONFIG.manifestPath, JSON.stringify(manifest, null, 2));
}

export async function scanFiles(
  chunkingStrategy: string,
): Promise<{ result: ScanResult; manifest: Manifest }> {
  const manifest = await loadManifest();
  const result: ScanResult = { newOrChanged: [], unchanged: [], deleted: [] };

  // Find all PDFs in data dir
  let pdfFiles: string[] = [];
  try {
    const entries = await readdir(RAG_CONFIG.dataDir);
    pdfFiles = entries
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => path.join(RAG_CONFIG.dataDir, f));
  } catch {
    // data/ doesn't exist yet — no files
    return { result, manifest };
  }

  const currentFilePaths = new Set(pdfFiles);

  // Check for deleted files
  for (const filePath of Object.keys(manifest)) {
    if (!currentFilePaths.has(filePath)) {
      result.deleted.push(filePath);
    }
  }

  // Check each file
  for (const filePath of pdfFiles) {
    const entry = manifest[filePath];
    const fileStat = await stat(filePath);

    // Fast path: mtime+size match and same model/strategy
    if (
      entry &&
      entry.mtime === fileStat.mtimeMs &&
      entry.size === fileStat.size &&
      entry.embeddingModel === RAG_CONFIG.embeddingModel &&
      entry.chunkingStrategy === chunkingStrategy
    ) {
      result.unchanged.push(filePath);
      continue;
    }

    // Slow path: hash check
    const hash = await hashFile(filePath);
    if (
      entry &&
      entry.hash === hash &&
      entry.embeddingModel === RAG_CONFIG.embeddingModel &&
      entry.chunkingStrategy === chunkingStrategy
    ) {
      // File content unchanged, update mtime/size for next fast path
      entry.mtime = fileStat.mtimeMs;
      entry.size = fileStat.size;
      result.unchanged.push(filePath);
      continue;
    }

    result.newOrChanged.push(filePath);
  }

  return { result, manifest };
}

export async function updateManifest(
  manifest: Manifest,
  filePath: string,
  entry: ManifestEntry,
): Promise<void> {
  manifest[filePath] = entry;
  await saveManifest(manifest);
}

export async function cleanupDeleted(
  manifest: Manifest,
  deletedFiles: string[],
): Promise<void> {
  for (const filePath of deletedFiles) {
    const entry = manifest[filePath];
    if (entry) {
      try {
        await unlink(path.join(RAG_CONFIG.vectorsDir, entry.vectorFile));
      } catch {
        // file already gone
      }
      if (entry.imageHashPrefix) {
        try {
          await rm(path.join(RAG_CONFIG.imagesDir, entry.imageHashPrefix), {
            recursive: true,
            force: true,
          });
        } catch {
          // directory already gone
        }
      }
      delete manifest[filePath];
    }
  }
  await saveManifest(manifest);
}
