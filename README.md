# rob.bot

A terminal chat app that can read your PDFs and answer questions about them. Drop PDFs into the `data/` folder, start the app, and ask away.

It uses [OpenRouter](https://openrouter.ai) to talk to AI models, and builds a local search index of your documents so the AI can find the right pages to reference.

---

## What You Need

- A Mac (these instructions are Mac-specific)
- An [OpenRouter](https://openrouter.ai) account and API key (free to sign up, you pay per usage)

## Setup (One Time)

### 1. Install Node.js

Open **Terminal** (search for "Terminal" in Spotlight with `Cmd + Space`).

Copy and paste this command to install Homebrew (a Mac package manager):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install Node.js:

```bash
brew install node
```

Verify it worked — you should see a version number:

```bash
node --version
```

### 2. Download the Project

If you haven't already, clone this repo:

```bash
git clone https://github.com/0xmmo/rob.bot.git
cd rob.bot
```

Or if you already have the folder, just open Terminal and navigate to it:

```bash
cd ~/Projects/rob.bot
```

### 3. Install Dependencies

```bash
npm install
```

This downloads everything the app needs. It may take a minute.

### 4. Add Your API Key

Create a file called `.env` in the project folder:

```bash
echo 'OPENROUTER_API_KEY=your-key-here' > .env
```

Replace `your-key-here` with your actual key from [OpenRouter](https://openrouter.ai/keys).

### 5. Add Your PDFs

Drop any PDF files you want the bot to know about into the `data/` folder:

```bash
mkdir -p data
```

Then use Finder to drag PDFs into `rob.bot/data/`.

---

## Running the App

```bash
npm start
```

The first time you run it with new PDFs, it will take a moment to index them (extract text, build a search index, render page images). This only happens once per file — it caches everything for next time.

### Controls

| Key         | What it does              |
|-------------|---------------------------|
| **Enter**   | Send your message         |
| **Escape**  | Cancel current response   |
| **Ctrl + C**| Quit the app              |

You can scroll the chat with your mouse or trackpad.

---

## Development Mode

If you're making changes to the code and want it to auto-reload:

```bash
npm run dev
```

---

## Troubleshooting

**"command not found: node"**
Node.js isn't installed. Go back to Step 1.

**"OPENROUTER_API_KEY is not set"**
You need to create the `.env` file. Go back to Step 4.

**App seems stuck on first run**
It's indexing your PDFs. Large files (100+ pages) can take a couple minutes. Let it finish.

**Nothing in chat / empty responses**
Check that your OpenRouter account has credits. You can check at [openrouter.ai/credits](https://openrouter.ai/credits).
