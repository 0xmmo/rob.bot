import { useReducer, useCallback } from "react";
import type { ChatMessage, SourceInfo } from "../types";
import { streamChat } from "../api";

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
}

type ChatAction =
  | { type: "SEND_MESSAGE"; message: string }
  | { type: "START_ASSISTANT" }
  | { type: "APPEND_TOKEN"; content: string }
  | { type: "TOOL_CALL"; tool: string; queries: string[] }
  | { type: "RAG_CONTEXT"; sources: SourceInfo }
  | { type: "REASONING_DONE" }
  | { type: "STREAM_DONE"; fullReply: string }
  | { type: "SET_ERROR"; error: string };

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}`;
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SEND_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: nextId(), role: "user", content: action.message },
        ],
        isStreaming: true,
        error: null,
      };
    case "START_ASSISTANT":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: nextId(), role: "assistant", content: "", isStreaming: true, phase: "thinking" },
        ],
      };
    case "APPEND_TOKEN": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          content: last.content + action.content,
        };
      }
      return { ...state, messages: msgs };
    }
    case "TOOL_CALL": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, phase: "searching", toolQueries: action.queries };
      }
      return { ...state, messages: msgs };
    }
    case "RAG_CONTEXT": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, sources: action.sources };
      }
      return { ...state, messages: msgs };
    }
    case "REASONING_DONE": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, phase: "responding" };
      }
      return { ...state, messages: msgs };
    }
    case "STREAM_DONE": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          content: action.fullReply,
          isStreaming: false,
        };
      }
      return { ...state, messages: msgs, isStreaming: false };
    }
    case "SET_ERROR":
      return {
        ...state,
        isStreaming: false,
        error: action.error,
        messages: state.messages.filter(
          (m) => !(m.role === "assistant" && m.isStreaming && m.content === ""),
        ),
      };
    default:
      return state;
  }
}

export function useChat(localMode: boolean) {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isStreaming: false,
    error: null,
  });

  const sendMessage = useCallback(
    async (message: string) => {
      dispatch({ type: "SEND_MESSAGE", message });
      dispatch({ type: "START_ASSISTANT" });

      // Build history from existing messages (excluding the new user message and streaming assistant)
      const history = state.messages
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        for await (const event of streamChat(message, history, localMode)) {
          const data = JSON.parse(event.data);

          switch (event.event) {
            case "tool-call":
              dispatch({ type: "TOOL_CALL", tool: data.tool, queries: data.queries });
              break;
            case "rag-context":
              dispatch({ type: "RAG_CONTEXT", sources: data });
              break;
            case "reasoning-done":
              dispatch({ type: "REASONING_DONE" });
              break;
            case "token":
              dispatch({ type: "APPEND_TOKEN", content: data.content });
              break;
            case "done":
              dispatch({
                type: "STREAM_DONE",
                fullReply: data.fullReply,
              });
              break;
            case "error":
              dispatch({ type: "SET_ERROR", error: data.message });
              break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "SET_ERROR", error: msg });
      }
    },
    [state.messages, localMode],
  );

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    error: state.error,
    sendMessage,
  };
}
