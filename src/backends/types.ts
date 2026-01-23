// =============================================================================
// BACKEND INTERFACE
// =============================================================================

export interface AskResult {
  answer: string;
  sources?: string[];
  messageId?: string;
}

export interface Backend {
  /** Backend name for identification */
  readonly name: string;

  /** Project ID this backend is configured for */
  readonly projectId: string;

  /** Ask a question to the documentation */
  ask(question: string): Promise<AskResult>;

  /** Clear conversation history */
  clearHistory(): void;

  /** Check if backend is available/healthy */
  isAvailable(): Promise<boolean>;
}

export interface BackendConfig {
  type: "mintlify" | "agno" | "embedded";
  projectId: string;
}

export interface MintlifyBackendConfig extends BackendConfig {
  type: "mintlify";
  domain: string;
}

export interface AgnoBackendConfig extends BackendConfig {
  type: "agno";
  host?: string;
  port?: number;
}

export interface EmbeddedBackendConfig extends BackendConfig {
  type: "embedded";
  /** Use local providers (Ollama) instead of cloud (OpenAI) */
  local?: boolean;
  /** LLM provider: 'openai' or 'ollama' */
  llmProvider?: "openai" | "ollama";
  /** LLM model name */
  llmModel?: string;
  /** Embedding provider: 'openai' or 'ollama' */
  embeddingProvider?: "openai" | "ollama";
  /** Embedding model name */
  embeddingModel?: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string;
}
