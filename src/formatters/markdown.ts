import type { CrashContext } from "../core/collector.js";

/**
 * Generates an optimized Markdown diagnostic report formatted for GitHub Issues and LLM analysis.
 */
export function generateMarkdownReport(context: CrashContext, redactedOutput: string): string {
  const parts: string[] = [];

  parts.push(`# Diagnostic Crash Report: \`${context.command}\``);
  parts.push("");
  parts.push("## Summary");
  parts.push("| Metric | Value |");
  parts.push("| :--- | :--- |");
  parts.push(`| **Command** | \`${context.command}\` |`);
  parts.push(`| **Exit Code** | \`${context.exitCode}\` |`);
  parts.push(`| **Duration** | \`${context.durationMs}ms\` |`);
  parts.push(`| **Timestamp** | ${context.timestamp} |`);
  parts.push(`| **Platform** | \`${context.system.platform}\` (${context.system.arch}) |`);
  parts.push(`| **Node Version** | \`${context.system.nodeVersion}\` |`);
  parts.push(`| **Working Dir** | \`${context.system.cwd}\` |`);

  if (context.git) {
    const gitInfo = [
      context.git.branch ? `Branch: \`${context.git.branch}\`` : "",
      context.git.commit ? `Commit: \`${context.git.commit}\`` : "",
      context.git.isDirty !== undefined ? `Working Tree: ${context.git.isDirty ? "Dirty" : "Clean"}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    parts.push(`| **Git Context** | ${gitInfo} |`);
  }

  // Active Ports section if any were detected
  if (context.activePorts.length > 0) {
    parts.push("");
    parts.push("## Active Network Ports");
    parts.push("The following ports were detected as listening/active at the time of failure:");
    for (const p of context.activePorts) {
      parts.push(`- **Port ${p.port}**: In use (${p.details || "Active listener"})`);
    }
  }

  // Captured Terminal Logs
  parts.push("");
  parts.push("## Captured Terminal Output (Trailing 64KB)");
  parts.push("*(All credentials, tokens, DB passwords, and sensitive environment variables have been automatically scrubbed)*");
  parts.push("");
  parts.push("```text");
  parts.push(redactedOutput.trim() || "[No output captured]");
  parts.push("```");

  // System & Environment Details
  parts.push("");
  parts.push("<details>");
  parts.push("<summary><strong>System & Environment Diagnostics</strong></summary>");
  parts.push("");
  parts.push("### Hardware & OS");
  parts.push(`- **OS Release:** ${context.system.osRelease}`);
  parts.push(`- **CPUs:** ${context.system.cpuCount}`);
  parts.push(`- **Memory:** ${context.system.freeMemoryMB} MB free / ${context.system.totalMemoryMB} MB total`);
  parts.push("");

  const envEntries = Object.entries(context.environment);
  if (envEntries.length > 0) {
    parts.push("### Relevant Environment Variables");
    parts.push("| Variable | Value |");
    parts.push("| :--- | :--- |");
    for (const [key, val] of envEntries) {
      parts.push(`| \`${key}\` | \`${val}\` |`);
    }
  }

  parts.push("</details>");

  // Suggested LLM Prompt
  parts.push("");
  parts.push("---");
  parts.push("### Instructions for LLM");
  parts.push(
    "> Please analyze the crash log above, diagnose the root cause of the failure, highlight any missing dependencies or environment conflicts, and provide a concrete step-by-step fix."
  );

  return parts.join("\n");
}
