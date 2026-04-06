# Contributing to agent-express

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js 20+
- npm

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/agent-express-ai/agent-express.git`
3. Install dependencies: `npm install`

## Development

```bash
npm run build       # Build with tsup
npm test            # Run tests (vitest)
npm run typecheck   # Type check (tsc --noEmit)
npx eslint .        # Lint
```

## Making Changes

1. Create a branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes
3. Ensure all checks pass: build, tests, typecheck, and lint
4. Commit and push your branch

## Pull Request Guidelines

- Describe **what** changed and **why**
- One feature or fix per PR
- All checks must pass (tests, typecheck, lint)
- Add tests for bug fixes and new features
- Keep PRs focused and reasonably sized

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, dependencies
- `docs:` — documentation only
- `test:` — adding or updating tests
- `refactor:` — code change that neither fixes a bug nor adds a feature

Examples:

```
feat: add guard.rateLimit() middleware
fix: prevent session state mutation after close
docs: update middleware hook examples
```

## Code Style

- **Prettier** handles formatting
- **ESLint** handles linting
- **TypeScript** strict mode, ESM only
- All public APIs must have TSDoc comments

## Questions?

Open a [GitHub Discussion](https://github.com/agent-express-ai/agent-express/discussions) or [issue](https://github.com/agent-express-ai/agent-express/issues).
