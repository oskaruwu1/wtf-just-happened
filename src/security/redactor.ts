/**
 * Two-pass secret scrubber:
 * Pass 1: Active environment variable values matching sensitive keys
 * Pass 2: High-confidence regex patterns for AWS keys, JWTs, Bearer tokens, DB URIs, and API tokens
 */

export interface RedactorOptions {
  env?: Record<string, string | undefined>;
}

// Keys that likely contain sensitive values
const SENSITIVE_KEY_PATTERN = /(?:key|token|secret|password|passwd|auth|credential|api[_-]?key|private|access[_-]?key)/i;

// Regex patterns for known secret formats
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; replace: (match: string, ...args: any[]) => string }> = [
  // Private Keys (RSA, EC, PGP, etc.)
  {
    name: "Private Key",
    regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
    replace: () => "[REDACTED_PRIVATE_KEY]",
  },
  // Database connection URIs with password: protocol://user:password@host
  {
    name: "Database URI Password",
    regex: /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/]+):(.+?)@([a-zA-Z0-9_.-]+(?::\d+)?(?:\/|[?#\s]|$))/g,
    replace: (_match, proto, user, _pwd, host) => `${proto}${user}:[REDACTED]@${host}`,
  },
  // AWS Access Key ID
  {
    name: "AWS Access Key",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => "[REDACTED_AWS_KEY]",
  },
  // GitHub Tokens (classic and fine-grained)
  {
    name: "GitHub Token",
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{82})\b/g,
    replace: () => "[REDACTED_GITHUB_TOKEN]",
  },
  // Slack Tokens
  {
    name: "Slack Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g,
    replace: () => "[REDACTED_SLACK_TOKEN]",
  },
  // Stripe API Keys
  {
    name: "Stripe Key",
    regex: /\b[rs]k_(?:test|live)_[0-9a-zA-Z]{24,99}\b/g,
    replace: () => "[REDACTED_STRIPE_KEY]",
  },
  // JWT Tokens (3-part base64 url-safe strings)
  {
    name: "JWT Token",
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    replace: () => "[REDACTED_JWT]",
  },
  // Bearer Authorization Header / Token
  {
    name: "Bearer Token",
    regex: /\b(bearer\s+)([A-Za-z0-9\-._~+/]+=*)\b/gi,
    replace: (_match, prefix) => `${prefix}[REDACTED_BEARER_TOKEN]`,
  },
  // Generic key/secret assignments like apiKey = "...", secret: '...'
  {
    name: "Generic Secret Assignment",
    regex: /\b((?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)\s*[:=]\s*["']?)([^\s"';,]{8,})(["']?)/gi,
    replace: (_match, prefix, _val, suffix) => `${prefix}[REDACTED]${suffix}`,
  },
];

/**
 * Redacts secrets and sensitive information from text.
 */
export function redactSecrets(text: string, options?: RedactorOptions): string {
  if (!text) return text;
  let result = text;

  // PASS 1: Scrub values of sensitive environment variables
  const env = options?.env ?? process.env;
  if (env) {
    const sensitiveValues = new Set<string>();

    for (const [key, value] of Object.entries(env)) {
      if (!value || typeof value !== "string") continue;
      // Value must be at least 6 characters and not common generic words
      if (value.trim().length >= 6 && SENSITIVE_KEY_PATTERN.test(key)) {
        // Exclude common benign values
        const lower = value.toLowerCase().trim();
        if (["true", "false", "null", "undefined", "default", "localhost", "127.0.0.1", "none"].includes(lower)) {
          continue;
        }
        sensitiveValues.add(value);
      }
    }

    // Replace sensitive env values (longest first to avoid partial replacements)
    const sortedValues = Array.from(sensitiveValues).sort((a, b) => b.length - a.length);
    for (const val of sortedValues) {
      // Escape for regex
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "g"), "[REDACTED_ENV_SECRET]");
    }
  }

  // PASS 2: Scrub pattern-based secrets
  for (const { regex, replace } of SECRET_PATTERNS) {
    result = result.replace(regex, replace);
  }

  return result;
}

/**
 * Redacts an environment variable dictionary for safe inspection / reporting.
 */
export function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = redactSecrets(val, { env });
    }
  }

  return sanitized;
}
