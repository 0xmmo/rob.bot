export type StreamPhase = "gathering" | "thinking" | "responding";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceInfo | null;
  isStreaming?: boolean;
  phase?: StreamPhase;
}

export interface SourceInfo {
  sourcesLine: string | null;
  pageImageCount: number;
}

export interface RagStatusState {
  messages: string[];
  ready: boolean;
  failed: boolean;
  documentCount: number;
  chunkCount: number;
}
