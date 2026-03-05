import type { Citation } from "../utils/citations";

interface Props {
  citation: Citation;
  onClose: () => void;
}

export function PageImagePanel({ citation, onClose }: Props) {
  const pdfUrl = `/api/pdf/${encodeURIComponent(citation.source)}#page=${citation.page}`;

  return (
    <div className="w-[480px] flex-shrink-0 border-l border-zinc-700 bg-zinc-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <div className="text-sm font-medium text-zinc-200 truncate">
          {citation.source} &mdash; Page {citation.page}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100 text-lg leading-none cursor-pointer"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>
      <iframe
        key={`${citation.source}-${citation.page}`}
        src={pdfUrl}
        className="flex-1 w-full"
        title={`${citation.source} page ${citation.page}`}
      />
    </div>
  );
}
