import { describe, it, expect } from "vitest";
import { redactSecrets, sanitizeEnvironment } from "../src/security/redactor.js";

describe("redactSecrets", () => {
  it("masks AWS Access Key IDs", () => {
    const log = "Failed to upload asset using AWS credentials: AKIAIOSFODNN7EXAMPLE into s3 bucket";
    const redacted = redactSecrets(log);
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).toContain("[REDACTED_AWS_KEY]");
  });

  it("masks JWT tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const log = `Authorization failure for token: ${jwt}`;
    const redacted = redactSecrets(log);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain("[REDACTED_JWT]");
  });

  it("masks Bearer tokens", () => {
    const log = "HTTP request headers: Authorization: Bearer secret_session_token_xyz123456789";
    const redacted = redactSecrets(log);
    expect(redacted).not.toContain("secret_session_token_xyz123456789");
    expect(redacted).toContain("Bearer [REDACTED_BEARER_TOKEN]");
  });

  it("masks database connection URI passwords", () => {
    const postgresUri = "postgres://admin:supersecret123@localhost:5432/prod";
    const redactedPostgres = redactSecrets(`Connecting to ${postgresUri}`);
    expect(redactedPostgres).toBe("Connecting to postgres://admin:[REDACTED]@localhost:5432/prod");

    const mongoUri = "mongodb://clusterUser:p@ssword!123@cluster0.mongodb.net/production";
    const redactedMongo = redactSecrets(`Connecting to ${mongoUri}`);
    expect(redactedMongo).toBe("Connecting to mongodb://clusterUser:[REDACTED]@cluster0.mongodb.net/production");

    const mysqlUri = "mysql://root:toor1234@127.0.0.1:3306/main";
    const redactedMysql = redactSecrets(`Connecting to ${mysqlUri}`);
    expect(redactedMysql).toBe("Connecting to mysql://root:[REDACTED]@127.0.0.1:3306/main");
  });

  it("masks private keys", () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+abcdefghijklmnopqrstuvwxyz1234567890
-----END RSA PRIVATE KEY-----`;
    const log = `Error importing key:\n${key}\nValidation failed`;
    const redacted = redactSecrets(log);
    expect(redacted).not.toContain("MIIEowIBAAKCAQEA0Y1+abcdefghijklmnopqrstuvwxyz1234567890");
    expect(redacted).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("masks sensitive environment variables from pass 1", () => {
    const fakeEnv = {
      API_SECRET_KEY: "ultra_high_entropy_secret_998877",
      NORMAL_VAR: "normal_value",
    };

    const log = "Error occurred while using key: ultra_high_entropy_secret_998877 for service.";
    const redacted = redactSecrets(log, { env: fakeEnv });

    expect(redacted).not.toContain("ultra_high_entropy_secret_998877");
    expect(redacted).toContain("[REDACTED_ENV_SECRET]");
  });

  it("sanitizes environment variable dictionaries", () => {
    const env = {
      NODE_ENV: "production",
      AWS_SECRET_ACCESS_KEY: "super-secret-key-value",
      DATABASE_PASSWORD: "secretPassword123",
      PORT: "8080",
    };

    const sanitized = sanitizeEnvironment(env);
    expect(sanitized.NODE_ENV).toBe("production");
    expect(sanitized.PORT).toBe("8080");
    expect(sanitized.AWS_SECRET_ACCESS_KEY).toBe("[REDACTED]");
    expect(sanitized.DATABASE_PASSWORD).toBe("[REDACTED]");
  });
});
