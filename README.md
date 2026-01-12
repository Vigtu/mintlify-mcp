# mintlify-mcp

> MCP server to query any Mintlify-powered documentation from Claude Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

An MCP server that lets you query any documentation site powered by [Mintlify](https://mintlify.com) directly from Claude Code.

**Example use cases:**
- Ask questions about Agno, Resend, or any Mintlify docs
- Get code examples and explanations without leaving your terminal
- Multi-turn conversations with documentation context

## Quick Start

### Recommended: Specialized Mode

Create a dedicated MCP for each documentation site:

```bash
claude mcp add agno -- bunx mintlify-mcp --project agno-v2
```

Or add to your settings manually:

```json
{
  "mcpServers": {
    "agno": {
      "command": "bunx",
      "args": ["mintlify-mcp", "--project", "agno-v2"]
    }
  }
}
```

Now when you say **"search for workflows"**, Claude knows to use the `agno` MCP!

**Tools available:**
- `ask` - Ask any question about the docs
- `clear_history` - Reset conversation

### Multiple Documentation Sites

```bash
claude mcp add agno -- bunx mintlify-mcp -p agno-v2
claude mcp add resend -- bunx mintlify-mcp -p resend
```

Or in settings:

```json
{
  "mcpServers": {
    "agno": {
      "command": "bunx",
      "args": ["mintlify-mcp", "-p", "agno-v2"]
    },
    "resend": {
      "command": "bunx",
      "args": ["mintlify-mcp", "-p", "resend"]
    }
  }
}
```

### Generic Mode

Query any Mintlify docs without pre-configuration:

```bash
claude mcp add mintlify -- bunx mintlify-mcp
```

Or in settings:

```json
{
  "mcpServers": {
    "mintlify": {
      "command": "bunx",
      "args": ["mintlify-mcp"]
    }
  }
}
```

**Tools available:**
- `ask_docs` - Query docs (requires `project_id`)
- `list_docs` - Show known documentation sites
- `clear_conversation` - Reset history

## Known Project IDs

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

## CLI Options

```bash
bunx mintlify-mcp --help

OPTIONS:
  -p, --project <id>    Lock to a specific project ID
  -n, --name <name>     Custom display name
  -h, --help            Show help
```

## Requirements

- [Bun](https://bun.sh) runtime: `curl -fsSL https://bun.sh/install | bash`

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐
│ Claude Code │────▶│ MCP Server  │────▶│ Mintlify Assistant  │
│             │◀────│ (this repo) │◀────│ API (RAG Pipeline)  │
└─────────────┘     └─────────────┘     └─────────────────────┘
```

1. You ask a question in Claude Code
2. MCP server forwards to Mintlify's AI Assistant API
3. Mintlify searches documentation using RAG
4. Response streams back to Claude Code

**Context Optimization:** The server extracts only the assistant's text from SSE responses, reducing ~50-100KB raw responses to ~1KB (99% reduction!).

## API Documentation

See [CLAUDE.md](./CLAUDE.md) for complete reverse-engineered API documentation including:
- Endpoint details and schemas
- Request/response formats
- cURL examples
- Multi-turn conversation support

## License

MIT - See [LICENSE](./LICENSE)

## Contributing

PRs welcome! To add a new documentation site:
1. Add the project ID to `KNOWN_DOCS` in `src/index.ts`
2. Update the table above
3. Submit a PR

## Acknowledgments

- [Mintlify](https://mintlify.com) for building amazing documentation tooling
- [Anthropic](https://anthropic.com) for Claude and the MCP protocol
