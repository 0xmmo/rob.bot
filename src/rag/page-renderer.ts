import { readFile, mkdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, DOMMatrix, DOMPoint, ImageData, Path2D } from "@napi-rs/canvas";
import { RAG_CONFIG } from "./config.js";

// Polyfill DOM globals that pdfjs-dist needs in Node.js
const g = globalThis as Record<string, unknown>;
if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
if (!g.DOMPoint) g.DOMPoint = DOMPoint;
if (!g.ImageData) g.ImageData = ImageData;
if (!g.Path2D) g.Path2D = Path2D;

// Dynamic import — must happen after polyfills are in place
let _pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function getPdfjs() {
  if (!_pdfjs) {
    _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return _pdfjs;
}

function pageImagePath(hashPrefix: string, pageNumber: number): string {
  return path.join(RAG_CONFIG.imagesDir, hashPrefix, `page-${pageNumber}.png`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function renderPdfPages(
  filePath: string,
  hashPrefix: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const pdfjs = await getPdfjs();

  // Suppress noisy pdfjs warnings (JPEG2000/OpenJPEG, dependent images, etc.)
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0]);
    if (
      msg.includes("JpxError") ||
      msg.includes("Dependent image") ||
      msg.includes("PDFImage")
    )
      return;
    origWarn.apply(console, args);
  };

  const buffer = await readFile(filePath);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const total = pdf.numPages;
  const outDir = path.join(RAG_CONFIG.imagesDir, hashPrefix);
  await mkdir(outDir, { recursive: true });

  let done = 0;
  const concurrency = RAG_CONFIG.renderConcurrency;

  // Process pages in batches for controlled concurrency
  for (let start = 1; start <= total; start += concurrency) {
    const batch: Promise<void>[] = [];
    for (let p = start; p < start + concurrency && p <= total; p++) {
      const pageNum = p;
      batch.push(
        (async () => {
          const outPath = pageImagePath(hashPrefix, pageNum);
          if (await fileExists(outPath)) {
            done++;
            onProgress?.(done, total);
            return;
          }

          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: RAG_CONFIG.renderScale });
          const canvas = createCanvas(
            Math.floor(viewport.width),
            Math.floor(viewport.height),
          );
          const ctx = canvas.getContext("2d");

          await page.render({
            canvasContext: ctx,
            viewport,
            canvas: null,
          }).promise;

          const pngBuffer = await canvas.encode("png");
          await writeFile(outPath, pngBuffer);
          done++;
          onProgress?.(done, total);
        })(),
      );
    }
    await Promise.all(batch);
  }

  await pdf.destroy();
  console.warn = origWarn;
}

export async function loadPageImageAsDataUrl(
  hashPrefix: string,
  pageNumber: number,
): Promise<string | null> {
  const imgPath = pageImagePath(hashPrefix, pageNumber);
  try {
    const buffer = await readFile(imgPath);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
