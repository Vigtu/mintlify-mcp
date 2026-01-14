import { join, dirname } from "node:path";
import {
  saveProjectConfig,
  projectExists,
} from "../config/loader";
import {
  createDefaultProjectConfig,
  type ProjectConfig,
} from "../config/schema";
import { paths, ensureDirExists, fileExists } from "../config/paths";
import { discoverPages, isMintlifySite, getMarkdownUrl, type DiscoveredPage } from "../discovery";

// =============================================================================
// CREATE COMMAND - Create a new project
// =============================================================================

export interface CreateOptions {
  url: string;
  id: string;
  name?: string;
  prefix?: string;
  backend?: "agno" | "mintlify";
  mintlifyProjectId?: string;
  skipSeed?: boolean;
  download?: boolean;
  parallel?: number;
  verbose?: boolean;
}

export async function createCommand(options: CreateOptions): Promise<void> {
  const {
    url,
    id,
    name,
    prefix,
    backend = "agno",
    mintlifyProjectId,
    skipSeed = false,
    download = false,
    parallel = 3,
    verbose = false,
  } = options;

  // Validate project ID
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error("Project ID must contain only lowercase letters, numbers, and hyphens.");
    process.exit(1);
  }

  // Check if project already exists
  if (await projectExists(id)) {
    console.error(`Project "${id}" already exists.`);
    console.error("Use a different ID or delete the existing project.");
    process.exit(1);
  }

  // Validate URL
  let normalizedUrl: string;
  try {
    const parsed = new URL(url);
    normalizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  console.log(`Creating project "${id}"...`);
  console.log(`  URL:     ${normalizedUrl}`);
  console.log(`  Backend: ${backend}`);
  if (prefix) {
    console.log(`  Prefix:  ${prefix}`);
  }

  // Check if it's a valid documentation site
  console.log("\nValidating documentation site...");
  const isMintlify = await isMintlifySite(normalizedUrl);

  if (!isMintlify) {
    console.error("\nWarning: Could not confirm this is a Mintlify site.");
    console.error("The site may not expose sitemap.xml or mint.json publicly.");
    console.error("Continuing anyway...\n");
  } else {
    console.log("Valid Mintlify site detected.\n");
  }

  // Discover pages
  console.log("Discovering documentation pages...");
  const discovery = await discoverPages(normalizedUrl, {
    prefix,
    method: "auto",
    verbose,
  });

  if (discovery.pages.length === 0) {
    console.error("\nNo pages found.");
    console.error("Make sure the URL is correct and the site is accessible.");
    process.exit(1);
  }

  console.log(`Found ${discovery.pages.length} pages via ${discovery.method}`);
  if (discovery.total !== discovery.filtered) {
    console.log(`  (${discovery.total} total, ${discovery.filtered} after prefix filter)`);
  }

  // Create project config
  const config: ProjectConfig = createDefaultProjectConfig(id, normalizedUrl, {
    name: name || extractSiteName(normalizedUrl),
    prefix,
    backend,
    mintlifyProjectId,
    mintlifyDomain: new URL(normalizedUrl).hostname,
  });

  // Set discovery method used
  config.source.discovery = discovery.method;

  // Save config
  await ensureDirExists(paths.project(id));
  await saveProjectConfig(config);

  console.log(`\nProject "${id}" created successfully!`);
  console.log(`Config saved to: ${paths.projectConfig(id)}`);

  // Download markdown files if requested
  if (download) {
    console.log("\nDownloading documentation...");
    const docsDir = join(process.cwd(), "downloaded-docs", id);
    await ensureDirExists(docsDir);

    const result = await downloadPages(discovery.pages, docsDir, {
      parallel,
      verbose,
    });

    console.log(`\nDownload complete:`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Errors:  ${result.errors}`);
    console.log(`  Saved to: ${docsDir}`);
  }

  // Show next steps
  console.log("\nNext steps:");

  if (backend === "agno") {
    console.log(`  1. Start AgentOS:`);
    console.log(`     mintlify-mcp start --project ${id}`);
    console.log();
    console.log(`  2. Seed documentation:`);
    console.log(`     mintlify-mcp seed --project ${id}`);
    console.log();
    console.log(`  3. Start MCP server:`);
    console.log(`     mintlify-mcp serve --project ${id}`);
    console.log();
    console.log(`  Or configure Claude Code:`);
    console.log(`     claude mcp add ${id} -- bunx mintlify-mcp serve --project ${id}`);
  } else {
    console.log(`  Configure Claude Code:`);
    console.log(`     claude mcp add ${id} -- bunx mintlify-mcp serve --project ${id}`);
  }
}

/** Extract a readable name from URL */
function extractSiteName(url: string): string {
  const hostname = new URL(url).hostname;
  // Remove common prefixes and TLD
  const name = hostname
    .replace(/^(docs|www)\./, "")
    .replace(/\.(com|io|dev|ai|org|net)$/, "")
    .replace(/\./g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return `${name} Docs`;
}

// =============================================================================
// DOWNLOAD HELPERS
// =============================================================================

interface DownloadOptions {
  parallel: number;
  verbose: boolean;
}

interface DownloadResult {
  success: number;
  errors: number;
}

/** Download all pages to local directory */
async function downloadPages(
  pages: DiscoveredPage[],
  outputDir: string,
  options: DownloadOptions
): Promise<DownloadResult> {
  const { parallel, verbose } = options;
  let success = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < pages.length; i += parallel) {
    const batch = pages.slice(i, i + parallel);

    // Progress indicator
    process.stdout.write(
      `\rDownloading: ${Math.min(i + parallel, pages.length)}/${pages.length} pages...`
    );

    const results = await Promise.all(
      batch.map((page) => downloadPage(page, outputDir, verbose))
    );

    for (const ok of results) {
      if (ok) success++;
      else errors++;
    }
  }

  console.log(); // New line after progress
  return { success, errors };
}

/** Download a single page's markdown */
async function downloadPage(
  page: DiscoveredPage,
  outputDir: string,
  verbose: boolean
): Promise<boolean> {
  const mdUrl = getMarkdownUrl(page);
  const localPath = getLocalPath(page, outputDir);

  try {
    const response = await fetch(mdUrl, {
      headers: {
        "User-Agent": "mintlify-mcp/1.0",
        Accept: "text/markdown, text/plain, */*",
      },
    });

    if (!response.ok) {
      if (verbose) {
        console.error(`\n  Error ${response.status}: ${page.path}`);
      }
      return false;
    }

    const content = await response.text();

    // Ensure parent directory exists
    await ensureDirExists(dirname(localPath));

    // Write file
    await Bun.write(localPath, content);

    if (verbose) {
      console.log(`\n  Downloaded: ${page.path}`);
    }

    return true;
  } catch (error) {
    if (verbose) {
      console.error(`\n  Error: ${page.path} - ${error}`);
    }
    return false;
  }
}

/** Convert page path to local file path */
function getLocalPath(page: DiscoveredPage, outputDir: string): string {
  // Remove leading slash and add .md extension
  const relativePath = page.path.replace(/^\//, "").replace(/\/$/, "");
  return join(outputDir, `${relativePath}.md`);
}
