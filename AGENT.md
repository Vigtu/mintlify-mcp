# mintlify-mcp

MCP server to chat with any Mintlify-powered documentation via Claude Code.

## Project Overview

This MCP server provides a bridge to Mintlify's AI Assistant API, allowing users to query any documentation site powered by Mintlify directly from Claude Code.

## Mintlify AI Assistant API - Reverse Engineering Documentation

### Endpoint

```
POST https://leaves.mintlify.com/api/assistant/{project-id}/message
```

**Example for Agno docs:**
```
POST https://leaves.mintlify.com/api/assistant/agno-v2/message
```

### Project ID Discovery

The `project-id` can be found by:
1. Opening the documentation site (e.g., `docs.agno.com`)
2. Opening browser DevTools > Network tab
3. Using the search/AI assistant feature
4. Looking for requests to `leaves.mintlify.com`
5. The project ID is in the URL path: `/api/assistant/{project-id}/message`

**Known Project IDs:**
| Documentation | Project ID | URL |
|--------------|------------|-----|
| Agno | `agno-v2` | https://docs.agno.com |
| Resend | `resend` | https://resend.com/docs |
| Upstash | `upstash` | https://upstash.com/docs |
| Mintlify | `mintlify` | https://mintlify.com/docs |
| Vercel | `vercel` | https://vercel.com/docs |
| Plain | `plain` | https://plain.com/docs |

### Headers

**Required:**
```http
Content-Type: application/json
```

**Recommended (for CORS compliance):**
```http
Origin: https://{docs-domain}
Referer: https://{docs-domain}/
User-Agent: Mozilla/5.0 (compatible)
```

### Request Body Schema

```typescript
interface MessageRequest {
  id: string;           // Project ID (e.g., "agno-v2")
  fp: string;           // Fingerprint - same as project ID
  messages: Message[];  // Conversation history
  threadId?: string;    // Optional thread ID for conversation continuity
}

interface Message {
  id: string;           // Unique message ID (can be "1", "2", etc.)
  role: "user" | "assistant";
  content: string;      // The message text
  createdAt: string;    // ISO 8601 timestamp
  parts: MessagePart[]; // Message parts array
}

interface MessagePart {
  type: "text" | "step-start" | "tool-invocation";
  text?: string;        // For type: "text"
  toolInvocation?: {    // For type: "tool-invocation"
    state: "result";
    step: number;
    toolCallId: string;
    toolName: string;
    args: object;
    result: object;
  };
}
```

### Minimal Request Example

```json
{
  "id": "agno-v2",
  "fp": "agno-v2",
  "messages": [
    {
      "id": "1",
      "role": "user",
      "content": "what is an agent?",
      "createdAt": "2026-01-12T12:00:00.000Z",
      "parts": [
        {
          "type": "text",
          "text": "what is an agent?"
        }
      ]
    }
  ]
}
```

### Multi-turn Conversation Example

**IMPORTANT:** For multi-turn conversations, you must:
1. Omit `threadId` on the first request
2. Capture `X-Thread-Id` from the response header
3. Include that `threadId` in subsequent requests
4. Format assistant messages with `step-start` part and `revisionId`

```json
{
  "id": "agno-v2",
  "fp": "agno-v2",
  "threadId": "01KES7GWVAX9S3QD2EXJGWSVPM",
  "messages": [
    {
      "id": "abc123xyz",
      "role": "user",
      "content": "what is an agent?",
      "createdAt": "2026-01-12T12:00:00.000Z",
      "parts": [{"type": "text", "text": "what is an agent?"}]
    },
    {
      "id": "msg-def456abc",
      "role": "assistant",
      "content": "An Agent is an AI program...",
      "createdAt": "2026-01-12T12:00:05.000Z",
      "parts": [{"type": "step-start"}, {"type": "text", "text": "An Agent is an AI program..."}],
      "revisionId": "rev123"
    },
    {
      "id": "ghi789xyz",
      "role": "user",
      "content": "how do I create one?",
      "createdAt": "2026-01-12T12:01:00.000Z",
      "parts": [{"type": "text", "text": "how do I create one?"}]
    }
  ]
}
```

### Response Format (SSE)

The response is a **streaming** SSE (Server-Sent Events) response.

**Response Headers:**
```http
Content-Type: text/plain; charset=utf-8
Transfer-Encoding: chunked
X-Thread-Id: 01KES7GWVAX9S3QD2EXJGWSVPM
```

**IMPORTANT:** Capture `X-Thread-Id` from the response header and include it in subsequent requests to maintain conversation context.

**SSE Line Prefixes:**
| Prefix | Content | Size | Action |
|--------|---------|------|--------|
| `f:` | Message metadata (messageId) | ~100B | Skip |
| `9:` | Tool calls (search query) | ~200B | Skip |
| `a:` | Tool results (FULL docs pages) | **~50-100KB** | **SKIP!** |
| `0:` | Text chunks (actual response) | ~1-3KB | **KEEP** |
| `e:` | Finish metadata (tokens used) | ~100B | Skip |
| `d:` | Done signal | ~50B | Skip |

**Raw SSE Example:**
```
f:{"messageId":"msg-abc123"}
9:{"toolCallId":"toolu_xyz","toolName":"search","args":{"query":"what is agent"}}
a:{"toolCallId":"toolu_xyz","result":{"type":"search","results":[...50KB OF DOCS...]}}
0:"An"
0:" Agent"
0:" is"
0:" an"
0:" AI"
0:" program"
0:"."
e:{"finishReason":"stop","usage":{"promptTokens":15000,"completionTokens":200}}
d:{"finishReason":"stop"}
```

### Context Window Optimization

**CRITICAL:** The `a:` chunks contain ENTIRE documentation pages (~50-100KB) that were searched.
This would **destroy** the Claude Code context window if returned raw.

**Solution:** Only parse `0:` chunks (the actual assistant response text).

```typescript
// Only keep "0:" chunks - the actual response text
if (line.startsWith("0:")) {
  const text = JSON.parse(line.slice(2));
  textChunks.push(text);
}
// SKIP: f:, 9:, a:, e:, d: (metadata and search results)
```

**Result:**
- Raw response: ~50-100KB
- Parsed response: ~1-3KB (97% reduction!)

### cURL Examples

**Simple Query:**
```bash
curl -X POST 'https://leaves.mintlify.com/api/assistant/agno-v2/message' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://docs.agno.com' \
  -H 'Referer: https://docs.agno.com/' \
  -d '{
    "id": "agno-v2",
    "fp": "agno-v2",
    "messages": [
      {
        "id": "1",
        "role": "user",
        "content": "what is an agent?",
        "createdAt": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'",
        "parts": [{"type": "text", "text": "what is an agent?"}]
      }
    ]
  }'
```

**With Dynamic Timestamp (Bash):**
```bash
QUESTION="how do I create a workflow?"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

curl -X POST 'https://leaves.mintlify.com/api/assistant/agno-v2/message' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "agno-v2",
    "fp": "agno-v2",
    "messages": [{
      "id": "1",
      "role": "user",
      "content": "'"$QUESTION"'",
      "createdAt": "'"$TIMESTAMP"'",
      "parts": [{"type": "text", "text": "'"$QUESTION"'"}]
    }]
  }'
```

### How It Works (RAG Pipeline)

1. **User Query**: User sends a question
2. **Search**: Mintlify searches documentation chunks using semantic search (`api.mintlifytrieve.com`)
3. **Context Retrieval**: Relevant documentation pages are fetched
4. **LLM Generation**: An LLM generates a response based on the retrieved context
5. **Response**: Streamed response with citations and suggestions

### Related Endpoints

**Autocomplete/Search:**
```
POST https://api.mintlifytrieve.com/api/chunk_group/group_oriented_autocomplete
```

**Analytics Events:**
```
POST https://docs.{domain}/_mintlify/api/v1/e
```

### Authentication

**No authentication required!** The API is publicly accessible. However:
- Rate limiting may apply
- Some documentation sites may have restrictions
- Always respect the documentation site's terms of service

### Error Handling

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (invalid JSON or missing fields) |
| 404 | Project ID not found |
| 429 | Rate limited |
| 500 | Server error |

### Known Limitations

1. **Streaming Response**: The response is streamed, not a single JSON object
2. **Context Window**: Very long conversations may be truncated
3. **Rate Limits**: Unknown, but likely exists
4. **Project Discovery**: Need to manually find project IDs

## MCP Implementation

### Tools

```typescript
// Tool 1: Ask a question to documentation
interface AskTool {
  name: "ask";
  description: "Ask a question about {projectName} documentation";
  parameters: {
    question: string;
  };
}

// Tool 2: Clear conversation history
interface ClearHistoryTool {
  name: "clear_history";
  description: "Clear conversation history to start fresh";
}
```

### CLI Usage

```bash
# Required: specify project ID
bunx mintlify-mcp --project agno-v2

# Optional: custom display name
bunx mintlify-mcp -p agno-v2 -n "Agno Docs"
```

## Development Commands

```bash
# Install dependencies
bun install

# Run directly (no build needed!)
bun src/index.ts

# Run with hot reload
bun --watch src/index.ts

# Run tests
bun test

# Type check
bun run typecheck
```

## Tech Stack

- **Runtime**: Bun (executes TypeScript natively)
- **Language**: TypeScript
- **MCP SDK**: @modelcontextprotocol/sdk
- **HTTP Client**: Native fetch

## License

MIT
