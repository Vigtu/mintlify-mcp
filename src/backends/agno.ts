import type { Backend, AskResult, AgnoBackendConfig } from "./types";

// =============================================================================
// AGNO BACKEND - Calls AgentOS HTTP API
// =============================================================================

interface AgentRunResponse {
  content?: string;
  message?: string;
  run_id?: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
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
      const response = await fetch(`${this.baseUrl}/agents/${agentName}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AgentOS error: ${response.status} - ${errorText}`);
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

      return { answer };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("ECONNREFUSED")) {
          throw new Error(
            `AgentOS server not running. Start it with: mintlify-mcp start --project ${this.projectId}`
          );
        }
        throw error;
      }
      throw new Error("Unknown error calling AgentOS");
    }
  }

  clearHistory(): void {
    // AgentOS manages conversation state internally
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

  /** Get the AgentOS base URL */
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
  port: number = 7777
): AgnoBackend {
  return new AgnoBackend({ type: "agno", projectId, port });
}

/** Check if AgentOS is running on a specific port */
export async function isAgentOSRunning(port: number = 7777): Promise<boolean> {
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
