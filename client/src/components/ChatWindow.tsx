import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (message: string) => void;
}

export function ChatWindow({ messages, isStreaming, error, onSend }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} />
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <ChatInput onSend={onSend} disabled={isStreaming} />
    </div>
  );
}
