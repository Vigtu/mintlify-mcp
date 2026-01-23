# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Run with hot reload
bun run test         # Run tests
bun run typecheck    # Type check
bun run lint         # Lint + format (auto-fix)
```

**Run single test:**
```bash
bun test tests/mintlify-api.test.ts
```

## Architecture

### Three Operation Modes

1. **Mintlify API Mode** (`-p <project-id>`) - Proxies Mintlify's AI Assistant API for sites with built-in assistants
2. **Embedded Mode** (`setup` + `serve`, default) - Pure TypeScript RAG with LanceDB, no Python needed
3. **Agno Mode** (`setup --backend agno`) - Python RAG server for enterprise/advanced use cases

### Core Flow

```
CLI (src/index.ts) → Backend (mintlify|embedded|agno) → MCP Server (src/server.ts)
                          ↓
                   Backend Interface
                   - ask(question): AskResult
                   - clearHistory(): void
                   - isAvailable(): boolean
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/backends/` | Backend implementations (Mintlify API, Embedded, Agno) |
| `src/backends/registry.ts` | Dynamic backend loading with graceful fallbacks |
| `src/backends/embedded/` | Pure TypeScript RAG with LanceDB + AI SDK |
| `src/cli/` | CLI commands (setup, serve, start, stop, seed, list) |
| `src/config/` | Project config YAML storage in `~/.docmole/` |
| `src/config/schema.ts` | Backend types (`BACKEND_TYPES`) and project config schema |
| `src/discovery/` | Sitemap/mint.json parsing for page discovery |
| `src/server.ts` | MCP server exposing `ask` and `clear_history` tools |

### Backend Registry

Backends load dynamically via `src/backends/registry.ts`. To add a new backend:

1. Add to `BACKEND_TYPES` in `src/config/schema.ts`
2. Create `src/backends/{name}.ts` exporting `backendFactory`

Convention: module path = `./${type}` (no manual mapping needed).

### Config Storage

Projects stored at `~/.docmole/projects/<id>/config.yaml`. Schema in `src/config/schema.ts`.

## MCP Tools

```typescript
// Tool 1: Ask a question to documentation
interface AskTool {
  name: "ask";
  description: "Ask a question about {projectName} documentation";
  parameters: { question: string };
}

// Tool 2: Clear conversation history
interface ClearHistoryTool {
  name: "clear_history";
  description: "Clear conversation history to start fresh";
}
```

## CLI Usage

```bash
# Mintlify API mode (for sites with built-in AI Assistant)
bunx docmole -p agno-v2

# Embedded mode (default, requires OPENAI_API_KEY)
bunx docmole setup --url https://docs.example.com --id my-docs
bunx docmole serve --project my-docs

# Local mode with Ollama (no API key needed)
bunx docmole setup --url https://docs.example.com --id my-docs --local

# Legacy Agno mode (Python server)
bunx docmole setup --url https://docs.example.com --id my-docs --backend agno
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key (*not needed with `--local` flag) |
| `DOCMOLE_DATA_DIR` | No | Override data directory (default: `~/.docmole`) |

## Tech Stack

- **Runtime**: Bun (executes TypeScript natively)
- **Language**: TypeScript
- **MCP SDK**: @modelcontextprotocol/sdk
- **HTTP Client**: Native fetch

## Detailed Documentation

### Business & Product

When understanding the product vision, target audiences, or value proposition:

@docs/business-value-proposition.md

### Enterprise Requirements

When working on enterprise features, compliance, security, or data governance:

@docs/enterprise-requirements.md

### Mintlify Backend (reverse engineering)

When debugging, modifying, or understanding the Mintlify API integration in `src/backends/mintlify.ts`:

@docs/reverse-engineering-mintlify-api.md

### Architecture Planning

When planning new features, understanding design decisions, or implementing new backends:

@docs/architecture-plan.md

### Enterprise Deployment (technical)

For production deployment architectures, Docker/K8s configs, and infrastructure:

@docs/enterprise-architecture.md

### Universal Documentation Support

When implementing support for generic documentation sites, the hybrid approach (Option C), or Phase 1/Phase 2 features:

@docs/universal-docs-support.md
