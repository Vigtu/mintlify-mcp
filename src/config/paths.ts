import { homedir } from "os";
import { join } from "path";

// =============================================================================
// DATA DIRECTORY PATHS
// =============================================================================

const DATA_DIR = process.env.MINTLIFY_DATA_DIR || join(homedir(), ".mintlify-mcp");

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
};

/** Ensure directory exists using Bun's native file API */
export async function ensureDir(path: string): Promise<void> {
  const file = Bun.file(path);
  const exists = await file.exists();

  if (!exists) {
    await Bun.write(join(path, ".keep"), "");
    // Remove the .keep file, we just needed to create the directory
    const keepFile = Bun.file(join(path, ".keep"));
    if (await keepFile.exists()) {
      await Bun.spawn(["rm", join(path, ".keep")]).exited;
    }
  }
}

/** Ensure directory exists using mkdir -p */
export async function ensureDirExists(path: string): Promise<void> {
  await Bun.spawn(["mkdir", "-p", path]).exited;
}

/** Check if file exists using Bun's native API */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/** Check if directory exists */
export async function dirExists(path: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["test", "-d", path]);
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}
