// =============================================================================
// SECURITY CONFIGURATION
// =============================================================================
// Centralized security settings with enterprise override support
//
// Enterprise users can customize via environment variables:
//   DOCMOLE_ALLOW_PRIVATE_IPS=true   # Allow internal network URLs
//   DOCMOLE_ALLOWED_HOSTS=a.com,b.io # Whitelist specific hosts
//   DOCMOLE_BLOCKED_HOSTS=evil.com   # Additional blocked hosts

export interface SecurityConfig {
  /** Allow requests to private/internal IPs (default: false) */
  allowPrivateIPs: boolean;

  /** Allow requests to localhost (default: false) */
  allowLocalhost: boolean;

  /** Allowed protocols (default: ['https:', 'http:']) */
  allowedProtocols: string[];

  /** Additional hosts to block (beyond defaults) */
  blockedHosts: string[];

  /** If set, ONLY these hosts are allowed (whitelist mode) */
  allowedHosts: string[] | null;

  /** Maximum URL length to prevent DoS */
  maxUrlLength: number;

  /** Project ID validation pattern */
  projectIdPattern: RegExp;
}

/** Default security configuration (strict) */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowPrivateIPs: false,
  allowLocalhost: false,
  allowedProtocols: ["https:", "http:"],
  blockedHosts: [],
  allowedHosts: null,
  maxUrlLength: 2048,
  projectIdPattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
};

/** Load security config with environment overrides */
export function loadSecurityConfig(): SecurityConfig {
  const env = process.env;

  return {
    ...DEFAULT_SECURITY_CONFIG,

    // Enterprise can allow private IPs for internal docs
    allowPrivateIPs: env.DOCMOLE_ALLOW_PRIVATE_IPS === "true",

    // Enterprise can allow localhost for dev environments
    allowLocalhost: env.DOCMOLE_ALLOW_LOCALHOST === "true",

    // Additional blocked hosts (comma-separated)
    blockedHosts: env.DOCMOLE_BLOCKED_HOSTS
      ? env.DOCMOLE_BLOCKED_HOSTS.split(",").map((h) => h.trim().toLowerCase())
      : [],

    // Whitelist mode for strict enterprise environments
    allowedHosts: env.DOCMOLE_ALLOWED_HOSTS
      ? env.DOCMOLE_ALLOWED_HOSTS.split(",").map((h) => h.trim().toLowerCase())
      : null,
  };
}

// Singleton instance (lazy loaded)
let _config: SecurityConfig | null = null;

/** Get the current security configuration */
export function getSecurityConfig(): SecurityConfig {
  if (!_config) {
    _config = loadSecurityConfig();
  }
  return _config;
}

/** Reset config (useful for testing) */
export function resetSecurityConfig(): void {
  _config = null;
}
