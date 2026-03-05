export interface Citation {
  source: string;
  page: number;
}

const CITE_RE = /\[Source:\s*([^,]+),\s*Page\s*(\d+)\]/g;

export function preprocessCitations(text: string): string {
  return text.replace(CITE_RE, (_match, file: string, page: string) => {
    const source = file.trim();
    return `[${source}, p.${page}](#cite--${encodeURIComponent(source)}--${page})`;
  });
}

export function parseCiteHref(href: string): Citation | null {
  const match = href.match(/^#cite--(.+)--(\d+)$/);
  if (!match) return null;
  return {
    source: decodeURIComponent(match[1]!),
    page: parseInt(match[2]!, 10),
  };
}
