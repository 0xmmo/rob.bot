import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import type { ExtractedDocument, PageContent } from "./types.js";

export async function extractPdf(filePath: string): Promise<ExtractedDocument> {
  const buffer = await readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const pages: PageContent[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ");
    pages.push({ pageNumber: i, text });
  }

  return {
    source: path.basename(filePath),
    filePath: path.resolve(filePath),
    pages,
  };
}
