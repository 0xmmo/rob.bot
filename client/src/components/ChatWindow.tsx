import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { ChatMessage } from "../types";
import type { Citation } from "../utils/citations";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (message: string) => void;
  onCitationClick?: (citation: Citation) => void;
}

export function ChatWindow({ messages, isStreaming, error, onSend, onCitationClick }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} onCitationClick={onCitationClick} />
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <ChatInput onSend={onSend} disabled={isStreaming} />
    </div>
  );
}
