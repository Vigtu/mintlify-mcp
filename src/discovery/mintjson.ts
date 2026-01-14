import type { DiscoveredPage } from "./sitemap";

// =============================================================================
// MINT.JSON PARSER - Using Bun's native fetch
// =============================================================================

interface MintNavItem {
  group?: string;
  pages?: (string | MintNavItem)[];
  page?: string;
}

interface MintConfig {
  navigation?: MintNavItem[];
  tabs?: { name: string; url: string }[];
  anchors?: { name: string; url: string }[];
}

/** Parse mint.json from a URL */
export async function parseMintJson(baseUrl: string): Promise<DiscoveredPage[]> {
  const mintUrl = `${baseUrl.replace(/\/$/, "")}/mint.json`;

  try {
    const response = await fetch(mintUrl, {
      headers: {
        "User-Agent": "mintlify-mcp/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(`mint.json fetch failed: ${response.status}`);
      return [];
    }

    const config = (await response.json()) as MintConfig;
    const pages: DiscoveredPage[] = [];
    const baseUrlNormalized = baseUrl.replace(/\/$/, "");

    // Extract pages from navigation
    if (config.navigation) {
      extractPagesFromNav(config.navigation, pages, baseUrlNormalized);
    }

    return pages;
  } catch (error) {
    console.error(`Error parsing mint.json: ${error}`);
    return [];
  }
}

/** Recursively extract pages from navigation structure */
function extractPagesFromNav(
  items: (string | MintNavItem)[],
  pages: DiscoveredPage[],
  baseUrl: string
): void {
  for (const item of items) {
    if (typeof item === "string") {
      // Direct page path
      const path = item.startsWith("/") ? item : `/${item}`;
      pages.push({
        url: `${baseUrl}${path}`,
        path,
      });
    } else if (item.pages) {
      // Group with nested pages
      extractPagesFromNav(item.pages, pages, baseUrl);
    } else if (item.page) {
      // Single page object
      const path = item.page.startsWith("/") ? item.page : `/${item.page}`;
      pages.push({
        url: `${baseUrl}${path}`,
        path,
      });
    }
  }
}

/** Try to fetch and parse mint.json, return null if not available */
export async function tryParseMintJson(
  baseUrl: string
): Promise<DiscoveredPage[] | null> {
  try {
    const pages = await parseMintJson(baseUrl);
    return pages.length > 0 ? pages : null;
  } catch {
    return null;
  }
}
