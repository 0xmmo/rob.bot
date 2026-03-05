import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { preprocessCitations, parseCiteHref, type Citation } from "../utils/citations";
import type { Components } from "react-markdown";

interface Props {
  content: string;
  onCitationClick?: (citation: Citation) => void;
}

export function MarkdownContent({ content, onCitationClick }: Props) {
  const processed = preprocessCitations(content);

  const components: Components = {
    a({ href, children }) {
      if (href) {
        const citation = parseCiteHref(href);
        if (citation) {
          return (
            <button
              type="button"
              onClick={() => onCitationClick?.(citation)}
              className="inline-flex items-center gap-1 rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300 border border-blue-800 hover:bg-blue-800/60 cursor-pointer transition-colors"
            >
              {children}
            </button>
          );
        }
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="prose prose-invert prose-sm max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
