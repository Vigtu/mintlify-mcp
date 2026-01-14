// =============================================================================
// PROJECT CONFIGURATION SCHEMA
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
  agno?: {
    model: string;
    embedder: string;
    max_results: number;
    port: number;
  };

  seeding?: {
    last_seeded?: string;
    documents_count?: number;
    status: "pending" | "in_progress" | "completed" | "failed";
  };
}

export interface GlobalConfig {
  default_backend: "agno" | "mintlify";
  agno_defaults: {
    model: string;
    embedder: string;
    max_results: number;
    port: number;
  };
}

export const DEFAULT_AGNO_CONFIG = {
  model: "gpt-4o-mini",
  embedder: "text-embedding-3-small",
  max_results: 5,
  port: 7777,
};

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  default_backend: "agno",
  agno_defaults: DEFAULT_AGNO_CONFIG,
};

export function createDefaultProjectConfig(
  id: string,
  url: string,
  options: {
    name?: string;
    prefix?: string;
    backend?: "agno" | "mintlify";
    mintlifyProjectId?: string;
    mintlifyDomain?: string;
  } = {}
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
    config.agno = { ...DEFAULT_AGNO_CONFIG };
  } else if (config.backend === "mintlify") {
    config.mintlify = {
      project_id: options.mintlifyProjectId || id,
      domain: options.mintlifyDomain || new URL(url).hostname,
    };
  }

  return config;
}
