// =============================================================================
// EMBEDDED BACKEND CONFIGURATION
// =============================================================================

/**
 * LLM provider configuration
 */
export interface LLMConfig {
  provider: "openai" | "ollama";
  model: string;
  baseUrl?: string;
}

/**
 * Embedding provider configuration
 */
export interface EmbeddingConfig {
  provider: "openai" | "ollama";
  model: string;
  baseUrl?: string;
}

/**
 * Vector store configuration
 */
export interface VectorStoreConfig {
  type: "lancedb";
  path: string;
}

/**
 * Complete embedded backend configuration
 */
export interface EmbeddedConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
}

/**
 * Parse env var as number with fallback
 */
function envNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined) return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Search configuration constants
 * All values can be overridden via environment variables
 */
export const SEARCH_CONFIG = {
  /** Minimum relevance score threshold (same as Python: 0.015) */
  MIN_SCORE: envNumber("MINTLIFY_MIN_SCORE", 0.015),
  /** Maximum chunks per source URL for deduplication */
  MAX_CHUNKS_PER_URL: envNumber("MINTLIFY_MAX_CHUNKS_PER_URL", 2),
  /** Default number of documents to retrieve */
  DEFAULT_NUM_DOCS: envNumber("MINTLIFY_DEFAULT_NUM_DOCS", 10),
  /** Multiplier for initial retrieval before filtering */
  RETRIEVAL_MULTIPLIER: envNumber("MINTLIFY_RETRIEVAL_MULTIPLIER", 2),
  /** Maximum tool call iterations (same as Python: tool_call_limit=3) */
  MAX_STEPS: envNumber("MINTLIFY_MAX_STEPS", 3),
} as const;

// =============================================================================
// PRESETS
// =============================================================================

/**
 * Cloud mode preset - uses OpenAI API
 * Requires: OPENAI_API_KEY environment variable
 */
export function createCloudConfig(projectPath: string): EmbeddedConfig {
  return {
    llm: {
      provider: "openai",
      model: "gpt-4o-mini",
    },
    embedding: {
      provider: "openai",
      model: "text-embedding-3-small",
    },
    vectorStore: {
      type: "lancedb",
      path: `${projectPath}/lancedb`,
    },
  };
}

/**
 * Local mode preset - uses Ollama
 * Requires: Ollama running on localhost:11434
 */
export function createLocalConfig(projectPath: string): EmbeddedConfig {
  return {
    llm: {
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://localhost:11434",
    },
    embedding: {
      provider: "ollama",
      model: "nomic-embed-text",
      baseUrl: "http://localhost:11434",
    },
    vectorStore: {
      type: "lancedb",
      path: `${projectPath}/lancedb`,
    },
  };
}

/**
 * Create config from CLI options
 */
export interface ConfigOptions {
  projectPath: string;
  local?: boolean;
  llmProvider?: "openai" | "ollama";
  llmModel?: string;
  embeddingProvider?: "openai" | "ollama";
  embeddingModel?: string;
  ollamaBaseUrl?: string;
}

export function createConfigFromOptions(
  options: ConfigOptions,
): EmbeddedConfig {
  const baseConfig = options.local
    ? createLocalConfig(options.projectPath)
    : createCloudConfig(options.projectPath);

  // Override with explicit options
  if (options.llmProvider) {
    baseConfig.llm.provider = options.llmProvider;
  }
  if (options.llmModel) {
    baseConfig.llm.model = options.llmModel;
  }
  if (options.embeddingProvider) {
    baseConfig.embedding.provider = options.embeddingProvider;
  }
  if (options.embeddingModel) {
    baseConfig.embedding.model = options.embeddingModel;
  }
  if (options.ollamaBaseUrl) {
    if (baseConfig.llm.provider === "ollama") {
      baseConfig.llm.baseUrl = options.ollamaBaseUrl;
    }
    if (baseConfig.embedding.provider === "ollama") {
      baseConfig.embedding.baseUrl = options.ollamaBaseUrl;
    }
  }

  return baseConfig;
}
