import { loadProjectConfig, updateSeedingStatus } from "../config/loader";
import { discoverPages, getMarkdownUrl, fetchWithMetadata, type DiscoveredPage } from "../discovery";
import { isServerRunning } from "../backends/agno";

// =============================================================================
// SEED - Seed documentation into knowledge base
// =============================================================================

export interface SeedOptions {
  project: string;
  force?: boolean;
  verbose?: boolean;
}

export interface SeedResult {
  success: number;
  errors: number;
}

/** Seed docs to knowledge base (exported for use by setup command) */
export async function seedDocs(
  project: string,
  pages: DiscoveredPage[],
  port: number,
  verbose: boolean = false
): Promise<SeedResult> {
  const knowledgeName = `${project}-docs`;
  const baseUrl = `http://localhost:${port}`;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const mdUrl = getMarkdownUrl(page);

    if (verbose) {
      console.log(`   [${i + 1}/${pages.length}] ${page.path}...`);
    } else {
      process.stdout.write(`\r   Seeding: ${i + 1}/${pages.length} pages...`);
    }

    try {
      // Fetch markdown and extract metadata
      const result = await fetchWithMetadata(mdUrl, page.path);

      if (!result) {
        errorCount++;
        if (verbose) {
          console.error(`   Failed to fetch: ${mdUrl}`);
        }
        continue;
      }

      const { content, metadata } = result;

      // Send to knowledge base via POST /knowledge/content
      // Payload schema:
      // {
      //   "name": "project-docs",
      //   "text_content": "# Full markdown content...",
      //   "metadata": "{\"path\": \"/api/auth\", \"title\": \"...\", ...}"  // JSON string
      // }
      const response = await fetch(`${baseUrl}/knowledge/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: knowledgeName,
          text_content: content,
          metadata: JSON.stringify({
            path: page.path,
            title: metadata.title,
            description: metadata.description,
            section: extractSection(page.path),
            source_url: page.url,
          }),
        }),
      });

      if (response.ok) {
        successCount++;
        if (verbose) {
          console.log(`   Title: ${metadata.title}`);
        }
      } else {
        errorCount++;
        if (verbose) {
          const errorText = await response.text();
          console.error(`   Error: ${errorText}`);
        }
      }
    } catch (error) {
      errorCount++;
      if (verbose) {
        console.error(`   Error: ${error}`);
      }
    }
  }

  if (!verbose) {
    console.log(); // New line after progress
  }

  return { success: successCount, errors: errorCount };
}

/** CLI command handler */
export async function seedCommand(options: SeedOptions): Promise<void> {
  const { project, force = false, verbose = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    process.exit(1);
  }

  if (config.backend !== "agno") {
    console.error(`Project "${project}" uses remote API backend.`);
    console.error("Seeding is only needed for local RAG projects.");
    process.exit(1);
  }

  const port = config.agno?.port || 7777;

  // Check if server is running
  if (!(await isServerRunning(port))) {
    console.error(`Server is not running on port ${port}.`);
    console.error(`Start it first with: start --project ${project}`);
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

  // Seed docs
  const result = await seedDocs(project, discovery.pages, port, verbose);

  // Update status
  await updateSeedingStatus(project, {
    status: "completed",
    documents_count: result.success,
    last_seeded: new Date().toISOString(),
  });

  console.log(`\nSeeding complete:`);
  console.log(`  Success: ${result.success}`);
  console.log(`  Errors:  ${result.errors}`);
}

/** Extract section from path (first segment after root) */
function extractSection(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[0] || "root";
}
