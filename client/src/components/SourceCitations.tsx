import type { SourceInfo } from "../types";

interface Props {
  sources: SourceInfo;
}

export function SourceCitations({ sources }: Props) {
  if (!sources.sourcesLine) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-900/40 px-2.5 py-0.5 text-blue-300 border border-blue-800">
        {sources.sourcesLine}
      </span>
      {sources.pageImageCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-900/40 px-2.5 py-0.5 text-purple-300 border border-purple-800">
          {sources.pageImageCount} page image(s)
        </span>
      )}
    </div>
  );
}
