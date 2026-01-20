# Frontend Build Agent

Node.js agent that uses the GPT API to drive a build loop and produce a static frontend release on Ubuntu 20.04.

## Usage

1. Place the project zip at `task/main.zip`.
2. Create a `.env` file (dotenv is required):

```
OPENAI_API_KEY=your_key
OPENAI_API_URL=https://api.openai.com/v1/chat/completions
OPENAI_EMBEDDINGS_MODEL=text-embedding-3-small
```

3. Or set env vars directly:

```bash
export OPENAI_API_KEY="your_key"
export OPENAI_API_URL="https://api.openai.com/v1/chat/completions"
export OPENAI_EMBEDDINGS_MODEL="text-embedding-3-small"
```

4. Run:

```bash
npm start
```

The agent will:
- Unzip to `source/`
- Read directory and `package.json` info
- Ask GPT for commands and execute them until it says `操作完成`
- Move the build output into `release/`

## Optional env

- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `MAX_STEPS` (default: `30`)
