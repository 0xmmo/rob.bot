import type { ChatMessage } from "../types";
import { SourceCitations } from "./SourceCitations";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
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
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.isStreaming && !message.content && (
          <div className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
            <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.1s]" />
            <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.2s]" />
          </div>
        )}
        {message.sources && <SourceCitations sources={message.sources} />}
      </div>
    </div>
  );
}
