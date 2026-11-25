import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { CrashContext } from "../core/collector.js";

export interface CrashBundle {
  id: string;
  savedAt: string;
  context: CrashContext;
  redactedOutput: string;
}

const MAX_SAVED_CRASHES = 20;

/**
 * Returns the default directory where crash snapshots are stored: ~/.wtf/crashes/
 * Supports override via WTF_STORAGE_DIR for testing and isolated environments.
 */
export function getCrashesDir(): string {
  if (process.env.WTF_STORAGE_DIR) {
    return process.env.WTF_STORAGE_DIR;
  }
  return path.join(os.homedir(), ".wtf", "crashes");
}

/**
 * Returns fallback directory if home directory is restricted or read-only.
 */
function getFallbackDir(): string {
  return path.join(process.cwd(), ".wtf", "crashes");
}

/**
 * Ensures the crashes storage directory exists.
 */
export async function ensureCrashesDir(): Promise<string> {
  const dir = getCrashesDir();
  try {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    return dir;
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      const fallback = getFallbackDir();
      if (!existsSync(fallback)) {
        await fs.mkdir(fallback, { recursive: true });
      }
      return fallback;
    }
    throw err;
  }
}

/**
 * Saves a crash bundle to ~/.wtf/crashes/ and automatically prunes older files to keep at most 20.
 */
export async function saveCrash(context: CrashContext, redactedOutput: string): Promise<string> {
  const dir = await ensureCrashesDir();
  const timestamp = Date.now();
  const id = `crash-${timestamp}`;
  const filePath = path.join(dir, `${id}.json`);

  const bundle: CrashBundle = {
    id,
    savedAt: new Date(timestamp).toISOString(),
    context,
    redactedOutput,
  };

  await fs.writeFile(filePath, JSON.stringify(bundle, null, 2), "utf8");

  // Prune older than MAX_SAVED_CRASHES
  await pruneCrashes(dir, MAX_SAVED_CRASHES);

  return filePath;
}

/**
 * Prunes the crashes directory keeping only the newest N files.
 */
async function pruneCrashes(dir: string, keepCount: number): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.startsWith("crash-") && f.endsWith(".json"));

    if (jsonFiles.length <= keepCount) {
      return;
    }

    // Get file stats to sort by mtime descending
    const filesWithStats = await Promise.all(
      jsonFiles.map(async (name) => {
        const fullPath = path.join(dir, name);
        const stat = await fs.stat(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs };
      })
    );

    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Delete files beyond keepCount
    const toDelete = filesWithStats.slice(keepCount);
    await Promise.allSettled(toDelete.map((item) => fs.unlink(item.fullPath)));
  } catch {
    // Non-fatal: Pruning errors should never crash the tool
  }
}

/**
 * Retrieves the directory containing crash snapshots.
 */
function resolveReadableCrashesDir(): string | null {
  const primary = getCrashesDir();
  if (existsSync(primary)) return primary;
  const fallback = getFallbackDir();
  if (existsSync(fallback)) return fallback;
  return null;
}

/**
 * Retrieves the most recent saved crash bundle, or null if none exist.
 */
export async function getLastCrash(): Promise<CrashBundle | null> {
  const dir = resolveReadableCrashesDir();
  if (!dir) return null;

  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.startsWith("crash-") && f.endsWith(".json"));

    if (jsonFiles.length === 0) return null;

    const filesWithStats = await Promise.all(
      jsonFiles.map(async (name) => {
        const fullPath = path.join(dir, name);
        const stat = await fs.stat(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs };
      })
    );

    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = filesWithStats[0];

    const content = await fs.readFile(latest.fullPath, "utf8");
    return JSON.parse(content) as CrashBundle;
  } catch {
    return null;
  }
}

/**
 * Lists all saved crash bundles (newest first).
 */
export async function listCrashes(limit = MAX_SAVED_CRASHES): Promise<CrashBundle[]> {
  const dir = resolveReadableCrashesDir();
  if (!dir) return [];

  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.startsWith("crash-") && f.endsWith(".json"));

    const filesWithStats = await Promise.all(
      jsonFiles.map(async (name) => {
        const fullPath = path.join(dir, name);
        const stat = await fs.stat(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs };
      })
    );

    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const loaded = await Promise.all(
      filesWithStats.slice(0, limit).map(async (item) => {
        try {
          const content = await fs.readFile(item.fullPath, "utf8");
          return JSON.parse(content) as CrashBundle;
        } catch {
          return null;
        }
      })
    );

    return loaded.filter((item): item is CrashBundle => item !== null);
  } catch {
    return [];
  }
}
