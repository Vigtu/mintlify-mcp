// =============================================================================
// PROJECT CONFIGURATION SCHEMA
// =============================================================================

// Import constants from single source of truth
import { DEFAULT_HOST, DEFAULT_PORT } from "../backends/agno";

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

  backend: "agno" | "mintlify";

  // Mintlify-specific settings (when backend: "mintlify")
  mintlify?: {
    project_id: string;
    domain: string;
  };

  // Agno-specific settings (when backend: "agno")
  agno?: AgnoConfig;

  seeding?: SeedingStatus;
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
  default_backend: "agno" | "mintlify";
  agno_defaults: AgnoConfig;
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

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  default_backend: "agno",
  agno_defaults: DEFAULT_AGNO_CONFIG,
};

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

export interface CreateProjectOptions {
  name?: string;
  prefix?: string;
  backend?: "agno" | "mintlify";
  mintlifyProjectId?: string;
  mintlifyDomain?: string;
  agnoHost?: string;
  agnoPort?: number;
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
    backend: options.backend || "agno",
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
  }

  return config;
}
