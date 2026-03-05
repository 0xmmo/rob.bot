import type { RagStatusState } from "../types";

interface Props {
  status: RagStatusState;
}

export function RagStatusBar({ status }: Props) {
  if (status.ready) {
    return (
      <div className="bg-green-900/50 border-b border-green-700 px-4 py-2 text-sm text-green-300">
        RAG ready: {status.documentCount} document(s), {status.chunkCount}{" "}
        chunks
      </div>
    );
  }

  if (status.failed) {
    return (
      <div className="bg-red-900/50 border-b border-red-700 px-4 py-2 text-sm text-red-300">
        RAG initialization failed (chat still works)
      </div>
    );
  }

  const lastMessage =
    status.messages.length > 0
      ? status.messages[status.messages.length - 1]
      : "Initializing...";

  return (
    <div className="bg-zinc-800 border-b border-zinc-700 px-4 py-2 text-sm text-zinc-400">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
        <span>{lastMessage}</span>
      </div>
    </div>
  );
}
