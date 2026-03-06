import { useState } from "react";
import { RagStatusBar } from "./components/RagStatusBar";
import { ChatWindow } from "./components/ChatWindow";
import { PageImagePanel } from "./components/PageImagePanel";
import { useChat } from "./hooks/useChat";
import { useRagStatus } from "./hooks/useRagStatus";
import type { Citation } from "./utils/citations";

function App() {
  const ragStatus = useRagStatus();
  const { messages, isStreaming, error, sendMessage } = useChat();
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
    </div>
  );
}

export default App;
