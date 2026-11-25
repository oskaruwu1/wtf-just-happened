import pc from "picocolors";
import { runCommandWithPty } from "./core/pty-runner.js";
import { RingBuffer } from "./core/ring-buffer.js";
import { collectCrashContext } from "./core/collector.js";
import { redactSecrets } from "./security/redactor.js";
import { saveCrash, getLastCrash } from "./utils/storage.js";
import { showPostCrashUI } from "./formatters/terminal-ui.js";

const VERSION = "1.0.0";

function printHelp(): void {
  console.log(`
${pc.bold(pc.cyan("wtf-just-happened"))} ${pc.dim(`v${VERSION}`)} (alias: ${pc.bold("wtf")})
Transparent PTY wrapper for instant post-crash diagnostics and LLM reporting.

${pc.bold("USAGE:")}
  wtf <command> [args...]
  wtf last
  wtf --demo
  wtf --help

${pc.bold("EXAMPLES:")}
  ${pc.dim("# Runs normally and stays completely invisible if successful")}
  wtf npm run build
  wtf docker compose up
  wtf cargo test

  ${pc.dim("# Re-open interactive menu for the most recent crash")}
  wtf last

  ${pc.dim("# Try an interactive demo crash simulation")}
  wtf --demo

${pc.bold("OPTIONS:")}
  -h, --help       Show this help message
  -v, --version    Show version number
  --demo           Simulate a crash to test the interactive diagnostic menu
  last             View or copy report from the most recent crash snapshot
`);
}

async function handleLast(): Promise<void> {
  const lastCrash = await getLastCrash();
  if (!lastCrash) {
    console.log(pc.yellow("\n[!] No crash snapshots found in ~/.wtf/crashes/\n"));
    process.exit(0);
  }

  console.log(pc.dim(`\nLoading last crash from ${lastCrash.savedAt}...`));
  await showPostCrashUI({
    context: lastCrash.context,
    redactedOutput: lastCrash.redactedOutput,
  });
  process.exit(0);
}

async function handleDemo(): Promise<void> {
  console.log(pc.cyan("Simulating a realistic build failure...\n"));

  const demoOutput = `
[INFO] Starting build for @acme/api-service...
[INFO] Loading configuration from .env.production
[DEBUG] Connecting to postgres://admin:supersecret123@localhost:5432/prod
[DEBUG] Initializing AWS S3 with key AKIAIOSFODNN7EXAMPLE
[ERROR] Build error: Unhandled exception in src/server.ts:42:15
Error: Database connection refused at 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)
    at runMicrotasks (<anonymous>)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
[FATAL] Command exited with code 1
`;

  const cleanOutput = demoOutput.trim();
  const redactedOutput = redactSecrets(cleanOutput);

  const context = await collectCrashContext({
    command: "fake-build --prod",
    exitCode: 1,
    durationMs: 1420,
    cleanOutputTail: cleanOutput,
    rawOutputTail: cleanOutput,
  });

  const snapshotPath = await saveCrash(context, redactedOutput);
  await showPostCrashUI({
    context,
    redactedOutput,
    snapshotPath,
  });

  process.exit(1);
}

function hasErrorsInOutput(cleanOutput: string): boolean {
  if (!cleanOutput || cleanOutput.trim().length === 0) return false;
  const errorIndicators = [
    /\[vite\]\s*(?:internal\s*)?error/i,
    /transform\s*failed/i,
    /failed\s*to\s*(?:compile|bundle|resolve|load|parse|build)/i,
    /syntaxerror:/i,
    /typeerror:/i,
    /referenceerror:/i,
    /unhandled\s*rejection/i,
    /uncaught\s*exception/i,
    /eaddrinuse/i,
    /error:\s*[A-Z]/i,
    /fatal\s*error/i,
    /\bERR!/i,
    /at\s+[a-zA-Z0-9_$.<>]+\s+\([^)]+:\d+:\d+\)/i,
  ];
  return errorIndicators.some((pattern) => pattern.test(cleanOutput));
}

async function executeCommand(command: string, args: string[]): Promise<void> {
  let shouldRun = true;

  while (shouldRun) {
    const ringBuffer = new RingBuffer({ maxBytes: 64 * 1024 });

    const result = await runCommandWithPty(command, args, { ringBuffer });

    // Transparent behavior: If command succeeded, exit cleanly with 0
    if (result.exitCode === 0) {
      process.exit(0);
    }

    // Check if the user manually terminated the command with Ctrl+C / SIGINT
    if (result.userInterrupted) {
      const hasErrors = hasErrorsInOutput(result.outputTailClean);
      if (!hasErrors) {
        // User stopped a clean process normally (e.g. closing dev server)
        process.exit(0);
      }

      // User stopped a dev server or command that had logged errors!
      const redactedOutput = redactSecrets(result.outputTailClean);
      const context = await collectCrashContext({
        command: `${command} ${args.join(" ")}`.trim(),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        cleanOutputTail: result.outputTailClean,
        rawOutputTail: result.outputTailRaw,
      });

      let snapshotPath: string | undefined;
      try {
        snapshotPath = await saveCrash(context, redactedOutput);
      } catch {
        // Ignore storage errors
      }

      await showPostCrashUI({
        context,
        redactedOutput,
        snapshotPath,
      });

      process.exit(0);
    }

    // Command failed: Scrub secrets and collect diagnostics
    const redactedOutput = redactSecrets(result.outputTailClean);

    const context = await collectCrashContext({
      command: `${command} ${args.join(" ")}`.trim(),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      cleanOutputTail: result.outputTailClean,
      rawOutputTail: result.outputTailRaw,
    });

    let snapshotPath: string | undefined;
    try {
      snapshotPath = await saveCrash(context, redactedOutput);
    } catch {
      // Storage error shouldn't crash the UI
    }

    const action = await showPostCrashUI({
      context,
      redactedOutput,
      snapshotPath,
    });

    if (action === "rerun") {
      console.log("\n" + pc.dim("----------------------------------------") + "\n");
      shouldRun = true;
    } else {
      shouldRun = false;
      process.exit(result.exitCode);
    }
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
    console.log(`wtf-just-happened v${VERSION}`);
    process.exit(0);
  }

  if (rawArgs[0] === "last") {
    await handleLast();
    return;
  }

  if (rawArgs.includes("--demo")) {
    await handleDemo();
    return;
  }

  const [command, ...args] = rawArgs;
  await executeCommand(command, args);
}

main().catch((err) => {
  console.error(pc.red(`\n[wtf] Unexpected error: ${err.message}`));
  process.exit(1);
});
