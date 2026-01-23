// =============================================================================
// SECURITY MODULE - Centralized Security Utilities
// =============================================================================
//
// This module provides security primitives for the entire application.
// All security-related validation should go through these functions.
//
// Usage:
//   import { validateUrl, validateProjectId, safeFetch } from './security';
//
// Enterprise Configuration:
//   Set environment variables to customize security behavior:
//   - DOCMOLE_ALLOW_PRIVATE_IPS=true   # Allow internal network URLs
//   - DOCMOLE_ALLOW_LOCALHOST=true     # Allow localhost (dev mode)
//   - DOCMOLE_ALLOWED_HOSTS=a.com,b.io # Whitelist mode
//   - DOCMOLE_BLOCKED_HOSTS=evil.com   # Block specific hosts

// Configuration
export {
  DEFAULT_SECURITY_CONFIG,
  getSecurityConfig,
  loadSecurityConfig,
  resetSecurityConfig,
  type SecurityConfig,
} from "./config";

// URL Validation (SSRF Protection)
export {
  safeFetch,
  validateUrl,
  validateUrlOrThrow,
  type UrlValidationResult,
} from "./url-validator";

// Input Sanitization (Path Traversal, Injection)
export {
  sanitizeForLogging,
  validateHostname,
  validatePort,
  validatePortOrThrow,
  validateProjectId,
  validateProjectIdOrThrow,
  type ValidationResult,
} from "./input-sanitizer";
