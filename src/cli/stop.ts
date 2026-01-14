import { loadProjectConfig } from "../config/loader";
import { paths, fileExists } from "../config/paths";

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

  // Read PID
  const pidContent = await Bun.file(pidFile).text();
  const pid = parseInt(pidContent.trim(), 10);

  if (isNaN(pid)) {
    console.error("Invalid PID file. Removing...");
    await Bun.spawn(["rm", "-f", pidFile]).exited;
    return;
  }

  console.log(`Stopping AgentOS (PID: ${pid})...`);

  // Kill the process
  const signal = force ? "SIGKILL" : "SIGTERM";
  const killProc = Bun.spawn(["kill", `-${signal}`, String(pid)]);
  await killProc.exited;

  // Wait a bit for graceful shutdown
  if (!force) {
    await Bun.sleep(1000);
  }

  // Remove PID file
  await Bun.spawn(["rm", "-f", pidFile]).exited;

  console.log("AgentOS stopped.");
}

/** Stop all running AgentOS instances */
export async function stopAllCommand(): Promise<void> {
  // Find all agent.pid files
  const proc = Bun.spawn(
    ["find", paths.projects, "-name", "agent.pid", "-type", "f"],
    { stdout: "pipe" }
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const pidFiles = output.trim().split("\n").filter(Boolean);

  if (pidFiles.length === 0) {
    console.log("No running AgentOS instances found.");
    return;
  }

  for (const pidFile of pidFiles) {
    const pidContent = await Bun.file(pidFile).text();
    const pid = parseInt(pidContent.trim(), 10);

    if (!isNaN(pid)) {
      console.log(`Stopping PID ${pid}...`);
      await Bun.spawn(["kill", "-SIGTERM", String(pid)]).exited;
    }

    await Bun.spawn(["rm", "-f", pidFile]).exited;
  }

  console.log(`Stopped ${pidFiles.length} AgentOS instance(s).`);
}
