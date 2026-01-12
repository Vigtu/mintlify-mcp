#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// KNOWN DOCUMENTATION SITES
// =============================================================================

const KNOWN_DOCS: Record<string, { name: string; domain: string }> = {
  "agno-v2": { name: "Agno", domain: "docs.agno.com" },
  resend: { name: "Resend", domain: "resend.com/docs" },
  upstash: { name: "Upstash", domain: "upstash.com/docs" },
  mintlify: { name: "Mintlify", domain: "mintlify.com/docs" },
  vercel: { name: "Vercel", domain: "vercel.com/docs" },
  plain: { name: "Plain", domain: "plain.com/docs" },
};

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

interface CLIConfig {
  projectId: string;
  projectName: string;
}

function parseArgs(): CLIConfig {
  const args = process.argv.slice(2);
  let projectId: string | undefined;
  let projectName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" || args[i] === "-p") {
      projectId = args[i + 1];
      i++;
    } else if (args[i] === "--name" || args[i] === "-n") {
      projectName = args[i + 1];
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
mintlify-mcp - Query Mintlify-powered documentation from Claude Code

USAGE:
  bunx mintlify-mcp --project <id> [options]

OPTIONS:
  -p, --project <id>    Mintlify project ID (required)
  -n, --name <name>     Custom display name (default: auto-detected)
  -h, --help            Show this help message

KNOWN PROJECT IDs:
${Object.entries(KNOWN_DOCS)
  .map(([id, info]) => `  ${id.padEnd(12)} ${info.name}`)
  .join("\n")}

EXAMPLES:
  bunx mintlify-mcp --project agno-v2
  bunx mintlify-mcp -p resend -n "Resend Email"

CLAUDE CODE CONFIGURATION:
  claude mcp add agno-assistant -- bunx mintlify-mcp -p agno-v2

  Or in settings.json:
  {
    "mcpServers": {
      "agno-assistant": {
        "command": "bunx",
        "args": ["mintlify-mcp", "-p", "agno-v2"]
      }
    }
  }
`);
      process.exit(0);
    }
  }

  if (!projectId) {
    console.error("Error: --project <id> is required\n");
    console.error("Usage: bunx mintlify-mcp --project <project-id>");
    console.error("       bunx mintlify-mcp --help for more info");
    process.exit(1);
  }

  // Auto-detect name from known docs if not provided
  if (!projectName) {
    projectName = KNOWN_DOCS[projectId]?.name || projectId;
  }

  return { projectId, projectName };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = parseArgs();
const MINTLIFY_API_BASE = "https://leaves.mintlify.com/api/assistant";
const SERVER_NAME = `${CONFIG.projectName} AI Assistant`;

// =============================================================================
// TYPES
// =============================================================================

interface MessagePart {
  type: string;
  text?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  parts: MessagePart[];
  revisionId?: string;
}

interface ConversationState {
  messages: Message[];
  threadId?: string;
}

interface AskResult {
  answer: string;
  threadId?: string;
  messageId?: string;
}

// Store conversation state
let conversationState: ConversationState = {
  messages: [],
  threadId: undefined,
};

// =============================================================================
// UTILITIES
// =============================================================================

function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// =============================================================================
// MINTLIFY API
// =============================================================================

async function askMintlify(question: string): Promise<AskResult> {
  const domain =
    KNOWN_DOCS[CONFIG.projectId]?.domain || `${CONFIG.projectId}.mintlify.app`;
  const timestamp = new Date().toISOString();

  const newMessage: Message = {
    id: generateId(),
    role: "user",
    content: question,
    createdAt: timestamp,
    parts: [{ type: "text", text: question }],
  };

  const messages = [...conversationState.messages, newMessage];

  const requestBody: Record<string, unknown> = {
    id: CONFIG.projectId,
    fp: CONFIG.projectId,
    messages,
  };

  if (conversationState.threadId) {
    requestBody.threadId = conversationState.threadId;
  }

  const response = await fetch(
    `${MINTLIFY_API_BASE}/${CONFIG.projectId}/message`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `https://${domain}`,
        Referer: `https://${domain}/`,
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Mintlify API error: ${response.status} ${response.statusText}`,
    );
  }

  const newThreadId =
    response.headers.get("X-Thread-Id") || conversationState.threadId;
  const text = await response.text();
  const baseUrl = `https://${domain}`;
  const { answer, messageId } = parseStreamedResponse(text, baseUrl);

  return { answer, threadId: newThreadId, messageId };
}

/**
 * Parse SSE response - extract text chunks (0:) and messageId (f:)
 * Skips: 9: (tool calls), a: (search results ~50-100KB), e: (finish), d: (done)
 */
function parseStreamedResponse(
  rawResponse: string,
  baseUrl: string,
): { answer: string; messageId?: string } {
  const lines = rawResponse.split("\n");
  const textChunks: string[] = [];
  let messageId: string | undefined;

  for (const line of lines) {
    if (line.startsWith("f:")) {
      try {
        const metadata = JSON.parse(line.slice(2));
        messageId = metadata.messageId;
      } catch {
        // Ignore parse errors
      }
    } else if (line.startsWith("0:")) {
      try {
        const text = JSON.parse(line.slice(2));
        if (typeof text === "string") {
          textChunks.push(text);
        }
      } catch {
        const text = line.slice(2).replace(/^"|"$/g, "");
        if (text) textChunks.push(text);
      }
    }
  }

  let answer =
    textChunks.join("").trim() ||
    "No response generated. Please try rephrasing your question.";

  // Fix markdown links and convert to absolute URLs for Claude Code WebFetch compatibility
  answer = fixMarkdownLinks(answer, baseUrl);

  return { answer, messageId };
}

/**
 * Fix markdown links in response:
 * 1. Correct inverted format: (text)[/path] → [text](/path)
 * 2. Convert relative URLs to absolute: [text](/path) → [text](https://domain/path)
 */
function fixMarkdownLinks(text: string, baseUrl: string): string {
  // Fix inverted markdown links: (text)[url] → [text](url)
  let fixed = text.replace(/\(([^)]+)\)\[([^\]]+)\]/g, "[$1]($2)");

  // Convert relative URLs to absolute (only for paths starting with /)
  // Matches: [any text](/path) but not [text](https://...) or [text](http://...)
  fixed = fixed.replace(/\[([^\]]+)\]\(\/([^)]+)\)/g, `[$1](${baseUrl}/$2)`);

  return fixed;
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
  {
    name: SERVER_NAME,
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// =============================================================================
// TOOLS
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ask",
        description: `Ask a question about ${CONFIG.projectName} documentation. The AI will search the docs and provide a relevant answer with code examples.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            question: {
              type: "string",
              description: `Your question about ${CONFIG.projectName}`,
            },
          },
          required: ["question"],
        },
      },
      {
        name: "clear_history",
        description: "Clear conversation history to start fresh",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  };
});

// =============================================================================
// TOOL HANDLERS
// =============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "ask": {
      const { question } = args as { question: string };

      try {
        const result = await askMintlify(question);

        // Update state
        conversationState.threadId = result.threadId;
        const timestamp = new Date().toISOString();
        conversationState.messages.push({
          id: generateId(),
          role: "user",
          content: question,
          createdAt: timestamp,
          parts: [{ type: "text", text: question }],
        });
        conversationState.messages.push({
          id: result.messageId || `msg-${generateId()}`,
          role: "assistant",
          content: result.answer,
          createdAt: new Date().toISOString(),
          parts: [
            { type: "step-start" },
            { type: "text", text: result.answer },
          ],
          revisionId: generateId(),
        });

        return { content: [{ type: "text", text: result.answer }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }

    case "clear_history": {
      conversationState = { messages: [], threadId: undefined };
      return {
        content: [{ type: "text", text: "Conversation history cleared." }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// =============================================================================
// START SERVER
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} running`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
