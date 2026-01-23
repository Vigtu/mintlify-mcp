import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  validateUrl,
  validateProjectId,
  validatePort,
  validateHostname,
  sanitizeForLogging,
  resetSecurityConfig,
  getSecurityConfig,
  type SecurityConfig,
} from "../src/security";

// =============================================================================
// URL VALIDATION TESTS (SSRF Protection)
// =============================================================================

describe("URL Validation (SSRF Protection)", () => {
  beforeEach(() => {
    resetSecurityConfig();
  });

  describe("Valid URLs", () => {
    test("accepts HTTPS URLs", () => {
      const result = validateUrl("https://docs.example.com/api");
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe("https://docs.example.com/api");
    });

    test("accepts HTTP URLs", () => {
      const result = validateUrl("http://docs.example.com/api");
      expect(result.valid).toBe(true);
    });

    test("accepts URLs with ports", () => {
      const result = validateUrl("https://docs.example.com:8080/api");
      expect(result.valid).toBe(true);
    });

    test("accepts URLs with query params", () => {
      const result = validateUrl("https://docs.example.com/api?key=value");
      expect(result.valid).toBe(true);
    });

    test("normalizes URLs by removing credentials", () => {
      const result = validateUrl("https://user:pass@docs.example.com/api");
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe("https://docs.example.com/api");
    });
  });

  describe("SSRF - Private IPs (blocked by default)", () => {
    test("blocks 127.0.0.1 (loopback)", () => {
      const result = validateUrl("http://127.0.0.1/api");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("localhost");
    });

    test("blocks 10.x.x.x (Class A private)", () => {
      const result = validateUrl("http://10.0.0.1/api");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("private");
    });

    test("blocks 172.16.x.x (Class B private)", () => {
      const result = validateUrl("http://172.16.0.1/api");
      expect(result.valid).toBe(false);
    });

    test("blocks 192.168.x.x (Class C private)", () => {
      const result = validateUrl("http://192.168.1.1/api");
      expect(result.valid).toBe(false);
    });

    test("blocks 169.254.169.254 (AWS metadata)", () => {
      const result = validateUrl("http://169.254.169.254/latest/meta-data/");
      expect(result.valid).toBe(false);
    });
  });

  describe("SSRF - Localhost variants (blocked by default)", () => {
    test("blocks localhost", () => {
      const result = validateUrl("http://localhost/api");
      expect(result.valid).toBe(false);
    });

    test("blocks localhost.localdomain", () => {
      const result = validateUrl("http://localhost.localdomain/api");
      expect(result.valid).toBe(false);
    });

    test("blocks 0.0.0.0", () => {
      const result = validateUrl("http://0.0.0.0/api");
      expect(result.valid).toBe(false);
    });
  });

  describe("SSRF - Cloud metadata endpoints", () => {
    test("blocks GCP metadata", () => {
      const result = validateUrl("http://metadata.google.internal/");
      expect(result.valid).toBe(false);
    });
  });

  describe("Protocol validation", () => {
    test("blocks file:// protocol", () => {
      const result = validateUrl("file:///etc/passwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Protocol");
    });

    test("blocks gopher:// protocol", () => {
      const result = validateUrl("gopher://evil.com/");
      expect(result.valid).toBe(false);
    });

    test("blocks javascript: protocol", () => {
      const result = validateUrl("javascript:alert(1)");
      expect(result.valid).toBe(false);
    });

    test("blocks data: protocol", () => {
      const result = validateUrl("data:text/html,<script>alert(1)</script>");
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid URL formats", () => {
    test("rejects malformed URLs", () => {
      const result = validateUrl("not-a-url");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });

    test("rejects empty string", () => {
      const result = validateUrl("");
      expect(result.valid).toBe(false);
    });

    test("rejects very long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(3000);
      const result = validateUrl(longUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("length");
    });
  });

  describe("Enterprise configuration", () => {
    afterEach(() => {
      delete process.env.DOCMOLE_ALLOW_PRIVATE_IPS;
      delete process.env.DOCMOLE_ALLOW_LOCALHOST;
      delete process.env.DOCMOLE_ALLOWED_HOSTS;
      delete process.env.DOCMOLE_BLOCKED_HOSTS;
      resetSecurityConfig();
    });

    test("allows private IPs when DOCMOLE_ALLOW_PRIVATE_IPS=true", () => {
      process.env.DOCMOLE_ALLOW_PRIVATE_IPS = "true";
      resetSecurityConfig();

      const result = validateUrl("http://10.0.0.1/api");
      expect(result.valid).toBe(true);
    });

    test("allows localhost when DOCMOLE_ALLOW_LOCALHOST=true", () => {
      process.env.DOCMOLE_ALLOW_LOCALHOST = "true";
      resetSecurityConfig();

      const result = validateUrl("http://localhost:3000/api");
      expect(result.valid).toBe(true);
    });

    test("whitelist mode with DOCMOLE_ALLOWED_HOSTS", () => {
      process.env.DOCMOLE_ALLOWED_HOSTS = "docs.mycompany.com,api.mycompany.com";
      resetSecurityConfig();

      expect(validateUrl("https://docs.mycompany.com/api").valid).toBe(true);
      expect(validateUrl("https://api.mycompany.com/api").valid).toBe(true);
      expect(validateUrl("https://evil.com/api").valid).toBe(false);
    });

    test("additional blocked hosts with DOCMOLE_BLOCKED_HOSTS", () => {
      process.env.DOCMOLE_BLOCKED_HOSTS = "blocked.com,evil.io";
      resetSecurityConfig();

      expect(validateUrl("https://blocked.com/api").valid).toBe(false);
      expect(validateUrl("https://evil.io/api").valid).toBe(false);
      expect(validateUrl("https://allowed.com/api").valid).toBe(true);
    });
  });
});

// =============================================================================
// PROJECT ID VALIDATION TESTS (Path Traversal Protection)
// =============================================================================

describe("Project ID Validation (Path Traversal Protection)", () => {
  describe("Valid project IDs", () => {
    test("accepts simple lowercase names", () => {
      const result = validateProjectId("myproject");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("myproject");
    });

    test("accepts names with numbers", () => {
      const result = validateProjectId("project123");
      expect(result.valid).toBe(true);
    });

    test("accepts names with hyphens", () => {
      const result = validateProjectId("my-project-name");
      expect(result.valid).toBe(true);
    });

    test("accepts single character", () => {
      const result = validateProjectId("a");
      expect(result.valid).toBe(true);
    });

    test("trims whitespace", () => {
      const result = validateProjectId("  myproject  ");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("myproject");
    });
  });

  describe("Path traversal attempts", () => {
    test("rejects ../", () => {
      const result = validateProjectId("../etc/passwd");
      expect(result.valid).toBe(false);
    });

    test("rejects ..\\", () => {
      const result = validateProjectId("..\\windows\\system32");
      expect(result.valid).toBe(false);
    });

    test("rejects forward slash", () => {
      const result = validateProjectId("project/subdir");
      expect(result.valid).toBe(false);
    });

    test("rejects backslash", () => {
      const result = validateProjectId("project\\subdir");
      expect(result.valid).toBe(false);
    });

    test("rejects ..", () => {
      const result = validateProjectId("..");
      expect(result.valid).toBe(false);
    });

    test("rejects .", () => {
      const result = validateProjectId(".");
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid formats", () => {
    test("rejects uppercase letters", () => {
      const result = validateProjectId("MyProject");
      expect(result.valid).toBe(false);
    });

    test("rejects starting with hyphen", () => {
      const result = validateProjectId("-myproject");
      expect(result.valid).toBe(false);
    });

    test("rejects ending with hyphen", () => {
      const result = validateProjectId("myproject-");
      expect(result.valid).toBe(false);
    });

    test("rejects special characters", () => {
      const result = validateProjectId("my_project");
      expect(result.valid).toBe(false);
    });

    test("rejects spaces", () => {
      const result = validateProjectId("my project");
      expect(result.valid).toBe(false);
    });

    test("rejects empty string", () => {
      const result = validateProjectId("");
      expect(result.valid).toBe(false);
    });

    test("rejects very long names", () => {
      const result = validateProjectId("a".repeat(100));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("64");
    });
  });

  describe("Reserved names", () => {
    test("rejects Windows reserved names", () => {
      expect(validateProjectId("con").valid).toBe(false);
      expect(validateProjectId("prn").valid).toBe(false);
      expect(validateProjectId("aux").valid).toBe(false);
      expect(validateProjectId("nul").valid).toBe(false);
    });
  });
});

// =============================================================================
// PORT VALIDATION TESTS
// =============================================================================

describe("Port Validation", () => {
  test("accepts valid port numbers", () => {
    expect(validatePort(80)).toBe(80);
    expect(validatePort(443)).toBe(443);
    expect(validatePort(8080)).toBe(8080);
    expect(validatePort(65535)).toBe(65535);
  });

  test("accepts string port numbers", () => {
    expect(validatePort("80")).toBe(80);
    expect(validatePort("8080")).toBe(8080);
  });

  test("rejects port 0", () => {
    expect(validatePort(0)).toBe(null);
  });

  test("rejects negative ports", () => {
    expect(validatePort(-1)).toBe(null);
  });

  test("rejects ports > 65535", () => {
    expect(validatePort(65536)).toBe(null);
  });

  test("rejects non-integer ports", () => {
    expect(validatePort(80.5)).toBe(null);
  });

  test("rejects non-numeric strings", () => {
    expect(validatePort("abc")).toBe(null);
  });

  test("returns null for undefined", () => {
    expect(validatePort(undefined)).toBe(null);
  });
});

// =============================================================================
// HOSTNAME VALIDATION TESTS
// =============================================================================

describe("Hostname Validation", () => {
  test("accepts valid hostnames", () => {
    expect(validateHostname("example.com").valid).toBe(true);
    expect(validateHostname("docs.example.com").valid).toBe(true);
    expect(validateHostname("my-site.io").valid).toBe(true);
  });

  test("accepts IP addresses", () => {
    expect(validateHostname("192.168.1.1").valid).toBe(true);
    expect(validateHostname("8.8.8.8").valid).toBe(true);
  });

  test("converts to lowercase", () => {
    const result = validateHostname("Example.COM");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("example.com");
  });

  test("rejects empty hostname", () => {
    expect(validateHostname("").valid).toBe(false);
  });

  test("rejects hostname with special characters", () => {
    expect(validateHostname("example.com/path").valid).toBe(false);
    expect(validateHostname("example.com:8080").valid).toBe(false);
  });
});

// =============================================================================
// LOGGING SANITIZATION TESTS
// =============================================================================

describe("Logging Sanitization", () => {
  test("masks OpenAI API keys", () => {
    const input = "Using API key: sk-proj-abc123def456ghi789jkl012";
    const result = sanitizeForLogging(input);
    expect(result).not.toContain("abc123");
    expect(result).toContain("sk-****");
  });

  test("masks Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const result = sanitizeForLogging(input);
    expect(result).not.toContain("eyJ");
    expect(result).toContain("Bearer ****");
  });

  test("masks credentials in URLs", () => {
    const input = "Connecting to https://admin:secret123@example.com/api";
    const result = sanitizeForLogging(input);
    expect(result).not.toContain("admin");
    expect(result).not.toContain("secret123");
    expect(result).toContain("****:****@");
  });

  test("masks common secret patterns", () => {
    const input = "Config: api_key=mysecret123 and password=hunter2";
    const result = sanitizeForLogging(input);
    expect(result).not.toContain("mysecret123");
    expect(result).not.toContain("hunter2");
  });

  test("preserves non-sensitive content", () => {
    const input = "Fetching https://docs.example.com/api";
    const result = sanitizeForLogging(input);
    expect(result).toBe(input);
  });
});
