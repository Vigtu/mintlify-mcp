import { mkdir, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";

// =============================================================================
// DATA DIRECTORY PATHS - Using Bun's native node:fs implementation
// =============================================================================

const HOME = process.env.HOME || Bun.env.HOME || "/tmp";
const DATA_DIR = process.env.MINTLIFY_DATA_DIR || join(HOME, ".mintlify-mcp");

export const paths = {
  /** Root data directory: ~/.mintlify-mcp */
  root: DATA_DIR,

  /** Projects directory: ~/.mintlify-mcp/projects */
  projects: join(DATA_DIR, "projects"),

  /** Global config: ~/.mintlify-mcp/global.yaml */
  globalConfig: join(DATA_DIR, "global.yaml"),

  /** Get project directory: ~/.mintlify-mcp/projects/{id} */
  project: (id: string) => join(DATA_DIR, "projects", id),

  /** Get project config: ~/.mintlify-mcp/projects/{id}/config.yaml */
  projectConfig: (id: string) => join(DATA_DIR, "projects", id, "config.yaml"),

  /** Get project LanceDB: ~/.mintlify-mcp/projects/{id}/lancedb */
  projectLanceDb: (id: string) => join(DATA_DIR, "projects", id, "lancedb"),

  /** Get project logs: ~/.mintlify-mcp/projects/{id}/logs */
  projectLogs: (id: string) => join(DATA_DIR, "projects", id, "logs"),

  /** Get PID file for AgentOS: ~/.mintlify-mcp/projects/{id}/agent.pid */
  projectPid: (id: string) => join(DATA_DIR, "projects", id, "agent.pid"),

  /** Get project docs directory: ~/.mintlify-mcp/projects/{id}/docs */
  projectDocs: (id: string) => join(DATA_DIR, "projects", id, "docs"),
};

/** Ensure directory exists using Bun's native mkdir */
export async function ensureDirExists(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Check if file exists using Bun.file() */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/** Check if directory exists using stat */
export async function dirExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** List directory contents */
export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/** Remove file or directory */
export async function remove(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
