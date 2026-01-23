# Contributing to Docmole

Thanks for your interest in contributing to Docmole! This guide will help you understand the codebase and contribute effectively.

## Quick Start

```bash
# Clone and install
git clone https://github.com/Vigtu/docmole.git
cd docmole
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Lint and format
bun run lint
```

**Requirements**: [Bun](https://bun.sh) >= 1.0.0

## Development Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run dev` | Run with hot reload |
| `bun test` | Run all tests |
| `bun test tests/embedded.test.ts` | Run single test file |
| `bun run typecheck` | Type check (tsc --noEmit) |
| `bun run lint` | Lint + format with Biome |

## Architecture Overview

Docmole is an MCP server with three operation modes:

```
┌─────────────────────────────────────────────────────────────┐
│                      docmole CLI                             │
│                    (src/index.ts)                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │ Mintlify  │   │ Embedded  │   │   Agno    │
     │  Backend  │   │  Backend  │   │  Backend  │
     │ (API)     │   │ (LanceDB) │   │ (Python)  │
     └───────────┘   └───────────┘   └───────────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                    ┌──────▼──────┐
                    │ MCP Server  │
                    │(src/server) │
                    └─────────────┘
```

### Key Modules

| Directory | Purpose |
|-----------|---------|
| `src/backends/` | Backend implementations |
| `src/backends/embedded/` | Pure TypeScript RAG (LanceDB + OpenAI) |
| `src/cli/` | CLI commands (setup, serve, list, etc.) |
| `src/config/` | YAML config management (`~/.docmole/`) |
| `src/discovery/` | Page discovery (sitemap.xml, mint.json) |
| `src/security/` | URL validation, input sanitization |
| `src/server.ts` | MCP server exposing `ask` and `clear_history` |

### Backend Interface

All backends implement this interface:

```typescript
interface Backend {
  readonly name: string;
  readonly projectId: string;
  ask(question: string): Promise<AskResult>;
  clearHistory(): void;
  isAvailable(): Promise<boolean>;
}
```

## Adding a New Backend

1. **Add backend type** to `src/config/schema.ts`:
   ```typescript
   export const BACKEND_TYPES = ["mintlify", "embedded", "agno", "your-backend"] as const;
   ```

2. **Create backend file** at `src/backends/your-backend.ts`:
   ```typescript
   import type { Backend, BackendFactory, AskResult } from "./types";

   class YourBackend implements Backend {
     readonly name = "your-backend";
     constructor(readonly projectId: string) {}

     async ask(question: string): Promise<AskResult> {
       // Implementation
       return { answer: "..." };
     }

     clearHistory(): void {}

     async isAvailable(): Promise<boolean> {
       return true;
     }
   }

   export const backendFactory: BackendFactory = {
     create: async (projectId, config) => new YourBackend(projectId),
   };
   ```

3. **Backend loads automatically** via `src/backends/registry.ts` (no manual registration).

## Testing Guidelines

### File Organization

```
tests/
├── config.test.ts        # src/config/*
├── mintlify-api.test.ts  # src/backends/mintlify.ts
├── embedded.test.ts      # src/backends/embedded/*
├── security.test.ts      # src/security/*
└── <module>.test.ts      # One file per major module
```

### Good Tests

```typescript
// Integration with real systems
test("persists data across instances", async () => {
  const kb1 = await createKnowledge(path, embedder);
  await kb1.addDocument({ name: "doc", content: "test" });
  await kb1.close();

  const kb2 = await createKnowledge(path, embedder);
  expect(await kb2.countDocuments()).toBe(1);
});

// Business logic that can fail
test("deduplicates by source URL (max 2 chunks)", async () => {
  // Tests actual deduplication logic
});

// Error handling
test("handles errors gracefully", async () => {
  const mock = { retrieve: async () => { throw new Error("fail"); } };
  const result = await tool.execute({ query: "test" });
  expect(result.success).toBe(false);
});
```

### Bad Tests (Avoid)

```typescript
// Testing hardcoded values
test("default model is gpt-4o-mini", () => {
  expect(config.model).toBe("gpt-4o-mini"); // Changes aren't bugs
});

// Testing library behavior
test("LanceDB returns array", () => {
  expect(Array.isArray(results)).toBe(true); // Test YOUR code
});
```

### Integration Tests

Skip if dependencies unavailable:

```typescript
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAIKey)("OpenAI Integration", () => {
  setDefaultTimeout(60_000); // API calls are slow
  // ...
});
```

### Mocking

```typescript
// Type-safe mocks
type MockKnowledge = Pick<EmbeddedKnowledge, "search">;

const mock: MockKnowledge = {
  search: async () => [{ name: "doc", content: "test", metadata: {} }],
};

const retriever = new Retriever(mock as unknown as EmbeddedKnowledge);
```

## Code Style

- **Formatter**: Biome (double quotes, semicolons)
- **TypeScript**: Strict mode enabled
- **Imports**: Auto-organized by Biome

Run `bun run lint` to auto-fix formatting issues.

## Project Structure Conventions

| Pattern | Convention |
|---------|------------|
| Backend file | `src/backends/{type}.ts` exports `backendFactory` |
| CLI command | `src/cli/{name}.ts` |
| Config schema | `src/config/schema.ts` is the SSOT |
| Test file | `tests/{module}.test.ts` |

## Key Technical Decisions

### TypeScript as Source of Truth

Config schemas are defined in TypeScript (`src/config/schema.ts`), not JSON/YAML. This ensures type safety and IDE autocomplete.

### Security by Default

All external inputs are validated:
- **URLs**: SSRF protection (no `file://`, private IPs)
- **Project IDs**: Path traversal prevention (alphanumeric + dash/underscore)

See `src/security/` for implementations.

### Graceful Degradation

Backend registry returns errors instead of throwing:

```typescript
const result = await loadBackend("embedded");
if (!result.success) {
  console.error(result.error.message);
  console.error(result.error.suggestion);
}
```

## Understanding the Mintlify Backend

The Mintlify backend (`src/backends/mintlify.ts`) reverse-engineers Mintlify's AI Assistant API.

**Key details** (see `docs/reverse-engineering-mintlify-api.md`):
- Endpoint: `POST https://leaves.mintlify.com/api/assistant/{project-id}/message`
- Response: SSE stream with prefixes (`0:` = text, `a:` = tool results)
- Only parse `0:` chunks to avoid context window bloat (97% reduction)

## Pull Request Process

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make changes** and add tests if applicable

3. **Run checks**:
   ```bash
   bun test
   bun run typecheck
   bun run lint
   ```

4. **Commit** with conventional commits:
   ```bash
   git commit -m "feat: add support for X"
   ```

   Prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature
   ```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for embedded backend tests |
| `DOCMOLE_DATA_DIR` | Override data directory (default: `~/.docmole`) |
| `DOCMOLE_ALLOW_LOCALHOST` | Allow localhost URLs (dev mode) |

## Documentation

| Document | When to Read |
|----------|--------------|
| `AGENT.md` | Architecture overview |
| `docs/architecture-plan.md` | Design decisions, roadmap |
| `docs/reverse-engineering-mintlify-api.md` | Mintlify backend details |
| `docs/enterprise-requirements.md` | Enterprise features |
| `docs/universal-docs-support.md` | Generic docs site support |

## Questions?

Open an issue for discussion before starting work on major changes.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
