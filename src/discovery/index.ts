import { parseSitemap, filterByPrefix, type DiscoveredPage } from "./sitemap";
import { parseMintJson } from "./mintjson";

// =============================================================================
// DISCOVERY ENGINE - Orchestrates page discovery
// =============================================================================

export type { DiscoveredPage } from "./sitemap";

export type DiscoveryMethod = "sitemap" | "mintjson" | "auto";

export interface DiscoveryOptions {
  method?: DiscoveryMethod;
  prefix?: string;
  verbose?: boolean;
}

export interface DiscoveryResult {
  pages: DiscoveredPage[];
  method: "sitemap" | "mintjson";
  total: number;
  filtered: number;
}

/** Discover pages from a documentation site */
export async function discoverPages(
  baseUrl: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const { method = "auto", prefix, verbose = false } = options;
  const normalizedUrl = baseUrl.replace(/\/$/, "");

  let pages: DiscoveredPage[] = [];
  let usedMethod: "sitemap" | "mintjson" = "sitemap";

  if (method === "sitemap" || method === "auto") {
    if (verbose) console.error(`Trying sitemap.xml from ${normalizedUrl}...`);
    pages = await parseSitemap(normalizedUrl);

    if (pages.length > 0) {
      usedMethod = "sitemap";
      if (verbose) console.error(`Found ${pages.length} pages in sitemap.xml`);
    }
  }

  if (pages.length === 0 && (method === "mintjson" || method === "auto")) {
    if (verbose) console.error(`Trying mint.json from ${normalizedUrl}...`);
    pages = await parseMintJson(normalizedUrl);

    if (pages.length > 0) {
      usedMethod = "mintjson";
      if (verbose) console.error(`Found ${pages.length} pages in mint.json`);
    }
  }

  const totalPages = pages.length;

  // Filter by prefix if specified
  if (prefix && pages.length > 0) {
    pages = filterByPrefix(pages, prefix);
    if (verbose) {
      console.error(`Filtered to ${pages.length} pages with prefix "${prefix}"`);
    }
  }

  return {
    pages,
    method: usedMethod,
    total: totalPages,
    filtered: pages.length,
  };
}

/** Check if a URL is a valid Mintlify site */
export async function isMintlifySite(baseUrl: string): Promise<boolean> {
  const normalizedUrl = baseUrl.replace(/\/$/, "");

  // Check for mint.json (definitive indicator)
  try {
    const response = await fetch(`${normalizedUrl}/mint.json`, {
      method: "HEAD",
      headers: { "User-Agent": "mintlify-mcp/1.0" },
    });
    if (response.ok) return true;
  } catch {
    // Continue checking
  }

  // Check for sitemap.xml (less definitive but common)
  try {
    const response = await fetch(`${normalizedUrl}/sitemap.xml`, {
      method: "HEAD",
      headers: { "User-Agent": "mintlify-mcp/1.0" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Get the markdown URL for a page */
export function getMarkdownUrl(page: DiscoveredPage): string {
  // Mintlify serves markdown at {path}.md
  const url = page.url.replace(/\/$/, "");
  return `${url}.md`;
}

/** Batch get markdown URLs */
export function getMarkdownUrls(pages: DiscoveredPage[]): string[] {
  return pages.map(getMarkdownUrl);
}
