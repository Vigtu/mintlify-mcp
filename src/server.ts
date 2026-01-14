import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Backend } from "./backends/types";

// =============================================================================
// MCP SERVER - Shared server implementation
// =============================================================================

export async function startMcpServer(
  backend: Backend,
  projectName: string
): Promise<void> {
  const serverName = `${projectName} AI Assistant`;

  const server = new Server(
    {
      name: serverName,
      version: "0.3.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "ask",
          description: `Ask a question about ${projectName} documentation. The AI will search the docs and provide a relevant answer with code examples.`,
          inputSchema: {
            type: "object" as const,
            properties: {
              question: {
                type: "string",
                description: `Your question about ${projectName}`,
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

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "ask": {
        const { question } = args as { question: string };

        try {
          const result = await backend.ask(question);
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
        backend.clearHistory();
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

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${serverName} running`);
}
