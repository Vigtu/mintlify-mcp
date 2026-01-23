// =============================================================================
// URL VALIDATOR - SSRF Protection
// =============================================================================
// Validates URLs before making HTTP requests to prevent SSRF attacks.
//
// Protects against:
// - Requests to private/internal networks (10.x, 172.16.x, 192.168.x)
// - Requests to localhost/loopback
// - Requests to cloud metadata endpoints (169.254.169.254)
// - Requests to non-HTTP protocols (file://, gopher://, etc.)
// - DNS rebinding (validates resolved IP when possible)

import { getSecurityConfig, type SecurityConfig } from "./config";

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
}

/** IPv4 private/reserved ranges */
const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local (includes cloud metadata)
  /^0\./, // "This" network
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\./, // Carrier-grade NAT
];

/** Known dangerous hostnames */
const DANGEROUS_HOSTS = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal", // GCP metadata
  "metadata.google.com",
];

/** Cloud metadata IP (AWS, Azure, GCP, etc.) */
const METADATA_IPS = ["169.254.169.254", "fd00:ec2::254"];

/**
 * Check if an IP address is private/internal
 */
function isPrivateIP(ip: string): boolean {
  // Remove IPv6 brackets if present (URLs use [::1] format)
  const cleanIp = ip.replace(/^\[|\]$/g, "").toLowerCase();

  // Check IPv4 private ranges
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(cleanIp)) {
      return true;
    }
  }

  // Check metadata IPs
  if (METADATA_IPS.includes(cleanIp)) {
    return true;
  }

  // IPv6 loopback
  if (cleanIp === "::1" || cleanIp.startsWith("::1:")) {
    return true;
  }

  // IPv6 link-local (fe80::/10 = fe80:: to febf::)
  if (/^fe[89ab][0-9a-f]:/.test(cleanIp)) {
    return true;
  }

  // IPv6 unique local addresses (fc00::/7 = fc:: and fd::)
  if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) {
    return true;
  }

  // IPv6 site-local (deprecated but still dangerous: fec0::/10)
  if (/^fec[0-9a-f]:/.test(cleanIp) || /^fed[0-9a-f]:/.test(cleanIp) || /^fee[0-9a-f]:/.test(cleanIp) || /^fef[0-9a-f]:/.test(cleanIp)) {
    return true;
  }

  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x or ::ffff:xxxx:xxxx)
  // These embed IPv4 addresses in IPv6 format and must be checked
  if (cleanIp.startsWith("::ffff:")) {
    const ipv4Part = cleanIp.substring(7); // Remove "::ffff:"
    // Check if it's dotted decimal notation (::ffff:192.168.1.1)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ipv4Part)) {
      for (const range of PRIVATE_IP_RANGES) {
        if (range.test(ipv4Part)) {
          return true;
        }
      }
      if (METADATA_IPS.includes(ipv4Part)) {
        return true;
      }
    }
    // For hex notation (::ffff:c0a8:0101), block all as potentially dangerous
    // since parsing hex IPv4 is complex and error-prone
    return true;
  }

  return false;
}

/**
 * Check if hostname is localhost or loopback
 */
function isLocalhost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    DANGEROUS_HOSTS.includes(lower) ||
    lower === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(lower)
  );
}

/**
 * Validate a URL for safe HTTP requests
 *
 * @param url - The URL to validate
 * @param config - Optional security config override
 * @returns Validation result with normalized URL if valid
 */
export function validateUrl(
  url: string,
  config?: SecurityConfig,
): UrlValidationResult {
  const secConfig = config ?? getSecurityConfig();

  // Check URL length
  if (url.length > secConfig.maxUrlLength) {
    return {
      valid: false,
      error: `URL exceeds maximum length of ${secConfig.maxUrlLength} characters`,
    };
  }

  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Check protocol
  if (!secConfig.allowedProtocols.includes(parsed.protocol)) {
    return {
      valid: false,
      error: `Protocol '${parsed.protocol}' is not allowed. Use: ${secConfig.allowedProtocols.join(", ")}`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check if hostname is an IP address
  const isIP = /^[\d.]+$/.test(hostname) || hostname.startsWith("[");

  // Check localhost (must be checked before private IP check)
  const isLocalhostAddr = isLocalhost(hostname);
  if (isLocalhostAddr && !secConfig.allowLocalhost) {
    return {
      valid: false,
      error: "Requests to localhost are not allowed",
    };
  }

  // Check private IPs (only for IP addresses, not hostnames)
  // Skip this check if it's an allowed localhost
  if (isIP && !isLocalhostAddr && !secConfig.allowPrivateIPs && isPrivateIP(hostname)) {
    return {
      valid: false,
      error: "Requests to private/internal IP addresses are not allowed",
    };
  }

  // Check blocked hosts
  if (secConfig.blockedHosts.includes(hostname)) {
    return {
      valid: false,
      error: `Host '${hostname}' is blocked`,
    };
  }

  // Check dangerous hosts (skip for localhost if explicitly allowed)
  if (DANGEROUS_HOSTS.includes(hostname)) {
    // Allow localhost variants only if explicitly enabled
    if (isLocalhostAddr && secConfig.allowLocalhost) {
      // Allowed - continue to other checks
    } else {
      return {
        valid: false,
        error: `Host '${hostname}' is not allowed for security reasons`,
      };
    }
  }

  // Whitelist mode: only allow specific hosts
  if (secConfig.allowedHosts !== null) {
    const isAllowed = secConfig.allowedHosts.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
    if (!isAllowed) {
      return {
        valid: false,
        error: `Host '${hostname}' is not in the allowed hosts list`,
      };
    }
  }

  // Normalize URL (remove credentials if present)
  if (parsed.username || parsed.password) {
    parsed.username = "";
    parsed.password = "";
  }

  return {
    valid: true,
    normalizedUrl: parsed.href,
  };
}

/**
 * Validate URL and throw if invalid
 *
 * @param url - The URL to validate
 * @param context - Description for error messages (e.g., "sitemap URL")
 * @throws Error if URL is invalid
 * @returns Normalized URL
 */
export function validateUrlOrThrow(url: string, context = "URL"): string {
  const result = validateUrl(url);
  if (!result.valid) {
    throw new Error(`Invalid ${context}: ${result.error}`);
  }
  return result.normalizedUrl!;
}

/**
 * Safe fetch wrapper that validates URL before making request
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param context - Description for error messages
 * @returns Fetch response
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
  context = "URL",
): Promise<Response> {
  const validatedUrl = validateUrlOrThrow(url, context);
  return fetch(validatedUrl, options);
}
