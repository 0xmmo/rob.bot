import { RagStatusBar } from "./components/RagStatusBar";
import { ChatWindow } from "./components/ChatWindow";
import { useChat } from "./hooks/useChat";
import { useRagStatus } from "./hooks/useRagStatus";

function App() {
  const ragStatus = useRagStatus();
  const { messages, isStreaming, error, sendMessage } = useChat();

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-100">
      <header className="border-b border-zinc-700 px-4 py-3">
        <h1 className="text-lg font-semibold">rob.bot</h1>
      </header>
      <RagStatusBar status={ragStatus} />
      <ChatWindow
        messages={messages}
        isStreaming={isStreaming}
        error={error}
        onSend={sendMessage}
      />
    </div>
  );
}

export default App;
