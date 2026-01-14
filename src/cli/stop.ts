import { loadProjectConfig, listProjects } from "../config/loader";
import { paths, fileExists, remove } from "../config/paths";

// =============================================================================
// STOP COMMAND - Stop AgentOS server for a project
// =============================================================================

export interface StopOptions {
  project: string;
  force?: boolean;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const { project, force = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    process.exit(1);
  }

  const pidFile = paths.projectPid(project);

  if (!(await fileExists(pidFile))) {
    console.log(`No running AgentOS found for project "${project}".`);
    return;
  }

  // Read PID using Bun.file()
  const pidContent = await Bun.file(pidFile).text();
  const pid = parseInt(pidContent.trim(), 10);

  if (isNaN(pid)) {
    console.error("Invalid PID file. Removing...");
    await remove(pidFile);
    return;
  }

  console.log(`Stopping AgentOS (PID: ${pid})...`);

  // Kill the process using process.kill (Bun native)
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Process may already be dead
  }

  // Wait a bit for graceful shutdown
  if (!force) {
    await Bun.sleep(1000);
  }

  // Remove PID file
  await remove(pidFile);

  console.log("AgentOS stopped.");
}

/** Stop all running AgentOS instances */
export async function stopAllCommand(): Promise<void> {
  const projectIds = await listProjects();
  let stoppedCount = 0;

  for (const projectId of projectIds) {
    const pidFile = paths.projectPid(projectId);

    if (!(await fileExists(pidFile))) {
      continue;
    }

    const pidContent = await Bun.file(pidFile).text();
    const pid = parseInt(pidContent.trim(), 10);

    if (!isNaN(pid)) {
      console.log(`Stopping ${projectId} (PID: ${pid})...`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
      stoppedCount++;
    }

    await remove(pidFile);
  }

  if (stoppedCount === 0) {
    console.log("No running AgentOS instances found.");
  } else {
    console.log(`Stopped ${stoppedCount} AgentOS instance(s).`);
  }
}
