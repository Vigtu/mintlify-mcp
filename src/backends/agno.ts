import type { BackendFactory } from "./registry";
import type { AgnoBackendConfig, AskResult, Backend } from "./types";

// =============================================================================
// LOCAL BACKEND - Calls local RAG server API
// =============================================================================

/** Default host for RAG server */
const DEFAULT_HOST = Bun.env.AGNO_HOST || "127.0.0.1";

/** Default port for RAG server */
const DEFAULT_PORT = Number(Bun.env.AGNO_PORT) || 7777;

/** Request timeout in milliseconds */
const _REQUEST_TIMEOUT_MS = 30_000;

/** Health check timeout in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

interface ToolMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    function: {
      name: string;
    };
  }>;
}

interface AgentRunResponse {
  content?: string;
  message?: string;
  run_id?: string;
  messages?: ToolMessage[];
}

interface AgentInfo {
  id: string;
}

export class AgnoBackend implements Backend {
  readonly name = "agno";
  readonly projectId: string;
  private host: string;
  private port: number;
  private baseUrl: string;

  constructor(config: AgnoBackendConfig) {
    this.projectId = config.projectId;
    this.host = config.host || DEFAULT_HOST;
    this.port = config.port || DEFAULT_PORT;
    this.baseUrl = `http://${this.host}:${this.port}`;
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

      // Sources are now handled by the LLM in the response (language-aware)
      // The agent instructions tell the LLM to include "Want to learn more?" section

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

/** Build server URL from host and port */
function buildServerUrl(
  host: string = DEFAULT_HOST,
  port: number = DEFAULT_PORT,
): string {
  return `http://${host}:${port}`;
}

/** Create an Agno backend from config */
export function createAgnoBackend(
  projectId: string,
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
): AgnoBackend {
  return new AgnoBackend({ type: "agno", projectId, host, port });
}

/** Check if server is running */
export async function isServerRunning(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
): Promise<boolean> {
  try {
    const url = buildServerUrl(host, port);
    const response = await fetch(`${url}/agents`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Check if a specific agent exists on the server */
export async function isAgentRunning(
  projectId: string,
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
): Promise<boolean> {
  try {
    const url = buildServerUrl(host, port);
    const response = await fetch(`${url}/agents`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const agents = (await response.json()) as AgentInfo[];
    const agentName = `${projectId}-assistant`;
    return agents.some((a) => a.id === agentName);
  } catch {
    return false;
  }
}

/** Export constants for use in other modules */
export { DEFAULT_HOST, DEFAULT_PORT };

// =============================================================================
// BACKEND FACTORY - For registry integration
// =============================================================================

export interface AgnoBackendOptions {
  projectId: string;
  host?: string;
  port?: number;
}

export const backendFactory: BackendFactory<AgnoBackendOptions> = {
  displayName: "Agno (Python RAG)",
  requiredDependencies: [], // Python dependencies managed separately

  async create(options: AgnoBackendOptions): Promise<Backend> {
    return createAgnoBackend(
      options.projectId,
      options.port ?? DEFAULT_PORT,
      options.host ?? DEFAULT_HOST,
    );
  },
};
