// =============================================================================
// INPUT SANITIZER - Path Traversal & Injection Protection
// =============================================================================
// Centralized input validation and sanitization.
//
// Protects against:
// - Path traversal (../, etc.)
// - Command injection
// - Invalid identifiers

import { getSecurityConfig } from "./config";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validate and sanitize a project ID
 *
 * Rules:
 * - Only lowercase letters, numbers, and hyphens
 * - Cannot start or end with hyphen
 * - Cannot be empty
 * - Cannot contain path separators or special characters
 * - Maximum 64 characters
 *
 * @param projectId - The project ID to validate
 * @returns Validation result with sanitized ID if valid
 */
export function validateProjectId(projectId: string): ValidationResult {
  // Check for null/undefined/empty
  if (!projectId || typeof projectId !== "string") {
    return { valid: false, error: "Project ID is required" };
  }

  const trimmed = projectId.trim();

  // Check length
  if (trimmed.length === 0) {
    return { valid: false, error: "Project ID cannot be empty" };
  }

  if (trimmed.length > 64) {
    return {
      valid: false,
      error: "Project ID cannot exceed 64 characters",
    };
  }

  // Check for path traversal attempts
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return {
      valid: false,
      error: "Project ID contains invalid characters",
    };
  }

  // Check against pattern
  const config = getSecurityConfig();
  if (!config.projectIdPattern.test(trimmed)) {
    return {
      valid: false,
      error: "Project ID must contain only lowercase letters, numbers, and hyphens (cannot start/end with hyphen)",
    };
  }

  // Check for reserved names
  const reserved = [".", "..", "con", "prn", "aux", "nul", "com1", "lpt1"];
  if (reserved.includes(trimmed.toLowerCase())) {
    return {
      valid: false,
      error: "Project ID uses a reserved name",
    };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate project ID and throw if invalid
 *
 * @param projectId - The project ID to validate
 * @throws Error if project ID is invalid
 * @returns Sanitized project ID
 */
export function validateProjectIdOrThrow(projectId: string): string {
  const result = validateProjectId(projectId);
  if (!result.valid) {
    throw new Error(`Invalid project ID: ${result.error}`);
  }
  return result.sanitized!;
}

/**
 * Validate a port number
 *
 * @param port - The port to validate (string or number)
 * @returns Validated port number or null if invalid
 */
export function validatePort(port: string | number | undefined): number | null {
  if (port === undefined || port === null) {
    return null;
  }

  const portNum = typeof port === "string" ? parseInt(port, 10) : port;

  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return null;
  }

  return portNum;
}

/**
 * Validate port and throw if invalid
 *
 * @param port - The port to validate
 * @param defaultPort - Default port if not specified
 * @throws Error if port is invalid
 * @returns Validated port number
 */
export function validatePortOrThrow(
  port: string | number | undefined,
  defaultPort: number,
): number {
  if (port === undefined || port === null) {
    return defaultPort;
  }

  const validated = validatePort(port);
  if (validated === null) {
    throw new Error(
      `Invalid port: '${port}'. Port must be a number between 1 and 65535`,
    );
  }

  return validated;
}

/**
 * Sanitize a string for safe logging (remove sensitive data patterns)
 *
 * @param input - The string to sanitize
 * @returns Sanitized string safe for logging
 */
export function sanitizeForLogging(input: string): string {
  return input
    // Mask OpenAI API keys (sk-xxx, sk-proj-xxx, etc.)
    .replace(/sk-[a-zA-Z0-9-]{10,}/g, "sk-****")
    // Mask Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer ****")
    // Mask basic auth in URLs
    .replace(/:\/\/[^:]+:[^@]+@/g, "://****:****@")
    // Mask common secret patterns
    .replace(/(api[_-]?key|secret|password|token)[=:]["']?[^"'\s]+/gi, "$1=****");
}

/**
 * Validate a hostname/domain
 *
 * @param hostname - The hostname to validate
 * @returns Validation result
 */
export function validateHostname(hostname: string): ValidationResult {
  if (!hostname || typeof hostname !== "string") {
    return { valid: false, error: "Hostname is required" };
  }

  const trimmed = hostname.trim().toLowerCase();

  // Check length
  if (trimmed.length === 0 || trimmed.length > 253) {
    return { valid: false, error: "Invalid hostname length" };
  }

  // Basic hostname validation (allows domains and IPs)
  const hostnamePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;

  if (!hostnamePattern.test(trimmed) && !ipPattern.test(trimmed)) {
    return { valid: false, error: "Invalid hostname format" };
  }

  return { valid: true, sanitized: trimmed };
}
