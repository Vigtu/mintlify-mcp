// =============================================================================
// PROJECT CONFIGURATION SCHEMA
// =============================================================================

// Import constants from single source of truth
import { DEFAULT_HOST, DEFAULT_PORT } from "../backends/agno";

// =============================================================================
// BACKEND TYPES - Single source of truth
// =============================================================================

/** All supported backend types */
export const BACKEND_TYPES = ["mintlify", "embedded", "agno"] as const;

/** Backend type union - derived from BACKEND_TYPES */
export type BackendType = (typeof BACKEND_TYPES)[number];

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ProjectConfig {
  id: string;
  name: string;
  created_at: string;

  source: {
    url: string;
    prefix?: string;
    discovery: "sitemap" | "mintjson";
  };

  backend: BackendType;

  // Mintlify-specific settings (when backend: "mintlify")
  mintlify?: {
    project_id: string;
    domain: string;
  };

  // Agno-specific settings (when backend: "agno")
  agno?: AgnoConfig;

  // Embedded-specific settings (when backend: "embedded")
  embedded?: EmbeddedProjectConfig;

  seeding?: SeedingStatus;
}

export interface EmbeddedProjectConfig {
  /** Use local providers (Ollama) instead of cloud (OpenAI) */
  local: boolean;
  /** LLM provider */
  llm_provider: "openai" | "ollama";
  /** LLM model */
  llm_model: string;
  /** Embedding provider */
  embedding_provider: "openai" | "ollama";
  /** Embedding model */
  embedding_model: string;
  /** Ollama base URL (for local mode) */
  ollama_base_url?: string;
}

export interface AgnoConfig {
  model: string;
  embedder: string;
  max_results: number;
  host?: string;
  port: number;
}

export interface SeedingStatus {
  last_seeded?: string;
  documents_count?: number;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface GlobalConfig {
  default_backend: BackendType;
  agno_defaults: AgnoConfig;
  embedded_defaults: EmbeddedProjectConfig;
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULT_AGNO_CONFIG: AgnoConfig = {
  model: "gpt-4o-mini",
  embedder: "text-embedding-3-small",
  max_results: 5,
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
};

export const DEFAULT_EMBEDDED_CONFIG: EmbeddedProjectConfig = {
  local: false,
  llm_provider: "openai",
  llm_model: "gpt-4o-mini",
  embedding_provider: "openai",
  embedding_model: "text-embedding-3-small",
};

export const DEFAULT_LOCAL_EMBEDDED_CONFIG: EmbeddedProjectConfig = {
  local: true,
  llm_provider: "ollama",
  llm_model: "llama3.2",
  embedding_provider: "ollama",
  embedding_model: "nomic-embed-text",
  ollama_base_url: "http://localhost:11434",
};

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  default_backend: "embedded",
  agno_defaults: DEFAULT_AGNO_CONFIG,
  embedded_defaults: DEFAULT_EMBEDDED_CONFIG,
};

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

export interface CreateProjectOptions {
  name?: string;
  prefix?: string;
  backend?: BackendType;
  // Mintlify options
  mintlifyProjectId?: string;
  mintlifyDomain?: string;
  // Agno options
  agnoHost?: string;
  agnoPort?: number;
  // Embedded options
  local?: boolean;
  llmProvider?: "openai" | "ollama";
  llmModel?: string;
  embeddingProvider?: "openai" | "ollama";
  embeddingModel?: string;
  ollamaBaseUrl?: string;
}

export function createDefaultProjectConfig(
  id: string,
  url: string,
  options: CreateProjectOptions = {},
): ProjectConfig {
  const config: ProjectConfig = {
    id,
    name: options.name || id,
    created_at: new Date().toISOString(),
    source: {
      url,
      prefix: options.prefix,
      discovery: "sitemap",
    },
    backend: options.backend || "embedded",
    seeding: {
      status: "pending",
    },
  };

  if (config.backend === "agno") {
    config.agno = {
      ...DEFAULT_AGNO_CONFIG,
      host: options.agnoHost || DEFAULT_AGNO_CONFIG.host,
      port: options.agnoPort || DEFAULT_AGNO_CONFIG.port,
    };
  } else if (config.backend === "mintlify") {
    config.mintlify = {
      project_id: options.mintlifyProjectId || id,
      domain: options.mintlifyDomain || new URL(url).hostname,
    };
  } else if (config.backend === "embedded") {
    const baseConfig = options.local
      ? DEFAULT_LOCAL_EMBEDDED_CONFIG
      : DEFAULT_EMBEDDED_CONFIG;

    config.embedded = {
      local: options.local ?? baseConfig.local,
      llm_provider: options.llmProvider ?? baseConfig.llm_provider,
      llm_model: options.llmModel ?? baseConfig.llm_model,
      embedding_provider:
        options.embeddingProvider ?? baseConfig.embedding_provider,
      embedding_model: options.embeddingModel ?? baseConfig.embedding_model,
      ollama_base_url: options.ollamaBaseUrl ?? baseConfig.ollama_base_url,
    };
  }

  return config;
}
