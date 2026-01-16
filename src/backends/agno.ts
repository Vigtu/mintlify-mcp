import type { AgnoBackendConfig, AskResult, Backend } from "./types";

// =============================================================================
// LOCAL BACKEND - Calls local RAG server API
// =============================================================================

interface ToolMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    function: {
      name: string;
    };
  }>;
}

interface KnowledgeResult {
  name: string;
  content: string;
  meta_data?: {
    source_url?: string;
    title?: string;
    path?: string;
  };
}

interface AgentRunResponse {
  content?: string;
  message?: string;
  run_id?: string;
  messages?: ToolMessage[];
}

/** Extract unique sources from knowledge base tool results */
function extractSources(messages: ToolMessage[]): Map<string, string> {
  const sources = new Map<string, string>(); // url -> title

  for (const msg of messages) {
    if (msg.role === "tool" && msg.content) {
      try {
        const results = JSON.parse(msg.content) as KnowledgeResult[];
        for (const result of results) {
          if (result.meta_data?.source_url) {
            const title =
              result.meta_data.title ||
              result.name ||
              result.meta_data.path ||
              "Source";
            sources.set(result.meta_data.source_url, title);
          }
        }
      } catch {
        // Not JSON or different format, skip
      }
    }
  }

  return sources;
}

/** Format sources as markdown links */
function formatSources(sources: Map<string, string>): string {
  if (sources.size === 0) return "";

  const links = Array.from(sources.entries())
    .map(([url, title]) => `- [${title}](${url})`)
    .join("\n");

  return `\n\n---\n**Sources:**\n${links}`;
}

export class AgnoBackend implements Backend {
  readonly name = "agno";
  readonly projectId: string;
  private port: number;
  private baseUrl: string;

  constructor(config: AgnoBackendConfig) {
    this.projectId = config.projectId;
    this.port = config.port;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  async ask(question: string): Promise<AskResult> {
    const agentName = `${this.projectId}-assistant`;

    try {
      // AgentOS API expects multipart/form-data
      const formData = new FormData();
      formData.append("message", question);
      formData.append("stream", "false");

      const response = await fetch(`${this.baseUrl}/agents/${agentName}/runs`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const result = (await response.json()) as AgentRunResponse;

      // Extract answer from response
      let answer: string;
      if (result.content) {
        answer = result.content;
      } else if (result.messages && result.messages.length > 0) {
        // Get last assistant message
        const assistantMsg = result.messages
          .filter((m) => m.role === "assistant")
          .pop();
        answer = assistantMsg?.content || "No response generated.";
      } else if (result.message) {
        answer = result.message;
      } else {
        answer = "No response generated.";
      }

      // Extract and append sources from knowledge base results
      if (result.messages) {
        const sources = extractSources(result.messages);
        answer += formatSources(sources);
      }

      return { answer };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("ECONNREFUSED")) {
          throw new Error(
            `Server not running. Run setup first or start manually.`,
          );
        }
        throw error;
      }
      throw new Error("Unknown error calling server");
    }
  }

  clearHistory(): void {
    // Server manages conversation state internally
    // For now, we don't have a clear endpoint
    // Could implement via a POST to /agents/{name}/clear if available
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      // Try alternative endpoint
      try {
        const response = await fetch(`${this.baseUrl}/agents`, {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  }

  /** Get the server base URL */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Get the agent endpoint */
  getAgentEndpoint(): string {
    return `${this.baseUrl}/agents/${this.projectId}-assistant/runs`;
  }
}

/** Create an Agno backend from config */
export function createAgnoBackend(
  projectId: string,
  port: number = 7777,
): AgnoBackend {
  return new AgnoBackend({ type: "agno", projectId, port });
}

/** Check if server is running on a specific port */
export async function isServerRunning(port: number = 7777): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/agents`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
