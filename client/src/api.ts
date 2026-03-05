export interface SSEEvent {
  event: string;
  data: string;
}

export function parseSSELines(text: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  let currentEvent = "";
  let currentData = "";

  const lines = text.split("\n");
  const remainder: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "" && currentEvent && currentData) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    } else if (i === lines.length - 1 && line !== "") {
      // Incomplete line at the end — save as remainder
      if (currentEvent) {
        remainder.push(`event: ${currentEvent}`);
      }
      if (currentData) {
        remainder.push(`data: ${currentData}`);
      }
      remainder.push(line);
      currentEvent = "";
      currentData = "";
    }
  }

  // If we have a partial event/data pair at the end, include as remainder
  if (currentEvent || currentData) {
    if (currentEvent) remainder.push(`event: ${currentEvent}`);
    if (currentData) remainder.push(`data: ${currentData}`);
  }

  return { events, remainder: remainder.join("\n") };
}

export async function* streamChat(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): AsyncGenerator<SSEEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSSELines(buffer);
    buffer = remainder;

    for (const event of events) {
      yield event;
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const { events } = parseSSELines(buffer + "\n\n");
    for (const event of events) {
      yield event;
    }
  }
}
