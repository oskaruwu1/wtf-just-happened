import { spawn as childProcessSpawn, type ChildProcess } from "node:child_process";
import { RingBuffer } from "./ring-buffer.js";

export interface RunnerResult {
  exitCode: number;
  durationMs: number;
  outputTailRaw: string;
  outputTailClean: string;
  userInterrupted: boolean;
  signal?: string | number | null;
}

export interface RunnerOptions {
  ringBuffer?: RingBuffer;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Attempts to dynamically import `node-pty`. Returns undefined if unavailable or native bindings fail.
 */
async function loadNodePty(): Promise<any | undefined> {
  try {
    const ptyModule = await import("node-pty");
    // Handle both default and named export
    return ptyModule.default || ptyModule;
  } catch {
    return undefined;
  }
}

/**
 * Spawns a process using node-pty if available, or falls back to child_process.spawn.
 * Forwards I/O transparently and captures output in the ring buffer.
 */
export async function runCommandWithPty(
  command: string,
  args: string[] = [],
  options?: RunnerOptions
): Promise<RunnerResult> {
  const ringBuffer = options?.ringBuffer ?? new RingBuffer();
  const startTime = Date.now();
  const cwd = options?.cwd ?? process.cwd();
  const env: NodeJS.ProcessEnv = options?.env ?? process.env;

  const nodePty = await loadNodePty();

  if (nodePty && typeof nodePty.spawn === "function") {
    try {
      return await runWithNodePty(nodePty, command, args, ringBuffer, cwd, env, startTime);
    } catch {
      // If node-pty fails during execution, fall through to fallback
    }
  }

  // Fallback to standard child_process.spawn
  return await runWithChildProcess(command, args, ringBuffer, cwd, env, startTime);
}

/**
 * PTY runner using node-pty
 */
function runWithNodePty(
  pty: any,
  command: string,
  args: string[],
  ringBuffer: RingBuffer,
  cwd: string,
  env: NodeJS.ProcessEnv,
  startTime: number
): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    let ptyProcess: any;
    try {
      const file = isWindows && ["npm", "npx", "pnpm", "yarn"].includes(command.toLowerCase())
        ? `${command}.cmd`
        : command;
      ptyProcess = pty.spawn(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: env as Record<string, string>,
        useConpty: isWindows,
      });
    } catch (err) {
      reject(err);
      return;
    }

    let userInterrupted = false;
    const onSigInt = () => {
      userInterrupted = true;
    };
    process.on("SIGINT", onSigInt);

    // Set stdin to raw mode to forward all keystrokes transparently
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    const onStdinData = (data: Buffer) => {
      if (data.includes(3)) {
        // Ctrl+C in raw mode
        userInterrupted = true;
      }
      try {
        ptyProcess.write(data.toString());
      } catch {
        // Ignore write errors if process closed
      }
    };

    const onResize = () => {
      try {
        if (process.stdout.columns && process.stdout.rows) {
          ptyProcess.resize(process.stdout.columns, process.stdout.rows);
        }
      } catch {
        // Ignore resize errors
      }
    };

    process.stdin.on("data", onStdinData);
    process.stdout.on("resize", onResize);

    ptyProcess.onData((data: string) => {
      ringBuffer.write(data);
      process.stdout.write(data);
    });

    ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
      // Cleanup listeners and terminal state
      process.stdin.removeListener("data", onStdinData);
      process.stdout.removeListener("resize", onResize);
      process.removeListener("SIGINT", onSigInt);

      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(wasRaw || false);
        process.stdin.pause();
      }

      const durationMs = Date.now() - startTime;
      const isWindows = process.platform === "win32";
      const code = event.exitCode;
      const isInterrupt =
        userInterrupted ||
        event.signal === 2 ||
        event.signal === 15 ||
        code === 130 ||
        code === 143 ||
        (isWindows && (code === 3221225786 || code === -1073741510));

      resolve({
        exitCode: event.exitCode ?? (event.signal ? 128 + event.signal : 1),
        durationMs,
        outputTailRaw: ringBuffer.getRaw(),
        outputTailClean: ringBuffer.getClean(),
        userInterrupted: isInterrupt,
        signal: event.signal,
      });
    });
  });
}

function resolveBinary(command: string): { file: string; shell: boolean } {
  if (process.platform !== "win32") {
    return { file: command, shell: false };
  }
  const lower = command.toLowerCase();
  // .cmd and .bat files REQUIRE shell: true in Node 20+ (CVE-2024-27980)
  if (
    lower.endsWith(".cmd") ||
    lower.endsWith(".bat") ||
    ["npm", "npx", "pnpm", "yarn", "corepack"].includes(lower)
  ) {
    return { file: command, shell: true };
  }
  if (
    lower.endsWith(".exe") ||
    ["node", "git", "python", "cargo", "docker", "deno", "bun", "go", "rustc"].includes(lower)
  ) {
    return { file: command, shell: false };
  }
  return { file: command, shell: true };
}

/**
 * Fallback runner using Node child_process.spawn
 */
function runWithChildProcess(
  command: string,
  args: string[],
  ringBuffer: RingBuffer,
  cwd: string,
  env: NodeJS.ProcessEnv,
  startTime: number
): Promise<RunnerResult> {
  return new Promise((resolve) => {
    const { file, shell } = resolveBinary(command);

    let child: ChildProcess;
    try {
      child = childProcessSpawn(file, args, {
        cwd,
        env,
        shell,
        stdio: ["inherit", "pipe", "pipe"],
      });
    } catch (err: any) {
      const errorMsg = `\nFailed to start process "${command}": ${err.message}\n`;
      ringBuffer.write(errorMsg);
      process.stderr.write(errorMsg);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: 1,
        durationMs,
        outputTailRaw: ringBuffer.getRaw(),
        outputTailClean: ringBuffer.getClean(),
        userInterrupted: false,
      });
      return;
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        ringBuffer.write(chunk);
        process.stdout.write(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        ringBuffer.write(chunk);
        process.stderr.write(chunk);
      });
    }

    let userInterrupted = false;
    const onSigInt = () => {
      userInterrupted = true;
    };
    process.on("SIGINT", onSigInt);

    child.on("error", (err: Error) => {
      process.removeListener("SIGINT", onSigInt);
      const errorMsg = `\nFailed to start process "${command}": ${err.message}\n`;
      ringBuffer.write(errorMsg);
      process.stderr.write(errorMsg);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: 1,
        durationMs,
        outputTailRaw: ringBuffer.getRaw(),
        outputTailClean: ringBuffer.getClean(),
        userInterrupted: false,
      });
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      process.removeListener("SIGINT", onSigInt);
      const durationMs = Date.now() - startTime;
      const isWindows = process.platform === "win32";

      const isInterrupt =
        userInterrupted ||
        signal === "SIGINT" ||
        signal === "SIGTERM" ||
        code === 130 ||
        code === 143 ||
        (isWindows && (code === 3221225786 || code === -1073741510));

      const exitCode = code !== null ? code : (signal ? 128 : 1);
      resolve({
        exitCode,
        durationMs,
        outputTailRaw: ringBuffer.getRaw(),
        outputTailClean: ringBuffer.getClean(),
        userInterrupted: isInterrupt,
        signal,
      });
    });
  });
}
