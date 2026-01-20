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

## Docker

What i should do?

First
```
mkdir /root/deployer

mkdir /root/deployer/task

mkdir /root/deployer/release
```

Download the image and 

```
docker import deployer-0-1-0.tar.gz
```

Start the docker:
1. write `docker-compose.yml`
```
version: "3.8"

services:
  deployer:
    image: deployer:0.1.0
    container_name: deployer
    ports:
      - "2222:22"
    volumes:
      - /root/deployer/release:/root/deployer/release
      - /root/deployer/task:/root/deployer/task
    restart: unless-stopped

```
2. Run `docker compose up -d`

Run me to deploy 
```
docker exec -w /root/deployer deployer npm run start
```

Run me to clean
```
docker exec -w /root/deployer deployer npm run clean
```