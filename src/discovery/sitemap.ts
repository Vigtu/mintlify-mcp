import { XMLParser } from "fast-xml-parser";

// =============================================================================
// SITEMAP.XML PARSER - Using Bun's native fetch
// =============================================================================

export interface DiscoveredPage {
  url: string;
  path: string;
  lastmod?: string;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

interface SitemapUrlset {
  urlset?: {
    url?: SitemapUrl | SitemapUrl[];
  };
}

/** Parse sitemap.xml from a URL */
export async function parseSitemap(baseUrl: string): Promise<DiscoveredPage[]> {
  const sitemapUrl = `${baseUrl.replace(/\/$/, "")}/sitemap.xml`;

  try {
    const response = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": "mintlify-mcp/1.0",
        Accept: "application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      console.error(`Sitemap fetch failed: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xml) as SitemapUrlset;
    const urls = parsed.urlset?.url;

    if (!urls) {
      return [];
    }

    // Normalize to array
    const urlArray = Array.isArray(urls) ? urls : [urls];

    return urlArray
      .filter((item) => item.loc)
      .map((item) => {
        const url = item.loc;
        const parsedUrl = new URL(url);
        return {
          url,
          path: parsedUrl.pathname,
          lastmod: item.lastmod,
        };
      });
  } catch (error) {
    console.error(`Error parsing sitemap: ${error}`);
    return [];
  }
}

/** Filter pages by path prefix */
export function filterByPrefix(
  pages: DiscoveredPage[],
  prefix: string,
): DiscoveredPage[] {
  const normalizedPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return pages.filter((page) => page.path.startsWith(normalizedPrefix));
}
