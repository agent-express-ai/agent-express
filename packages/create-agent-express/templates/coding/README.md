# Coding Agent

A coding assistant with file system tools, built with [Agent Express](https://github.com/agent-express/agent-express).

## Features

- **Read files** -- Read any file's contents
- **Write files** -- Create or update files (with approval gate)
- **List directories** -- Explore project structure
- **Write approval** -- Human-in-the-loop approval before writing files
- **Budget cap** -- $0.50 USD cost limit per session
- **Dev console** -- Terminal trace for development visibility

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
```

3. Run the agent in development mode:

```bash
npm run dev
```

4. Run tests:

```bash
npm test
```

## Middleware stack

| Middleware | Purpose |
|---|---|
| `tools.function(read_file)` | Read file contents |
| `tools.function(write_file)` | Write files (requires approval) |
| `tools.function(list_dir)` | List directory contents |
| `guard.approve(...)` | Blocks writes to system paths |
| `guard.budget({ limit: 0.50 })` | Cost cap at $0.50 |
| `dev.console()` | Terminal lifecycle trace |

## Project structure

```
src/agent.ts              -- Agent definition with all middleware
tests/agent.agent.test.ts -- Agent tests using TestModel
```
