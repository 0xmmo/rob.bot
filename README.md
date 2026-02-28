# rob.bot

Terminal chat app with RAG over your PDFs. Drop documents into `data/`, and the bot indexes them locally so it can retrieve relevant pages when you ask questions. Uses [OpenRouter](https://openrouter.ai) for LLM and embedding calls.

## Setup

### Install Node.js

```bash
brew install node
```

### Install Dependencies

```bash
npm install
```

### Configure API Key

Create a `.env` file with your [OpenRouter API key](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=your-key-here
```

### Add PDFs

Put any PDFs you want indexed into the `data/` directory.

## Usage

```bash
npm start
```

On first run with new PDFs, the app indexes them (text extraction, embeddings, page rendering). Results are cached in `.rag-cache/` so subsequent runs are fast.

`npm run dev` runs with auto-reload for development.

## How It Works

1. PDFs are scanned, chunked, and embedded using `qwen/qwen3-embedding-8b` (4096-dim vectors)
2. Chunks are stored in a local [Vectra](https://github.com/Stevenic/vectra) vector index
3. Each query retrieves the top-k most relevant chunks + rendered page images
4. Context and images are sent alongside your message to `qwen/qwen3.5-122b-a10b` via OpenRouter
5. Response streams back in real-time with source citations

File change detection uses hash + mtime so only modified documents get re-indexed.
