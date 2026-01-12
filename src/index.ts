#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// CLI ARGUMENT PARSING - Enables specialized MCP instances
// =============================================================================

interface CLIConfig {
  projectId?: string;
  projectName?: string;
  isLocked: boolean;
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
  bunx mintlify-mcp [options]

OPTIONS:
  -p, --project <id>    Lock to a specific Mintlify project ID
  -n, --name <name>     Custom display name (default: project name or "Mintlify")
  -h, --help            Show this help message

EXAMPLES:
  # Generic mode - query any Mintlify docs
  bunx mintlify-mcp

  # Specialized mode - locked to Agno docs
  bunx mintlify-mcp --project agno-v2

CLAUDE CODE CONFIGURATION:

  Generic (multi-docs):
  {
    "mcpServers": {
      "mintlify": {
        "command": "bunx",
        "args": ["mintlify-mcp"]
      }
    }
  }

  Specialized (single-doc, recommended):
  {
    "mcpServers": {
      "agno": {
        "command": "bunx",
        "args": ["mintlify-mcp", "--project", "agno-v2"]
      }
    }
  }

  Multiple specialized:
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
`);
      process.exit(0);
    }
  }

  const isLocked = !!projectId;

  // Auto-detect name from known docs if not provided
  if (projectId && !projectName) {
    projectName = KNOWN_DOCS[projectId]?.name;
  }

  return { projectId, projectName, isLocked };
}

// =============================================================================
// KNOWN DOCUMENTATION SITES
// =============================================================================

const KNOWN_DOCS: Record<string, { name: string; domain: string }> = {
  "agno-v2": { name: "Agno", domain: "docs.agno.com" },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = parseArgs();
const MINTLIFY_API_BASE = "https://leaves.mintlify.com/api/assistant";

// Server name changes based on mode
const SERVER_NAME = CONFIG.isLocked
  ? `${CONFIG.projectName || CONFIG.projectId}-docs`
  : "mintlify-mcp";

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
  revisionId?: string; // Required for assistant messages
}

interface ConversationState {
  messages: Message[];
  threadId?: string; // Obtained from X-Thread-Id response header
}

interface AskResult {
  answer: string;
  threadId?: string;
  messageId?: string;
}

// Store conversation state per project
const conversations: Map<string, ConversationState> = new Map();

// =============================================================================
// UTILITIES
// =============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// =============================================================================
// MINTLIFY API
// =============================================================================

async function askMintlify(
  projectId: string,
  question: string,
  conversationHistory: Message[] = [],
  threadId?: string
): Promise<AskResult> {
  const domain = KNOWN_DOCS[projectId]?.domain || `${projectId}.mintlify.app`;
  const timestamp = new Date().toISOString();

  const newMessage: Message = {
    id: generateId(),
    role: "user",
    content: question,
    createdAt: timestamp,
    parts: [{ type: "text", text: question }],
  };

  const messages = [...conversationHistory, newMessage];

  // Build request body - only include threadId if we have one from a previous response
  const requestBody: Record<string, unknown> = {
    id: projectId,
    fp: projectId,
    messages,
  };

  if (threadId) {
    requestBody.threadId = threadId;
  }

  const response = await fetch(`${MINTLIFY_API_BASE}/${projectId}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `https://${domain}`,
      Referer: `https://${domain}/`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(
      `Mintlify API error: ${response.status} ${response.statusText}`
    );
  }

  // Capture X-Thread-Id from response header for subsequent requests
  const newThreadId = response.headers.get("X-Thread-Id") || threadId;

  const text = await response.text();
  const { answer, messageId } = parseStreamedResponse(text);

  return { answer, threadId: newThreadId, messageId };
}

/**
 * Parse SSE response - extract text chunks (0:) and messageId (f:)
 * Skips: 9: (tool calls), a: (search results ~50-100KB), e: (finish), d: (done)
 */
function parseStreamedResponse(rawResponse: string): { answer: string; messageId?: string } {
  const lines = rawResponse.split("\n");
  const textChunks: string[] = [];
  let messageId: string | undefined;

  for (const line of lines) {
    // Extract messageId from metadata line
    if (line.startsWith("f:")) {
      try {
        const metadata = JSON.parse(line.slice(2));
        messageId = metadata.messageId;
      } catch {
        // Ignore parse errors
      }
    }
    // Extract text content
    else if (line.startsWith("0:")) {
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

  const answer = textChunks.join("").trim() || "No response generated. Please try rephrasing your question.";
  return { answer, messageId };
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
  }
);

// =============================================================================
// TOOLS - Different based on locked/generic mode
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // LOCKED MODE: Single tool, no project_id needed
  if (CONFIG.isLocked) {
    const docName = CONFIG.projectName || CONFIG.projectId;
    return {
      tools: [
        {
          name: "ask",
          description: `Ask a question about ${docName} documentation. The AI will search the docs and provide a relevant answer with code examples.`,
          inputSchema: {
            type: "object" as const,
            properties: {
              question: {
                type: "string",
                description: `Your question about ${docName}`,
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
  }

  // GENERIC MODE: Multiple tools, project_id required
  return {
    tools: [
      {
        name: "ask_docs",
        description:
          "Ask a question to a Mintlify-powered documentation site. Provide the project_id and your question.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project_id: {
              type: "string",
              description:
                'The Mintlify project ID (e.g., "agno-v2" for Agno docs). Use list_docs to see available options.',
            },
            question: {
              type: "string",
              description: "The question to ask the documentation",
            },
          },
          required: ["project_id", "question"],
        },
      },
      {
        name: "list_docs",
        description: "List all known Mintlify documentation sites",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "clear_conversation",
        description: "Clear conversation history for a project",
        inputSchema: {
          type: "object" as const,
          properties: {
            project_id: {
              type: "string",
              description: "The project ID to clear history for",
            },
          },
          required: ["project_id"],
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

  // LOCKED MODE HANDLERS
  if (CONFIG.isLocked) {
    const projectId = CONFIG.projectId!;

    switch (name) {
      case "ask": {
        const { question } = args as { question: string };
        let state = conversations.get(projectId);
        if (!state) {
          state = { messages: [], threadId: undefined };
          conversations.set(projectId, state);
        }

        try {
          const result = await askMintlify(projectId, question, state.messages, state.threadId);

          // Update threadId from response
          state.threadId = result.threadId;

          // Update history with proper message format
          const timestamp = new Date().toISOString();
          state.messages.push({
            id: generateId(),
            role: "user",
            content: question,
            createdAt: timestamp,
            parts: [{ type: "text", text: question }],
          });
          state.messages.push({
            id: result.messageId || `msg-${generateId()}`,
            role: "assistant",
            content: result.answer,
            createdAt: new Date().toISOString(),
            parts: [{ type: "step-start" }, { type: "text", text: result.answer }],
            revisionId: generateId(),
          });

          return { content: [{ type: "text", text: result.answer }] };
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
        }
      }

      case "clear_history": {
        conversations.delete(projectId);
        return { content: [{ type: "text", text: "Conversation history cleared." }] };
      }
    }
  }

  // GENERIC MODE HANDLERS
  switch (name) {
    case "ask_docs": {
      const { project_id, question } = args as {
        project_id: string;
        question: string;
      };

      let state = conversations.get(project_id);
      if (!state) {
        state = { messages: [], threadId: undefined };
        conversations.set(project_id, state);
      }

      try {
        const result = await askMintlify(project_id, question, state.messages, state.threadId);

        // Update threadId from response
        state.threadId = result.threadId;

        // Update history with proper message format
        const timestamp = new Date().toISOString();
        state.messages.push({
          id: generateId(),
          role: "user",
          content: question,
          createdAt: timestamp,
          parts: [{ type: "text", text: question }],
        });
        state.messages.push({
          id: result.messageId || `msg-${generateId()}`,
          role: "assistant",
          content: result.answer,
          createdAt: new Date().toISOString(),
          parts: [{ type: "step-start" }, { type: "text", text: result.answer }],
          revisionId: generateId(),
        });

        return { content: [{ type: "text", text: result.answer }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }

    case "list_docs": {
      const docsList = Object.entries(KNOWN_DOCS)
        .map(([id, info]) => `- **${info.name}** (\`${id}\`) - https://${info.domain}`)
        .join("\n");

      return {
        content: [{
          type: "text",
          text: `# Available Documentation\n\n${docsList}\n\n> Use any project_id with ask_docs, or configure a specialized MCP with --project`,
        }],
      };
    }

    case "clear_conversation": {
      const { project_id } = args as { project_id: string };
      conversations.delete(project_id);
      return { content: [{ type: "text", text: `History cleared for: ${project_id}` }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

// =============================================================================
// START SERVER
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = CONFIG.isLocked
    ? `locked to ${CONFIG.projectName || CONFIG.projectId}`
    : "generic mode";
  console.error(`${SERVER_NAME} running (${mode})`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
