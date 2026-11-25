import os from "node:os";
import { exec } from "node:child_process";
import net from "node:net";
import { sanitizeEnvironment } from "../security/redactor.js";

export interface GitContext {
  branch?: string;
  commit?: string;
  isDirty?: boolean;
  statusSummary?: string;
}

export interface SystemContext {
  platform: string;
  osRelease: string;
  arch: string;
  nodeVersion: string;
  cwd: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpuCount: number;
}

export interface PortContext {
  port: number;
  inUse: boolean;
  details?: string;
}

export interface CrashContext {
  command: string;
  exitCode: number;
  durationMs: number;
  timestamp: string;
  system: SystemContext;
  git?: GitContext;
  activePorts: PortContext[];
  environment: Record<string, string>;
  rawOutputTail: string;
  cleanOutputTail: string;
}

/**
 * Wraps any promise with a strict millisecond timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms = 200, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);

    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

function execAsync(cmd: string, timeoutMs = 180): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Collect Git information within timeout.
 */
async function collectGit(): Promise<GitContext | undefined> {
  try {
    const [branchResult, commitResult, statusResult] = await Promise.allSettled([
      execAsync("git rev-parse --abbrev-ref HEAD"),
      execAsync("git log -1 --oneline"),
      execAsync("git status --porcelain"),
    ]);

    const branch = branchResult.status === "fulfilled" ? branchResult.value : undefined;
    const commit = commitResult.status === "fulfilled" ? commitResult.value : undefined;
    const status = statusResult.status === "fulfilled" ? statusResult.value : "";

    if (!branch && !commit) {
      return undefined;
    }

    return {
      branch,
      commit,
      isDirty: status.length > 0,
      statusSummary: status ? `${status.split("\n").length} modified files` : "clean",
    };
  } catch {
    return undefined;
  }
}

/**
 * Checks if a specific port is in use by attempting a quick connection.
 */
function checkPortInUse(port: number, timeoutMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isConnected = false;

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      isConnected = true;
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Inspect active ports, especially scanning ports mentioned in terminal output or standard dev ports.
 */
async function collectPorts(cleanOutput: string): Promise<PortContext[]> {
  const candidatePorts = new Set<number>([3000, 3001, 5173, 8080, 8000, 5000, 5432, 27017, 3306]);

  // Extract ports mentioned in error logs (e.g. "port 3000", "EADDRINUSE :::3000", "localhost:3000")
  const portRegex = /(?:port\s*[:=]?\s*|EADDRINUSE.*?|127\.0\.0\.1:|localhost:)(\d{2,5})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = portRegex.exec(cleanOutput)) !== null) {
    const p = parseInt(match[1], 10);
    if (p > 0 && p <= 65535) {
      candidatePorts.add(p);
    }
  }

  const results: PortContext[] = [];
  const checks = Array.from(candidatePorts).map(async (port) => {
    try {
      const inUse = await checkPortInUse(port, 150);
      if (inUse) {
        results.push({ port, inUse: true, details: `Port ${port} is currently bound/listening` });
      }
    } catch {
      // Ignore individual port check failures
    }
  });

  await Promise.allSettled(checks);
  return results.sort((a, b) => a.port - b.port);
}

/**
 * Filter relevant environment variables for debugging while excluding huge/noisy or sensitive ones.
 */
function collectRelevantEnv(): Record<string, string> {
  const allowList = [
    "NODE_ENV",
    "CI",
    "DEBUG",
    "SHELL",
    "TERM",
    "TERM_PROGRAM",
    "PATH",
    "LANG",
    "LC_ALL",
    "PORT",
    "HOST",
    "PWD",
    "NVM_BIN",
  ];

  const filtered: Record<string, string | undefined> = {};
  for (const key of allowList) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key];
    }
  }

  // Also include any user-defined app variables starting with VITE_, NEXT_PUBLIC_, REACT_APP_, etc.
  for (const [key, val] of Object.entries(process.env)) {
    if (/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|APP_)/i.test(key)) {
      filtered[key] = val;
    }
  }

  return sanitizeEnvironment(filtered);
}

export interface CollectOptions {
  command: string;
  exitCode: number;
  durationMs: number;
  cleanOutputTail: string;
  rawOutputTail: string;
}

/**
 * Parallel context collector running all checks concurrently with a strict 200ms timeout per check.
 */
export async function collectCrashContext(options: CollectOptions): Promise<CrashContext> {
  const timestamp = new Date().toISOString();

  const system: SystemContext = {
    platform: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    cwd: process.cwd(),
    totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
    freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
    cpuCount: os.cpus().length,
  };

  const [gitResult, portsResult, envResult] = await Promise.allSettled([
    withTimeout(collectGit(), 200, undefined),
    withTimeout(collectPorts(options.cleanOutputTail), 200, []),
    withTimeout(Promise.resolve(collectRelevantEnv()), 200, {}),
  ]);

  const git = gitResult.status === "fulfilled" ? gitResult.value : undefined;
  const activePorts = portsResult.status === "fulfilled" ? portsResult.value : [];
  const environment = envResult.status === "fulfilled" ? envResult.value : {};

  return {
    command: options.command,
    exitCode: options.exitCode,
    durationMs: options.durationMs,
    timestamp,
    system,
    git,
    activePorts,
    environment,
    rawOutputTail: options.rawOutputTail,
    cleanOutputTail: options.cleanOutputTail,
  };
}
