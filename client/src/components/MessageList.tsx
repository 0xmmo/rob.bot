import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import type { Citation } from "../utils/citations";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  onCitationClick?: (citation: Citation) => void;
}

export function MessageList({ messages, onCitationClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <p>Send a message to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onCitationClick={onCitationClick} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
