import { dirname, join } from "node:path";
import { projectExists, saveProjectConfig } from "../config/loader";
import { ensureDirExists, paths } from "../config/paths";
import {
  createDefaultProjectConfig,
  type ProjectConfig,
} from "../config/schema";
import {
  type DiscoveredPage,
  discoverPages,
  extractMetadata,
  getMarkdownUrl,
  isMintlifySite,
} from "../discovery";

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
    download = false,
    parallel = 3,
    verbose = false,
  } = options;

  // Validate project ID
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error(
      "Project ID must contain only lowercase letters, numbers, and hyphens.",
    );
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
    normalizedUrl =
      `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
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
    console.log(
      `  (${discovery.total} total, ${discovery.filtered} after prefix filter)`,
    );
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
    console.log(`  1. Start server:`);
    console.log(`     docmole start --project ${id}`);
    console.log();
    console.log(`  2. Seed documentation:`);
    console.log(`     docmole seed --project ${id}`);
    console.log();
    console.log(`  3. Start MCP server:`);
    console.log(`     docmole serve --project ${id}`);
    console.log();
    console.log(`  Or configure Claude Code:`);
    console.log(
      `     claude mcp add ${id} -- bunx docmole serve --project ${id}`,
    );
  } else {
    console.log(`  Configure Claude Code:`);
    console.log(
      `     claude mcp add ${id} -- bunx docmole serve --project ${id}`,
    );
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

interface PageMetadata {
  path: string;
  url: string;
  title: string;
  description: string;
  localPath: string;
  lastmod?: string;
  charCount: number;
}

interface DownloadResult {
  success: number;
  errors: number;
  metadata: PageMetadata[];
}

/** Download all pages to local directory */
async function downloadPages(
  pages: DiscoveredPage[],
  outputDir: string,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const { parallel, verbose } = options;
  let success = 0;
  let errors = 0;
  const metadata: PageMetadata[] = [];

  // Process in batches
  for (let i = 0; i < pages.length; i += parallel) {
    const batch = pages.slice(i, i + parallel);

    // Progress indicator
    process.stdout.write(
      `\rDownloading: ${Math.min(i + parallel, pages.length)}/${pages.length} pages...`,
    );

    const results = await Promise.all(
      batch.map((page) => downloadPage(page, outputDir, verbose)),
    );

    for (const result of results) {
      if (result) {
        success++;
        metadata.push(result);
      } else {
        errors++;
      }
    }
  }

  console.log(); // New line after progress

  // Save metadata index
  const indexPath = join(outputDir, "_index.json");
  await Bun.write(indexPath, JSON.stringify(metadata, null, 2));

  return { success, errors, metadata };
}

/** Download a single page's markdown and extract metadata */
async function downloadPage(
  page: DiscoveredPage,
  outputDir: string,
  verbose: boolean,
): Promise<PageMetadata | null> {
  const mdUrl = getMarkdownUrl(page);
  const localPath = getLocalPath(page, outputDir);

  try {
    const response = await fetch(mdUrl, {
      headers: {
        "User-Agent": "docmole/1.0",
        Accept: "text/markdown, text/plain, */*",
      },
    });

    if (!response.ok) {
      if (verbose) {
        console.error(`\n  Error ${response.status}: ${page.path}`);
      }
      return null;
    }

    const content = await response.text();

    // Extract metadata from markdown
    const { title, description } = extractMetadata(content, page.path);

    // Ensure parent directory exists
    await ensureDirExists(dirname(localPath));

    // Write file
    await Bun.write(localPath, content);

    if (verbose) {
      console.log(`\n  Downloaded: ${page.path} (${title})`);
    }

    return {
      path: page.path,
      url: page.url,
      title,
      description,
      localPath: localPath.replace(outputDir, "").replace(/^\//, ""),
      lastmod: page.lastmod,
      charCount: content.length,
    };
  } catch (error) {
    if (verbose) {
      console.error(`\n  Error: ${page.path} - ${error}`);
    }
    return null;
  }
}

/** Convert page path to local file path */
function getLocalPath(page: DiscoveredPage, outputDir: string): string {
  // Remove leading slash and add .md extension
  const relativePath = page.path.replace(/^\//, "").replace(/\/$/, "");
  return join(outputDir, `${relativePath}.md`);
}
