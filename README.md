# rob.bot

Chat app with RAG over your PDFs. Drop documents into `data/`, and the bot indexes them locally so it can retrieve relevant pages when you ask questions. Uses [OpenRouter](https://openrouter.ai) for LLM and embedding calls.

Comes with a web UI (Express + React) and a terminal UI (blessed).

## Setup

```bash
brew install node
npm install
cd client && npm install
```

Create a `.env` file with your [OpenRouter API key](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=your-key-here
```

Drop any PDFs into the `data/` directory.

## Usage

### Web UI

```bash
npm run dev        # dev mode — Express on :3000, Vite on :5173
npm run build      # build client for production
npm start          # production — everything on :3000
```

### Terminal UI

```bash
npm run start:tui
```

### Tests

```bash
npm run test:e2e         # quick API tests
npm run test:e2e -- --full   # includes full LLM streaming test
```

## How It Works

1. PDFs are scanned, chunked, and embedded using `qwen/qwen3-embedding-8b` (4096-dim vectors)
2. Chunks are stored in a local [Vectra](https://github.com/Stevenic/vectra) vector index
3. Each query retrieves the top-k most relevant chunks + rendered page images
4. Context and images are sent alongside your message to `qwen/qwen3.5-122b-a10b` via OpenRouter
5. Response streams back in real-time with source citations

File change detection uses hash + mtime so only modified documents get re-indexed.

## API

- `POST /api/chat` — SSE stream (send `{ message, history }`, receive `rag-context`, `token`, `done` events)
- `GET /api/rag/status` — SSE stream of RAG initialization progress
- `GET /api/health` — JSON health check
