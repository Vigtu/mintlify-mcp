import { loadProjectConfig, updateSeedingStatus } from "../config/loader";
import { discoverPages, getMarkdownUrl, fetchWithMetadata } from "../discovery";
import { isAgentOSRunning } from "../backends/agno";

// =============================================================================
// SEED COMMAND - Seed documentation into knowledge base
// =============================================================================

export interface SeedOptions {
  project: string;
  force?: boolean;
  verbose?: boolean;
}

export async function seedCommand(options: SeedOptions): Promise<void> {
  const { project, force = false, verbose = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    process.exit(1);
  }

  if (config.backend !== "agno") {
    console.error(`Project "${project}" uses Mintlify backend.`);
    console.error("Seeding is only needed for Agno-based projects.");
    process.exit(1);
  }

  const port = config.agno?.port || 7777;

  // Check if AgentOS is running
  if (!(await isAgentOSRunning(port))) {
    console.error(`AgentOS is not running on port ${port}.`);
    console.error(`Start it with: mintlify-mcp start --project ${project}`);
    process.exit(1);
  }

  // Update status to in_progress
  await updateSeedingStatus(project, {
    status: "in_progress",
    documents_count: config.seeding?.documents_count,
  });

  console.log(`Discovering pages from ${config.source.url}...`);

  // Discover pages
  const discovery = await discoverPages(config.source.url, {
    prefix: config.source.prefix,
    method: config.source.discovery,
    verbose,
  });

  if (discovery.pages.length === 0) {
    console.error("No pages found to seed.");
    await updateSeedingStatus(project, { status: "failed" });
    process.exit(1);
  }

  console.log(`Found ${discovery.pages.length} pages to seed.`);

  const knowledgeName = `${project}-docs`;
  const baseUrl = `http://localhost:${port}`;
  let successCount = 0;
  let errorCount = 0;

  // Seed each page
  for (let i = 0; i < discovery.pages.length; i++) {
    const page = discovery.pages[i];
    const mdUrl = getMarkdownUrl(page);

    if (verbose) {
      console.log(`[${i + 1}/${discovery.pages.length}] Seeding ${page.path}...`);
    } else {
      // Progress indicator
      process.stdout.write(
        `\rSeeding: ${i + 1}/${discovery.pages.length} pages...`
      );
    }

    try {
      // Fetch markdown and extract metadata
      const result = await fetchWithMetadata(mdUrl, page.path);

      if (!result) {
        errorCount++;
        if (verbose) {
          console.error(`  Failed to fetch: ${mdUrl}`);
        }
        continue;
      }

      const { content, metadata } = result;

      // Send to AgentOS knowledge base
      // Payload example:
      // {
      //   "knowledge_name": "project-docs",
      //   "content": "# Full markdown content...",
      //   "metadata": {
      //     "path": "/agent-os/api/authentication",
      //     "title": "AgentOS Authentication",
      //     "description": "Authenticate with AgentOS using RBAC and JWT tokens",
      //     "section": "agent-os",
      //     "source_url": "https://docs.agno.com/agent-os/api/authentication"
      //   }
      // }
      const response = await fetch(`${baseUrl}/knowledge/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_name: knowledgeName,
          content: content,
          metadata: {
            path: page.path,
            title: metadata.title,
            description: metadata.description,
            section: extractSection(page.path),
            source_url: page.url,
          },
          skip_if_exists: !force,
        }),
      });

      if (response.ok) {
        successCount++;
        if (verbose) {
          console.log(`  Title: ${metadata.title}`);
        }
      } else {
        errorCount++;
        if (verbose) {
          const errorText = await response.text();
          console.error(`  Error: ${errorText}`);
        }
      }
    } catch (error) {
      errorCount++;
      if (verbose) {
        console.error(`  Error: ${error}`);
      }
    }
  }

  console.log(); // New line after progress

  // Update status
  await updateSeedingStatus(project, {
    status: errorCount === 0 ? "completed" : "completed",
    documents_count: successCount,
    last_seeded: new Date().toISOString(),
  });

  console.log(`\nSeeding complete:`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors:  ${errorCount}`);
}

/** Extract section from path (first segment after root) */
function extractSection(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[0] || "root";
}
