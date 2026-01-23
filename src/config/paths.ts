import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// =============================================================================
// DATA DIRECTORY PATHS - Using Bun's native node:fs implementation
// =============================================================================

// Get home directory with safe fallback
function getHomeDir(): string {
  const home = process.env.HOME || Bun.env.HOME;
  if (home) return home;

  // Platform-specific fallbacks
  if (process.platform === "win32") {
    return (
      process.env.USERPROFILE || process.env.APPDATA || "C:\\Users\\Default"
    );
  }

  // Unix: try to get from /etc/passwd or use a safe fallback
  const user = process.env.USER || process.env.LOGNAME;
  if (user) {
    return `/home/${user}`;
  }

  // Last resort - still better than /tmp which gets cleared
  throw new Error(
    "Cannot determine home directory. Set HOME or DOCMOLE_DATA_DIR environment variable.",
  );
}

const HOME = getHomeDir();
// Support both new and legacy env vars for backwards compatibility
const DATA_DIR =
  process.env.DOCMOLE_DATA_DIR ||
  process.env.MINTLIFY_DATA_DIR ||
  join(HOME, ".docmole");

export const paths = {
  /** Root data directory: ~/.docmole */
  root: DATA_DIR,

  /** Projects directory: ~/.docmole/projects */
  projects: join(DATA_DIR, "projects"),

  /** Global config: ~/.docmole/global.yaml */
  globalConfig: join(DATA_DIR, "global.yaml"),

  /** Get project directory: ~/.docmole/projects/{id} */
  project: (id: string) => join(DATA_DIR, "projects", id),

  /** Get project config: ~/.docmole/projects/{id}/config.yaml */
  projectConfig: (id: string) => join(DATA_DIR, "projects", id, "config.yaml"),

  /** Get project LanceDB: ~/.docmole/projects/{id}/lancedb */
  projectLanceDb: (id: string) => join(DATA_DIR, "projects", id, "lancedb"),

  /** Get project logs: ~/.docmole/projects/{id}/logs */
  projectLogs: (id: string) => join(DATA_DIR, "projects", id, "logs"),

  /** Get PID file for server: ~/.docmole/projects/{id}/agent.pid */
  projectPid: (id: string) => join(DATA_DIR, "projects", id, "agent.pid"),

  /** Get project docs directory: ~/.docmole/projects/{id}/docs */
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
