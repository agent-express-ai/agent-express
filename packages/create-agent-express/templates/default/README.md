# My Agent

A simple AI agent built with [Agent Express](https://github.com/agent-express/agent-express).

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

## What's included

- A simple assistant agent with a `get_weather` tool
- Test file using `TestModel` (no API key needed for tests)

## Project structure

```
src/agent.ts              -- Agent definition
tests/agent.agent.test.ts -- Agent tests
```
