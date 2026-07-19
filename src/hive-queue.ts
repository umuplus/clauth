import { join } from "node:path";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { open } from "node:fs/promises";
import { getClauthDir } from "./profiles.js";

const QUEUE_PATH = join(getClauthDir(), "hive-queue.json");
const LOCK_PATH = join(getClauthDir(), "hive-queue.lock");

/** After this many failures an item stops being retried and is surfaced instead. */
export const MAX_ATTEMPTS = 3;

/** A lock older than this is assumed to belong to a process that died mid-run. */
const LOCK_STALE_MS = 30 * 60 * 1000;

export interface QueueItem {
  logPath: string;
  project: string;
  profile: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface ProcessedItem {
  project: string;
  at: string;
  summary: string | null;
}

/** What already happened to a session, so the picker can avoid re-offering it. */
export interface HistoryEntry {
  logPath: string;
  project: string;
  at: string;
  status: "done" | "skipped";
}

/** History is only used to annotate the picker, so an old tail is not worth keeping. */
const HISTORY_LIMIT = 500;

export interface QueueState {
  pending: QueueItem[];
  failed: QueueItem[];
  lastProcessed: ProcessedItem | null;
  history: HistoryEntry[];
}

const EMPTY: QueueState = { pending: [], failed: [], lastProcessed: null, history: [] };

export async function readQueue(): Promise<QueueState> {
  try {
    const parsed = JSON.parse(await readFile(QUEUE_PATH, "utf8")) as Partial<QueueState>;
    return {
      pending: parsed.pending ?? [],
      failed: parsed.failed ?? [],
      lastProcessed: parsed.lastProcessed ?? null,
      history: parsed.history ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Write via temp + rename so a crash mid-write cannot truncate the queue. */
async function writeQueue(state: QueueState): Promise<void> {
  await mkdir(getClauthDir(), { recursive: true });
  const tmp = `${QUEUE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, QUEUE_PATH);
}

/**
 * Record a session as needing analysis. Idempotent on logPath — re-enqueueing a
 * session already waiting is a no-op rather than a duplicate run.
 */
export async function enqueue(item: Omit<QueueItem, "enqueuedAt" | "attempts">): Promise<void> {
  const state = await readQueue();
  if (state.pending.some((p) => p.logPath === item.logPath)) return;
  state.pending.push({ ...item, enqueuedAt: new Date().toISOString(), attempts: 0 });
  await writeQueue(state);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Single-flight guard. Two sessions ending at once would otherwise run two
 * analyzers against the same wiki and overwrite each other's edits.
 *
 * A lock whose owner is gone (or that is simply old) is taken over — otherwise a
 * process killed mid-analysis would block the queue permanently.
 */
export async function acquireLock(): Promise<boolean> {
  try {
    const handle = await open(LOCK_PATH, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.close();
    return true;
  } catch {
    // Lock exists — decide whether it is still live.
  }

  try {
    const raw = JSON.parse(await readFile(LOCK_PATH, "utf8")) as { pid?: number; at?: string };
    const age = raw.at ? Date.now() - new Date(raw.at).getTime() : Infinity;
    const live = typeof raw.pid === "number" && processAlive(raw.pid) && age < LOCK_STALE_MS;
    if (live) return false;
  } catch {
    // Unreadable lock file — treat as stale.
  }

  await releaseLock();
  try {
    const handle = await open(LOCK_PATH, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

export async function releaseLock(): Promise<void> {
  try {
    await unlink(LOCK_PATH);
  } catch {
    // Already gone.
  }
}

/** Take the next pending item without removing it — it stays until it succeeds or exhausts retries. */
export async function peek(): Promise<QueueItem | null> {
  const state = await readQueue();
  return state.pending[0] ?? null;
}

function remember(state: QueueState, entry: HistoryEntry): void {
  state.history = state.history.filter((h) => h.logPath !== entry.logPath);
  state.history.push(entry);
  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(-HISTORY_LIMIT);
  }
}

export async function markDone(logPath: string, summary: string | null, project: string): Promise<void> {
  const state = await readQueue();
  state.pending = state.pending.filter((p) => p.logPath !== logPath);
  state.lastProcessed = { project, at: new Date().toISOString(), summary };
  remember(state, { logPath, project, at: new Date().toISOString(), status: "done" });
  await writeQueue(state);
}

/** Record a declined session so it can be told apart from one never offered. */
export async function markSkipped(logPath: string, project: string): Promise<void> {
  const state = await readQueue();
  remember(state, { logPath, project, at: new Date().toISOString(), status: "skipped" });
  await writeQueue(state);
}

export type SessionStatus = "done" | "skipped" | "pending" | "failed" | "new";

export async function statusOf(state: QueueState, logPath: string): Promise<SessionStatus> {
  if (state.pending.some((p) => p.logPath === logPath)) return "pending";
  if (state.failed.some((p) => p.logPath === logPath)) return "failed";
  return state.history.find((h) => h.logPath === logPath)?.status ?? "new";
}

/**
 * Record a failed attempt. Past MAX_ATTEMPTS the item moves to `failed`, so a
 * permanently broken session (corrupt log, exhausted quota) cannot wedge the
 * queue by being retried on every launch forever.
 */
export async function markFailed(logPath: string, error: string): Promise<void> {
  const state = await readQueue();
  const item = state.pending.find((p) => p.logPath === logPath);
  if (!item) return;

  item.attempts += 1;
  item.lastError = error;
  if (item.attempts >= MAX_ATTEMPTS) {
    state.pending = state.pending.filter((p) => p.logPath !== logPath);
    state.failed.push(item);
  }
  await writeQueue(state);
}

/** Move failed items back to pending — for when the cause was transient (quota, network). */
export async function retryFailed(): Promise<number> {
  const state = await readQueue();
  const count = state.failed.length;
  for (const item of state.failed) {
    item.attempts = 0;
    delete item.lastError;
    state.pending.push(item);
  }
  state.failed = [];
  await writeQueue(state);
  return count;
}

export async function clearFailed(): Promise<number> {
  const state = await readQueue();
  const count = state.failed.length;
  state.failed = [];
  await writeQueue(state);
  return count;
}
