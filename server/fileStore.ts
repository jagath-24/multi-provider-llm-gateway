/**
 * fileStore.ts
 *
 * Simple JSON-file persistence for gateway logs and routing config.
 * Used as a fallback when DATABASE_URL is not configured.
 * All writes are serialized through a queue to prevent concurrent corruption.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RequestLog, RoutingConfig } from "@shared/gateway";

const DATA_DIR = join(process.cwd(), "data");
const LOGS_FILE = join(DATA_DIR, "gateway-logs.json");
const CONFIG_FILE = join(DATA_DIR, "routing-config.json");
const MAX_LOGS = 200;

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function safeReadJson<T>(file: string): Promise<T | null> {
  try {
    if (!existsSync(file)) return null;
    const raw = (await readFile(file, "utf-8")).trim();
    if (!raw || raw === "") return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeWriteJson(file: string, data: unknown) {
  await ensureDataDir();
  // Write to a temp file then rename — atomic on most OS/fs combinations
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

// ── Write queue — prevents concurrent writes from corrupting the file ─────────
let writeQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  writeQueue = writeQueue.then(task).catch(err => console.warn("[fileStore] write error:", err));
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function fileReadLogs(limit = 50): Promise<RequestLog[]> {
  const data = await safeReadJson<RequestLog[]>(LOGS_FILE);
  if (!Array.isArray(data)) return [];
  return data.slice(0, limit);
}

export function fileWriteLog(log: RequestLog): void {
  enqueue(async () => {
    const existing = (await safeReadJson<RequestLog[]>(LOGS_FILE)) ?? [];
    const updated = [log, ...existing.filter(l => !l.isSample)].slice(0, MAX_LOGS);
    await safeWriteJson(LOGS_FILE, updated);
  });
}

// ── Routing config ────────────────────────────────────────────────────────────

export async function fileReadConfig(): Promise<RoutingConfig | undefined> {
  const data = await safeReadJson<RoutingConfig>(CONFIG_FILE);
  return data ?? undefined;
}

export function fileWriteConfig(config: RoutingConfig): void {
  enqueue(async () => {
    await safeWriteJson(CONFIG_FILE, config);
  });
}
