import { describe, it, expect } from "vitest";
import { exec } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve(process.cwd(), "dist", "cli.js");

function runCli(args: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(`node "${cliPath}" ${args}`, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    });
  });
}

describe("CLI Integration Tests", () => {
  it("prints help and exits with 0 on --help", async () => {
    const res = await runCli("--help");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("wtf-just-happened");
    expect(res.stdout).toContain("USAGE:");
  });

  it("prints version on --version", async () => {
    const res = await runCli("--version");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("wtf-just-happened v");
  });

  it("executes passing command silently with exit code 0", async () => {
    // When a command succeeds, wtf stays completely invisible and exits 0
    const res = await runCli('node -e "console.log(\'Operation Succeeded\')"');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Operation Succeeded");
    // Ensure no WTF crash banner appears
    expect(res.stdout).not.toContain("WTF Just Happened");
    expect(res.stderr).not.toContain("WTF Just Happened");
  });

  it("propagates exact exit code on failure and creates snapshot", async () => {
    // When a command crashes with exit code 42
    const res = await runCli('node -e "console.error(\'Critical Failure\'); process.exit(42)"');
    expect(res.code).toBe(42);
    // In non-TTY environment, error message and snapshot location are printed to stderr
    expect(res.stderr).toContain("Critical Failure");
    expect(res.stderr).toContain("failed with exit code 42");
    expect(res.stderr).toContain("Diagnostic snapshot saved");
  });

  it("propagates exit code 1 on standard errors", async () => {
    const res = await runCli('node -e "throw new Error(\'Boom\')"');
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Boom");
    expect(res.stderr).toContain("failed with exit code 1");
  });
});
