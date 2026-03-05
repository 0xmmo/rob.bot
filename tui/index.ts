import "dotenv/config";
import blessed from "blessed";
import { initRagPipeline, type RagPipeline } from "./rag/pipeline.js";

// ── Config ──────────────────────────────────────────────────────────────────
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.5-122b-a10b";
const SYSTEM_PROMPT = "You are rob.bot, a helpful AI assistant. Be concise and direct.";

// ── Types ───────────────────────────────────────────────────────────────────
interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ApiMessage {
  role: string;
  content: MessageContent;
}

interface StreamDelta {
  content?: string;
  reasoning?: string;
}

interface StreamChunk {
  choices: Array<{ delta: StreamDelta }>;
}

// ── State ───────────────────────────────────────────────────────────────────
const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("Error: OPENROUTER_API_KEY environment variable is required.");
  console.error("  export OPENROUTER_API_KEY=your-key");
  process.exit(1);
}

const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];
let streaming = false;
let ragPipeline: RagPipeline | null = null;

// ── UI Setup ────────────────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: "rob.bot",
});

const chatBox = blessed.log({
  parent: screen,
  top: 0,
  left: 0,
  width: "100%",
  height: "100%-3",
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: "│",
    style: { bg: "blue" },
  },
  border: { type: "line" },
  style: {
    border: { fg: "blue" },
  },
  label: " rob.bot — Qwen 3.5 27B ",
  tags: true,
  mouse: true,
});

const inputBox = blessed.textbox({
  parent: screen,
  bottom: 0,
  left: 0,
  width: "100%",
  height: 3,
  border: { type: "line" },
  style: {
    border: { fg: "green" },
    focus: { border: { fg: "yellow" } },
  },
  label: " you > ",
  inputOnFocus: false,
  mouse: true,
});

screen.key(["C-c"], () => process.exit(0));
inputBox.key(["C-c"], () => process.exit(0));

// Re-focus input whenever it loses focus (e.g. mouse click on chatBox)
// Use setTimeout to break the blur→focus→render→blur cycle
inputBox.on("blur", () => {
  if (!streaming) setTimeout(() => promptInput(), 0);
});

chatBox.log("Type your message below. Ctrl+C to quit.");
chatBox.log("");
screen.render();

// ── Input Helpers ───────────────────────────────────────────────────────────
function promptInput(): void {
  inputBox.readInput(() => {/* handled by submit event */});
}

// ── Spinner ─────────────────────────────────────────────────────────────────
const spinFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinIdx = 0;
let spinTimer: ReturnType<typeof setInterval> | null = null;
let spinElapsed = 0;
let spinLabel = "thinking";

function startSpinner(label: string): void {
  stopSpinner();
  spinLabel = label;
  spinIdx = 0;
  spinElapsed = 0;
  updateSpinnerLine();
  spinTimer = setInterval(() => {
    spinIdx = (spinIdx + 1) % spinFrames.length;
    spinElapsed += 100;
    updateSpinnerLine();
  }, 100);
}

function updateSpinnerLine(): void {
  const lines = chatBox.getLines() as string[];
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0 && lines[lastIdx]!.includes(spinLabel)) {
    chatBox.deleteLine(lastIdx);
  }
  const secs = (spinElapsed / 1000).toFixed(1);
  chatBox.log(`{grey-fg}  ${spinFrames[spinIdx]!} ${spinLabel}... ${secs}s{/}`);
  screen.render();
}

function stopSpinner(): void {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
  const lines = chatBox.getLines() as string[];
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0 && spinLabel && lines[lastIdx]!.includes(spinLabel)) {
    chatBox.deleteLine(lastIdx);
  }
}

// ── Chat Logic ──────────────────────────────────────────────────────────────
async function streamChat(userMessage: string): Promise<void> {
  messages.push({ role: "user", content: userMessage });

  // RAG: retrieve context for this query
  let ragSystemMessage = SYSTEM_PROMPT;
  let ragPageImages: Array<{ source: string; page: number; dataUrl: string }> = [];

  if (ragPipeline) {
    startSpinner("gathering context");
    try {
      const ragResult = await ragPipeline.query(userMessage);
      stopSpinner();
      if (ragResult.contextSuffix) {
        ragSystemMessage = SYSTEM_PROMPT + ragResult.contextSuffix;
        chatBox.log(`{grey-fg}  \u{2713} \u{1F4C4} ${ragResult.sourcesLine}{/}`);
        if (ragResult.pageImages.length > 0) {
          ragPageImages = ragResult.pageImages;
          chatBox.log(`{grey-fg}  \u{2713} \u{1F5BC}  ${ragPageImages.length} page image(s) attached{/}`);
        }
        screen.render();
      }
    } catch {
      stopSpinner();
      // RAG failure is non-fatal — continue without context
    }
  }

  const t0 = performance.now();

  // Build messages with dynamic system prompt (RAG context injected fresh each turn)
  const apiMessages: ApiMessage[] = [
    { role: "system", content: ragSystemMessage },
    ...messages.slice(1, -1).map((m) => ({ role: m.role, content: m.content as MessageContent })),
  ];

  // Build the current user message — multimodal if page images are available
  if (ragPageImages.length > 0) {
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: userMessage }];
    for (const img of ragPageImages) {
      contentParts.push({
        type: "image_url",
        image_url: { url: img.dataUrl },
      });
    }
    apiMessages.push({ role: "user", content: contentParts });
  } else {
    apiMessages.push({ role: "user", content: userMessage });
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: apiMessages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  const body = res.body;
  if (!body) throw new Error("No response body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullReply = "";
  let fullReasoning = "";
  let buffer = "";
  let isReasoning = false;
  let reasoningDone = false;

  startSpinner("thinking");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload) as StreamChunk;
        const delta = json.choices[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning) {
          if (!isReasoning) isReasoning = true;
          fullReasoning += delta.reasoning;
        }

        if (delta.content) {
          if (isReasoning && !reasoningDone) {
            reasoningDone = true;
            const reasoningSecs = ((performance.now() - t0) / 1000).toFixed(1);
            stopSpinner();
            chatBox.log(`{grey-fg}  \u{2713} thought for ${reasoningSecs}s{/}`);
          } else if (!reasoningDone) {
            // No reasoning phase, just stop spinner on first content
            reasoningDone = true;
            stopSpinner();
          }

          fullReply += delta.content;
          updateStreamingReply(fullReply);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  stopSpinner();

  if (!fullReply && fullReasoning) {
    chatBox.log("{grey-fg}  (no reply){/}");
  }

  if (fullReply) {
    messages.push({ role: "assistant", content: fullReply });
  }
}

function updateStreamingReply(text: string): void {
  const lines = text.split("\n");
  const contentLines = chatBox.getLines() as string[];

  // Find the last marker line (the "thought for" or previous content boundary)
  let markerIdx = contentLines.length - 1;
  while (
    markerIdx >= 0 &&
    !contentLines[markerIdx]!.includes("thought for") &&
    !contentLines[markerIdx]!.includes("you >")
  ) {
    markerIdx--;
  }

  // Delete lines after the marker
  const toDelete = contentLines.length - markerIdx - 1;
  for (let i = 0; i < toDelete; i++) {
    chatBox.deleteLine(contentLines.length - 1 - i);
  }

  // Add the response content
  for (const line of lines) {
    chatBox.log("  " + line);
  }
  screen.render();
}

// ── Input Handler ───────────────────────────────────────────────────────────
inputBox.on("submit", (value: string) => {
  const text = value.trim();
  inputBox.clearValue();
  screen.render();

  if (!text || streaming) {
    promptInput();
    return;
  }

  chatBox.log(`{green-fg}you >{/} ${text}`);
  screen.render();
  streaming = true;
  inputBox.style.border.fg = "grey";
  (inputBox as blessed.Widgets.BoxElement).setLabel(" ... ");
  screen.render();

  streamChat(text)
    .catch((err: unknown) => {
      stopSpinner();
      const msg = err instanceof Error ? err.message : String(err);
      chatBox.log(`{red-fg}error:{/} ${msg}`);
      messages.pop();
    })
    .finally(() => {
      streaming = false;
      chatBox.log("");
      inputBox.style.border.fg = "green";
      (inputBox as blessed.Widgets.BoxElement).setLabel(" you > ");
      screen.render();
      promptInput();
    });
});

inputBox.key(["escape"], () => {
  inputBox.cancel();
});

// ── RAG Initialization (non-blocking) ──────────────────────────────────────
initRagPipeline(apiKey, (msg) => {
  chatBox.log(`{grey-fg}${msg}{/}`);
  screen.render();
})
  .then((pipeline) => {
    ragPipeline = pipeline;
    chatBox.log("");
    screen.render();
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    chatBox.log(`{yellow-fg}RAG init failed (chat still works): ${msg}{/}`);
    screen.render();
  });

screen.render();
promptInput();
