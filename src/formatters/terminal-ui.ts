import * as p from "@clack/prompts";
import pc from "picocolors";
import clipboardy from "clipboardy";
import type { CrashContext } from "../core/collector.js";
import { generateMarkdownReport } from "./markdown.js";

export type MenuAction = "exit" | "rerun";

export interface TerminalUIOptions {
  context: CrashContext;
  redactedOutput: string;
  snapshotPath?: string;
}

/**
 * Renders the post-crash interactive Clack TUI.
 * Returns the user's chosen next step: "exit" or "rerun".
 */
export async function showPostCrashUI(options: TerminalUIOptions): Promise<MenuAction> {
  const { context, redactedOutput, snapshotPath } = options;
  const markdownReport = generateMarkdownReport(context, redactedOutput);

  // If running in a non-interactive environment (CI, script pipes) or stdin is closed/destroyed
  if (!process.stdin.isTTY || process.stdin.destroyed || !process.stdin.readable) {
    console.error(pc.red(`\n[wtf] Command failed with exit code ${context.exitCode}: ${context.command}`));
    if (snapshotPath) {
      console.error(pc.dim(`[wtf] Diagnostic snapshot saved to: ${snapshotPath}`));
      console.error(pc.cyan(`[wtf] Run 'wtf last' to view or copy the LLM diagnostic report.\n`));
    }
    return "exit";
  }

  try {
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }

    p.intro(pc.bgRed(pc.white(pc.bold(" WTF Just Happened? Command Crashed "))));

    p.note(
      [
        `${pc.bold("Command:")}   ${pc.cyan(context.command)}`,
        `${pc.bold("Exit Code:")} ${pc.red(String(context.exitCode))}`,
        `${pc.bold("Duration:")}  ${context.durationMs}ms`,
        snapshotPath ? `${pc.bold("Snapshot:")}  ${pc.dim(snapshotPath)}` : "",
        context.activePorts.length > 0
          ? `${pc.bold("Active Ports:")} ${pc.yellow(context.activePorts.map((p) => p.port).join(", "))}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "Crash Summary"
    );

    let active = true;

    while (active) {
      let choice: any;
      try {
        choice = await p.select({
          message: "What would you like to do?",
          options: [
            {
              value: "copy",
              label: "Copy Markdown Report",
              hint: "Ready-to-paste for ChatGPT, Claude, GitHub Issues",
            },
            {
              value: "view-output",
              label: "View Redacted Terminal Output",
              hint: "Shows trailing captured logs",
            },
            {
              value: "view-markdown",
              label: "Print Full Markdown Report",
              hint: "Outputs raw markdown in console",
            },
            {
              value: "view-env",
              label: "View Environment & System Context",
              hint: "Inspect sanitized env vars and OS specs",
            },
            {
              value: "rerun",
              label: "Re-run Command",
              hint: "Attempt executing the command again",
            },
            {
              value: "exit",
              label: "Exit",
              hint: `Exits with code ${context.exitCode}`,
            },
          ],
        });
      } catch {
        // Stdin was terminated or aborted
        return "exit";
      }

      if (p.isCancel(choice) || choice === "exit") {
        p.outro(pc.dim(`Exiting.`));
        return "exit";
      }

      if (choice === "copy") {
        try {
          await clipboardy.write(markdownReport);
          p.log.success(pc.green("Markdown diagnostic report copied to clipboard."));
        } catch (err: any) {
          p.log.error(pc.red(`Failed to copy to clipboard: ${err.message}`));
        }
      } else if (choice === "view-output") {
        console.log("\n" + pc.dim("--- Captured Output (Redacted) ---"));
        console.log(redactedOutput.trim() || pc.dim("[No output captured]"));
        console.log(pc.dim("-----------------------------------\n"));
      } else if (choice === "view-markdown") {
        console.log("\n" + markdownReport + "\n");
      } else if (choice === "view-env") {
        console.log("\n" + pc.dim("--- Environment & System Context ---"));
        console.log(`${pc.bold("Platform:")} ${context.system.platform} (${context.system.arch})`);
        console.log(`${pc.bold("OS Release:")} ${context.system.osRelease}`);
        console.log(`${pc.bold("Node:")} ${context.system.nodeVersion}`);
        console.log(`${pc.bold("CWD:")} ${context.system.cwd}`);
        console.log(`${pc.bold("Memory:")} ${context.system.freeMemoryMB}MB free / ${context.system.totalMemoryMB}MB total`);
        console.log(pc.bold("\nSanitized Environment:"));
        for (const [k, v] of Object.entries(context.environment)) {
          console.log(`  ${pc.cyan(k)}=${pc.yellow(v)}`);
        }
        console.log(pc.dim("------------------------------------\n"));
      } else if (choice === "rerun") {
        p.outro(pc.cyan(`Re-running: ${context.command}...`));
        return "rerun";
      }
    }

    return "exit";
  } catch {
    // Graceful fallback if TUI encounters an environment error
    console.error(pc.red(`\n[wtf] Command failed with exit code ${context.exitCode}: ${context.command}`));
    if (snapshotPath) {
      console.error(pc.dim(`[wtf] Diagnostic snapshot saved to: ${snapshotPath}`));
      console.error(pc.cyan(`[wtf] Run 'wtf last' to view or copy the LLM diagnostic report.\n`));
    }
    return "exit";
  }

  return "exit";
}
