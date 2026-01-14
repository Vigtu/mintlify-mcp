import { getAllProjects } from "../config/loader";

// =============================================================================
// LIST COMMAND - List all projects
// =============================================================================

export async function listCommand(): Promise<void> {
  const projects = await getAllProjects();

  if (projects.length === 0) {
    console.log("No projects found.");
    console.log("\nCreate one with:");
    console.log("  mintlify-mcp create --url <docs-url> --id <project-id>");
    return;
  }

  console.log("Projects:\n");

  for (const project of projects) {
    const status = project.seeding?.status || "unknown";
    const docs = project.seeding?.documents_count || 0;
    const backend = project.backend;

    console.log(`  ${project.id}`);
    console.log(`    Name:     ${project.name}`);
    console.log(`    URL:      ${project.source.url}`);
    console.log(`    Backend:  ${backend}`);
    console.log(`    Status:   ${status} (${docs} docs)`);

    if (project.source.prefix) {
      console.log(`    Prefix:   ${project.source.prefix}`);
    }

    console.log();
  }

  console.log(`Total: ${projects.length} project(s)`);
}
