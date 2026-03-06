import type { ChatMessage } from "../types";
import type { Citation } from "../utils/citations";
import { SourceCitations } from "./SourceCitations";
import { MarkdownContent } from "./MarkdownContent";

interface Props {
  message: ChatMessage;
  onCitationClick?: (citation: Citation) => void;
}

export function MessageBubble({ message, onCitationClick }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-zinc-800 text-zinc-100 border border-zinc-700"
        }`}
      >
        {message.sources && <SourceCitations sources={message.sources} />}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <MarkdownContent content={message.content} onCitationClick={onCitationClick} />
        )}
        {message.isStreaming && !message.content && (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.1s]" />
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.2s]" />
            </div>
            <span className="text-xs text-zinc-400">
              {message.phase === "gathering" ? "Gathering information..." :
               message.phase === "thinking" ? "Thinking..." : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
