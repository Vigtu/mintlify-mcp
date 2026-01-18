import { DEFAULT_HOST, DEFAULT_PORT, isServerRunning } from "../backends/agno";
import { loadProjectConfig } from "../config/loader";
import { ensureDirExists, fileExists, paths, remove } from "../config/paths";

// =============================================================================
// START - Start RAG server for a project
// =============================================================================

/** Interval between health checks in milliseconds */
const HEALTH_CHECK_INTERVAL_MS = 500;

/** Default server startup timeout in milliseconds */
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

export interface StartOptions {
  project: string;
  port?: number;
  verbose?: boolean;
}

/** Start server (exported for use by setup command) */
export async function startServer(
  project: string,
  port: number,
  verbose: boolean = false,
): Promise<boolean> {
  // Check if already running
  if (await isServerRunning(port)) {
    if (verbose) {
      console.log(`   Server already running on port ${port}`);
    }
    return true;
  }

  // Check if PID file exists (stale)
  const pidFile = paths.projectPid(project);
  if (await fileExists(pidFile)) {
    await remove(pidFile);
  }

  // Find Python directory
  const pythonDir = await findPythonDir();
  if (!pythonDir) {
    if (verbose) {
      console.error("   Python server not found. Searched:");
      console.error("   - ./python/server/main.py");
      console.error(`   - ${process.cwd()}/python/server/main.py`);
    }
    return false;
  }

  // Ensure logs directory exists
  await ensureDirExists(paths.projectLogs(project));

  // Start server in background using Bun.spawn
  const logFile = `${paths.projectLogs(project)}/server.log`;
  const env = {
    ...process.env,
    AGNO_DATA_DIR: paths.root,
    AGNO_PROJECT_ID: project,
    AGNO_PORT: String(port),
  };

  if (verbose) {
    console.error(`   Python dir: ${pythonDir}`);
    console.error(`   Log file: ${logFile}`);
  }

  const proc = Bun.spawn(
    [
      "uv",
      "run",
      "python",
      "-m",
      "server.main",
      "--project",
      project,
      "--port",
      String(port),
    ],
    {
      cwd: pythonDir,
      env,
      stdout: Bun.file(logFile),
      stderr: Bun.file(logFile),
    },
  );

  // Save PID
  await Bun.write(pidFile, String(proc.pid));

  if (verbose) {
    console.log(`   PID: ${proc.pid}`);
    console.log(`   Log: ${logFile}`);
  }

  return true;
}

/** Wait for server to be ready (exported for use by setup/serve) */
export async function waitForServer(
  port: number = DEFAULT_PORT,
  timeoutMs: number = DEFAULT_STARTUP_TIMEOUT_MS,
  host: string = DEFAULT_HOST,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isServerRunning(port, host)) {
      return true;
    }
    await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  return false;
}

/** Stop server running on a specific port using Bun.spawnSync */
export async function stopServer(
  port: number = DEFAULT_PORT,
): Promise<boolean> {
  try {
    // Use fuser to kill process on port (Linux)
    const result = Bun.spawnSync(["fuser", "-k", `${port}/tcp`], {
      stderr: "pipe",
    });

    // If fuser fails, try lsof + kill approach (macOS/Linux fallback)
    if (result.exitCode !== 0) {
      const lsofResult = Bun.spawnSync(
        ["sh", "-c", `lsof -ti:${port} | xargs -r kill -9 2>/dev/null || true`],
        { stderr: "pipe" },
      );
      return lsofResult.exitCode === 0;
    }

    return true;
  } catch {
    return false;
  }
}

/** CLI command handler */
export async function startCommand(options: StartOptions): Promise<void> {
  const { project, verbose = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    console.error("Run 'list' command to see available projects.");
    process.exit(1);
  }

  if (config.backend !== "agno") {
    console.error(`Project "${project}" uses remote API backend.`);
    console.error("Local server is only needed for local RAG projects.");
    process.exit(1);
  }

  const host = config.agno?.host || DEFAULT_HOST;
  const port = options.port || config.agno?.port || DEFAULT_PORT;

  // Check if already running
  if (await isServerRunning(port, host)) {
    console.log(`Server already running on ${host}:${port}`);
    return;
  }

  console.log(`Starting server for "${project}" on ${host}:${port}...`);

  const started = await startServer(project, port, verbose);
  if (!started) {
    console.error("Failed to start server.");
    process.exit(1);
  }

  // Wait for server to be ready
  const ready = await waitForServer(port, DEFAULT_STARTUP_TIMEOUT_MS, host);
  if (ready) {
    console.log(`Server started successfully on http://${host}:${port}`);
  } else {
    const logFile = `${paths.projectLogs(project)}/server.log`;
    console.error("Server failed to start. Check logs:");
    console.error(`  cat ${logFile}`);
    process.exit(1);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/** Find the Python directory (checks if exists) */
async function findPythonDir(): Promise<string | null> {
  const possiblePaths = [
    `${import.meta.dir}/../../python`, // Relative to src/cli/
    `${process.cwd()}/python`, // Current working directory
    `${paths.root}/python`, // Data directory
  ];

  for (const p of possiblePaths) {
    if (await fileExists(`${p}/server/main.py`)) {
      return p;
    }
  }

  return null;
}

/** Find the Python script */
async function _findPythonScript(): Promise<string | null> {
  const pythonDir = await findPythonDir();
  if (!pythonDir) return null;
  return `${pythonDir}/server/main.py`;
}
