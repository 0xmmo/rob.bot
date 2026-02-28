import "dotenv/config";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.5-27b";

const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY");
  process.exit(1);
}

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(2)}s`;
}

async function testBasic() {
  console.log("=== Test 1: Basic (non-streaming) request ===");
  console.log(`Model: ${MODEL}\n`);

  const t0 = performance.now();
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "user", content: "Say hello in exactly 5 words." },
      ],
    }),
  });
  const tResponse = performance.now();
  console.log(`[${elapsed(t0)}] HTTP response received (status ${res.status})`);

  const data = (await res.json()) as Record<string, any>;
  const tParsed = performance.now();
  console.log(`[${elapsed(t0)}] Body parsed`);

  const usage = data.usage;
  if (usage) {
    console.log(`\nToken usage:`);
    console.log(`  prompt:     ${usage.prompt_tokens}`);
    console.log(`  completion: ${usage.completion_tokens} (reasoning: ${usage.completion_tokens_details?.reasoning_tokens ?? "?"})`);
    console.log(`  total:      ${usage.total_tokens}`);
    console.log(`  cost:       $${usage.cost}`);
  }

  console.log(`\nProvider: ${data.provider}`);
  console.log(`Model:    ${data.model}`);

  if (data.choices?.[0]?.message?.content) {
    console.log(`\n✓ Reply: "${data.choices[0].message.content}"`);
  } else if (data.error) {
    console.log(`\n✗ Error: ${data.error.message}`);
  }

  console.log(`\nTiming summary:`);
  console.log(`  Time to HTTP response: ${((tResponse - t0) / 1000).toFixed(2)}s`);
  console.log(`  Time to body parsed:   ${((tParsed - t0) / 1000).toFixed(2)}s`);
}

async function testStreaming() {
  console.log("\n=== Test 2: Streaming request ===\n");

  const t0 = performance.now();
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "user", content: "Count from 1 to 5, one number per line." },
      ],
      stream: true,
    }),
  });
  console.log(`[${elapsed(t0)}] HTTP response received (status ${res.status})`);

  if (!res.ok) {
    console.log("✗ Error:", await res.text());
    return;
  }

  const body = res.body;
  if (!body) { console.log("✗ No body"); return; }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullReply = "";
  let buffer = "";
  let chunkCount = 0;
  let reasoningChunks = 0;
  let contentChunks = 0;
  let firstReasoningAt: number | null = null;
  let firstContentAt: number | null = null;

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
      if (payload === "[DONE]") {
        console.log(`\n[${elapsed(t0)}] [DONE] received`);
        continue;
      }

      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        const reasoning = delta?.reasoning;
        const content = delta?.content;

        if (reasoning) {
          reasoningChunks++;
          if (!firstReasoningAt) {
            firstReasoningAt = performance.now();
            console.log(`[${elapsed(t0)}] First reasoning token`);
          }
        }

        if (content) {
          contentChunks++;
          fullReply += content;
          if (!firstContentAt) {
            firstContentAt = performance.now();
            console.log(`[${elapsed(t0)}] First content token`);
            process.stdout.write("  Output: ");
          }
          process.stdout.write(content);
        }
      } catch {
        // skip
      }
      chunkCount++;
    }
  }
  const tDone = performance.now();

  console.log(`\n\nTiming summary:`);
  console.log(`  Time to HTTP response:      ${((res.headers.get("date") ? 0 : 0) || 0) ? "?" : elapsed(t0)} (from fetch start)`);
  console.log(`  Time to first reasoning:    ${firstReasoningAt ? ((firstReasoningAt - t0) / 1000).toFixed(2) + "s" : "n/a"}`);
  console.log(`  Time to first content:      ${firstContentAt ? ((firstContentAt - t0) / 1000).toFixed(2) + "s" : "n/a"}`);
  console.log(`  Total duration:             ${((tDone - t0) / 1000).toFixed(2)}s`);
  if (firstContentAt && firstReasoningAt) {
    console.log(`  Reasoning duration:         ${((firstContentAt - firstReasoningAt) / 1000).toFixed(2)}s`);
  }
  if (firstContentAt) {
    console.log(`  Content streaming duration: ${((tDone - firstContentAt) / 1000).toFixed(2)}s`);
  }
  console.log(`\nChunk breakdown:`);
  console.log(`  Total chunks:     ${chunkCount}`);
  console.log(`  Reasoning chunks: ${reasoningChunks}`);
  console.log(`  Content chunks:   ${contentChunks}`);
  console.log(`\nFull reply: "${fullReply}"`);
}

async function testModelList() {
  console.log("\n=== Test 3: Available Qwen models ===\n");

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = (await res.json()) as Record<string, any>;
  const qwenModels = data.data
    ?.filter((m: { id: string }) => m.id.toLowerCase().includes("qwen"))
    ?.map((m: { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string } }) => ({
      id: m.id,
      name: m.name,
      context: m.context_length,
      promptCost: m.pricing?.prompt,
      completionCost: m.pricing?.completion,
    }));

  console.log(`Found ${qwenModels?.length ?? 0} Qwen models:\n`);
  for (const m of qwenModels ?? []) {
    console.log(`  ${m.id}`);
    console.log(`    name: ${m.name} | ctx: ${m.context} | $/prompt: ${m.promptCost} | $/completion: ${m.completionCost}`);
  }
}

async function main() {
  try {
    await testBasic();
    await testStreaming();
    await testModelList();
    console.log("\n=== All tests complete ===");
  } catch (err) {
    console.error("\n✗ Uncaught error:", err);
    process.exit(1);
  }
}

main();
