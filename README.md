# mintlify-mcp

> MCP server to query any Mintlify-powered documentation from Claude Code

[![npm version](https://img.shields.io/npm/v/mintlify-mcp.svg)](https://www.npmjs.com/package/mintlify-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

An MCP server that lets you query any documentation site powered by [Mintlify](https://mintlify.com) directly from Claude Code.

**Features:**
- 🔍 Ask questions about Agno, Resend, or any Mintlify docs
- 💻 Get code examples and explanations without leaving your terminal
- 🧠 Multi-turn conversations with memory
- 🔗 Links converted to absolute URLs (WebFetch compatible)
- 🏠 Local RAG mode for Mintlify documentation sites

## Quick Start

### Remote Mode (zero setup)

For documentation sites with [Mintlify AI Assistant](https://mintlify.com):

```bash
claude mcp add agno-assistant -- bunx mintlify-mcp -p agno-v2
```

Or add to your MCP settings:

```json
{
  "mcpServers": {
    "agno-assistant": {
      "command": "bunx",
      "args": ["mintlify-mcp", "-p", "agno-v2"]
    }
  }
}
```

### Local RAG Mode (Mintlify sites)

```bash
# One-time setup (discovers pages, starts server, seeds knowledge base)
bunx mintlify-mcp setup --url https://docs.example.com --id my-docs

# Add to Claude Code
claude mcp add my-docs -- bunx mintlify-mcp serve --project my-docs
```

Or add to your MCP settings:

```json
{
  "mcpServers": {
    "my-docs": {
      "command": "bunx",
      "args": ["mintlify-mcp", "serve", "--project", "my-docs"]
    }
  }
}
```

## Known Project IDs (Remote Mode)

| Documentation | Project ID | Status |
|--------------|------------|--------|
| [Agno](https://docs.agno.com) | `agno-v2` | Tested |
| [Resend](https://resend.com/docs) | `resend` | Tested |
| [Upstash](https://upstash.com/docs) | `upstash` | Tested |
| [Mintlify](https://mintlify.com/docs) | `mintlify` | Tested |
| [Vercel](https://vercel.com/docs) | `vercel` | Tested |
| [Plain](https://plain.com/docs) | `plain` | Tested |

> **Want to add more?** The project ID is usually the subdomain or company name. Open a PR or issue!

### Finding New Project IDs

1. Open the documentation site (e.g., `docs.agno.com`)
2. Open browser DevTools → Network tab
3. Use the search or AI assistant feature
4. Look for requests to `leaves.mintlify.com/api/assistant/{project-id}/message`

## CLI Commands

```bash
# Remote mode (Mintlify API)
bunx mintlify-mcp -p <project-id>

# Local RAG mode
bunx mintlify-mcp setup --url <docs-url> --id <project-id>
bunx mintlify-mcp serve --project <project-id>
bunx mintlify-mcp list
bunx mintlify-mcp stop --project <project-id>
```

Run `bunx mintlify-mcp --help` for all options.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGNO_HOST` | `127.0.0.1` | RAG server host |
| `AGNO_PORT` | `7777` | RAG server port |
| `OPENAI_API_KEY` | - | Required for local RAG mode |

## Requirements

- [Bun](https://bun.sh) runtime: `curl -fsSL https://bun.sh/install | bash`
- [Python 3.11+](https://python.org) with [uv](https://docs.astral.sh/uv/) (for local RAG mode)
- [OpenAI API key](https://platform.openai.com/api-keys) (for local RAG mode)

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐
│ Claude Code │────▶│ MCP Server  │────▶│ Remote: Mintlify API│
│             │◀────│ (this repo) │◀────│ Local: Agno + LanceDB│
└─────────────┘     └─────────────┘     └─────────────────────┘
```

**Remote Mode**: Proxies to Mintlify's AI Assistant API.

**Local Mode**: Self-hosted RAG with LanceDB vectors + OpenAI embeddings. Hybrid search (semantic + keyword).

## Project Structure

```
~/.mintlify-mcp/
├── projects/
│   └── <project-id>/
│       ├── config.yaml      # Project configuration
│       ├── lancedb/         # Vector database
│       └── logs/            # Server logs
└── global.yaml              # Global settings
```

## API Documentation

See [AGENT.md](./AGENT.md) for complete documentation including:
- Architecture details
- Backend implementations
- Reverse-engineered Mintlify API docs
- Enterprise deployment guides

## License

MIT - See [LICENSE](./LICENSE)

## Contributing

PRs welcome! To add a new documentation site:
1. Add the project ID to `KNOWN_DOCS` in `src/index.ts`
2. Update the table above
3. Submit a PR

## Acknowledgments

- [Mintlify](https://mintlify.com) ([GitHub](https://github.com/mintlify)) for building amazing documentation tooling
- [Anthropic](https://anthropic.com) for Claude and the MCP protocol
- [Agno](https://agno.com) for the RAG framework
