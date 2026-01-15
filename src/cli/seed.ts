import { isServerRunning } from "../backends/agno";
import { loadProjectConfig, updateSeedingStatus } from "../config/loader";
import {
  type DiscoveredPage,
  discoverPages,
  fetchWithMetadata,
  getMarkdownUrl,
} from "../discovery";

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

const DEFAULT_CONCURRENCY = 10;

/** Seed a single page to knowledge base */
async function seedPage(
  page: DiscoveredPage,
  baseUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const mdUrl = getMarkdownUrl(page);

  try {
    const result = await fetchWithMetadata(mdUrl, page.path);

    if (!result) {
      return { success: false, error: `Failed to fetch: ${mdUrl}` };
    }

    const { content, metadata } = result;
    const docName = `${page.path.replace(/^\//, "").replace(/\//g, "-") || "index"}`;

    const response = await fetch(`${baseUrl}/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: docName,
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
      return { success: true };
    } else {
      const errorText = await response.text();
      return { success: false, error: errorText };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Seed docs to knowledge base (exported for use by setup command) */
export async function seedDocs(
  _project: string,
  pages: DiscoveredPage[],
  port: number,
  verbose: boolean = false,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<SeedResult> {
  const baseUrl = `http://localhost:${port}`;
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;

  // Process in parallel batches
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);

    const results = await Promise.all(
      batch.map((page) => seedPage(page, baseUrl)),
    );

    for (const result of results) {
      completed++;
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
        if (verbose && result.error) {
          console.error(`   Error: ${result.error}`);
        }
      }
    }

    if (!verbose) {
      process.stdout.write(
        `\r   Seeding: ${completed}/${pages.length} pages...`,
      );
    } else {
      console.log(`   [${completed}/${pages.length}] batch complete`);
    }
  }

  if (!verbose) {
    console.log(); // New line after progress
  }

  return { success: successCount, errors: errorCount };
}

/** CLI command handler */
export async function seedCommand(options: SeedOptions): Promise<void> {
  const { project, force: _force = false, verbose = false } = options;

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
