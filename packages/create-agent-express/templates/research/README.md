# Research Agent

A research agent that searches the web and synthesizes reports, built with [Agent Express](https://github.com/agent-express/agent-express).

## Features

- **Web search** -- Searches for information (replace fake data with SerpAPI, Tavily, etc.)
- **Report generation** -- Synthesizes findings into structured markdown reports
- **Model routing** -- Uses cheaper models for simple queries, powerful models for synthesis
- **PII redaction** -- Automatically redacts email addresses and phone numbers from output
- **Turn timeout** -- 30-second safety limit per turn

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
| `tools.function(web_search)` | Web search (fake results) |
| `tools.function(save_report)` | Save markdown reports |
| `model.router(...)` | Route by complexity tier |
| `guard.output(...)` | Redact PII (email, phone) |
| `guard.timeout(...)` | 30s turn timeout |

## Project structure

```
src/agent.ts              -- Agent definition with all middleware
tests/agent.agent.test.ts -- Agent tests using FunctionModel
```
