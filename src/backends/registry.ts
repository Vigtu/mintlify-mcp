// =============================================================================
// BACKEND REGISTRY - Dynamic backend loading with graceful fallbacks
// =============================================================================

import { BACKEND_TYPES, type BackendType } from "../config/schema";
import type { Backend } from "./types";

// =============================================================================
// TYPES
// =============================================================================

// Re-export for convenience
export type { BackendType };

export interface BackendFactory<TOptions = unknown> {
  /** Human-readable name */
  displayName: string;
  /** Required npm dependencies (for error messages) */
  requiredDependencies: string[];
  /** Create a backend instance */
  create: (options: TOptions) => Promise<Backend>;
}

export interface BackendLoadResult {
  success: boolean;
  factory?: BackendFactory;
  error?: BackendLoadError;
}

export interface BackendLoadError {
  type: "not_found" | "dependency_missing" | "import_error";
  message: string;
  details?: string;
  suggestion?: string;
}

// =============================================================================
// REGISTRY - Cache for loaded backends
// =============================================================================

const cache = new Map<BackendType, BackendFactory>();

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Load a backend dynamically with graceful error handling
 * Uses Bun's native module resolution and caching
 */
export async function loadBackend(
  type: BackendType,
): Promise<BackendLoadResult> {
  // Return from cache if already loaded
  if (cache.has(type)) {
    return { success: true, factory: cache.get(type)! };
  }

  // Validate backend type is known
  if (!BACKEND_TYPES.includes(type)) {
    return {
      success: false,
      error: {
        type: "not_found",
        message: `Unknown backend type: "${type}"`,
        suggestion: `Valid backends are: ${BACKEND_TYPES.join(", ")}`,
      },
    };
  }

  const modulePath = getModulePath(type);

  try {
    // Dynamic import - Bun handles this natively
    const module = await import(modulePath);

    // Validate factory export
    if (!module.backendFactory) {
      return {
        success: false,
        error: {
          type: "import_error",
          message: `Backend "${type}" missing factory export`,
          details: "Module must export 'backendFactory'",
        },
      };
    }

    const factory = module.backendFactory as BackendFactory;

    // Cache for future use
    cache.set(type, factory);

    return { success: true, factory };
  } catch (error) {
    return handleImportError(type, error);
  }
}

/**
 * Get a backend factory, throwing descriptive error if unavailable
 */
export async function getBackend(type: BackendType): Promise<BackendFactory> {
  const result = await loadBackend(type);

  if (!result.success || !result.factory) {
    const err = result.error!;
    throw new Error(
      [err.message, err.details, err.suggestion].filter(Boolean).join("\n"),
    );
  }

  return result.factory;
}

/**
 * Check if a backend is available without throwing
 */
export async function isBackendAvailable(type: BackendType): Promise<boolean> {
  const result = await loadBackend(type);
  return result.success;
}

/**
 * Get list of available backends (checks all known types)
 */
export async function getAvailableBackends(): Promise<BackendType[]> {
  const available: BackendType[] = [];

  for (const type of BACKEND_TYPES) {
    if (await isBackendAvailable(type)) {
      available.push(type);
    }
  }

  return available;
}

// =============================================================================
// HELPERS
// =============================================================================

function getModulePath(type: BackendType): string {
  // All backends follow the pattern ./${type}
  return `./${type}`;
}

function handleImportError(
  type: BackendType,
  error: unknown,
): BackendLoadResult {
  if (!(error instanceof Error)) {
    return {
      success: false,
      error: {
        type: "import_error",
        message: `Failed to load backend "${type}"`,
        details: String(error),
      },
    };
  }

  // Check for missing module/dependencies
  const isMissingModule =
    error.message.includes("Cannot find module") ||
    error.message.includes("Cannot find package") ||
    error.message.includes("Module not found") ||
    error.message.includes("Cannot resolve");

  if (isMissingModule) {
    return {
      success: false,
      error: {
        type: "dependency_missing",
        message: `Backend "${type}" is not available in this version`,
        details: error.message,
        suggestion: getSuggestion(type),
      },
    };
  }

  return {
    success: false,
    error: {
      type: "import_error",
      message: `Failed to load backend "${type}"`,
      details: error.message,
      suggestion: "Check that all dependencies are installed",
    },
  };
}

/** Suggestions for when a backend fails to load */
const BACKEND_SUGGESTIONS: Record<BackendType, string> = {
  mintlify: "Check your internet connection",
  embedded:
    "Install from source (git clone + bun install) or use --backend mintlify",
  agno: "Install Python dependencies: pip install agno",
};

function getSuggestion(type: BackendType): string {
  return BACKEND_SUGGESTIONS[type] ?? "Try reinstalling the package";
}
