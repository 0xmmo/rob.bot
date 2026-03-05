import { useState, useEffect, useRef } from "react";
import type { RagStatusState } from "../types";

export function useRagStatus(): RagStatusState {
  const [state, setState] = useState<RagStatusState>({
    messages: [],
    ready: false,
    failed: false,
    documentCount: 0,
    chunkCount: 0,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/rag/status");
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data) as { message: string };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, data.message],
      }));
    });

    es.addEventListener("ready", (e) => {
      const data = JSON.parse(e.data) as {
        documentCount: number;
        chunkCount: number;
      };
      setState((prev) => ({
        ...prev,
        ready: true,
        documentCount: data.documentCount,
        chunkCount: data.chunkCount,
      }));
      es.close();
    });

    es.addEventListener("error", (e) => {
      // SSE error event — could be a server-sent error or connection failure
      if (e instanceof MessageEvent) {
        const data = JSON.parse(e.data) as { message: string };
        setState((prev) => ({
          ...prev,
          failed: true,
          messages: [...prev.messages, `Error: ${data.message}`],
        }));
      }
      es.close();
    });

    return () => {
      es.close();
    };
  }, []);

  return state;
}
