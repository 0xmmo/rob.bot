import { useState } from "react";
import { RagStatusBar } from "./components/RagStatusBar";
import { ChatWindow } from "./components/ChatWindow";
import { PageImagePanel } from "./components/PageImagePanel";
import { useChat } from "./hooks/useChat";
import { useRagStatus } from "./hooks/useRagStatus";
import type { Citation } from "./utils/citations";

function App() {
  const ragStatus = useRagStatus();
  const [localMode, setLocalMode] = useState(false);
  const { messages, isStreaming, error, sendMessage } = useChat(localMode);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-100">
      <RagStatusBar status={ragStatus} />
      <div className="flex flex-1 min-h-0">
        <ChatWindow
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          onSend={sendMessage}
          onCitationClick={setSelectedCitation}
        />
        {selectedCitation && (
          <PageImagePanel
            citation={selectedCitation}
            onClose={() => setSelectedCitation(null)}
          />
        )}
      </div>
      <button
        onClick={() => setLocalMode((v) => !v)}
        className={`fixed top-3 right-4 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors z-50 ${
          localMode
            ? "bg-emerald-600 text-white"
            : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
        }`}
      >
        {localMode ? "SIM LOCAL" : "CLOUD"}
      </button>
    </div>
  );
}

export default App;
