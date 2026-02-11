import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rm, access, readFile, writeFile } from "node:fs/promises";

const CLAUTH_DIR = join(homedir(), ".clauth");
const DEFAULT_CLAUDE_DIR = join(homedir(), ".claude");

export function getClauthDir(): string {
  return CLAUTH_DIR;
}

// Where clauth stores its own config (clauth.json) — always under ~/.clauth/<name>
export function getProfileDir(name: string): string {
  return join(CLAUTH_DIR, name);
}

// Where Claude reads its config — ~/.claude for default, ~/.clauth/<name> for others
export function getClaudeConfigDir(name: string): string {
  if (name === "default") return DEFAULT_CLAUDE_DIR;
  return join(CLAUTH_DIR, name);
}

export const RESERVED_NAMES = ["default"];

export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name);
}

export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.includes(name.toLowerCase());
}

export async function ensureClauthDir(): Promise<void> {
  await mkdir(CLAUTH_DIR, { recursive: true });
}

export async function getProfileNames(): Promise<string[]> {
  await ensureClauthDir();
  const entries = await readdir(CLAUTH_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function profileExists(name: string): Promise<boolean> {
  try {
    await access(getProfileDir(name));
    return true;
  } catch {
    return false;
  }
}

export async function createProfile(name: string): Promise<void> {
  await mkdir(getProfileDir(name), { recursive: true });
}

export async function removeProfile(name: string): Promise<void> {
  await rm(getProfileDir(name), { recursive: true, force: true });
}

export async function ensureDefaultProfile(): Promise<void> {
  await ensureClauthDir();
  const defaultDir = getProfileDir("default");

  // Check if default profile dir already exists
  try {
    await access(defaultDir);
    return;
  } catch {
    // doesn't exist yet
  }

  // Check if ~/.claude exists before creating the default profile
  try {
    await access(DEFAULT_CLAUDE_DIR);
  } catch {
    return; // no existing claude config
  }

  // Create the default profile dir (just for storing clauth.json)
  await mkdir(defaultDir, { recursive: true });
}

export async function hasAuth(name: string): Promise<boolean> {
  const dir = getClaudeConfigDir(name);
  try {
    const entries = await readdir(dir);
    return entries.some((e) => e.includes("credentials"));
  } catch {
    return false;
  }
}

// --- config ---

export interface ProfileConfig {
  skipPermissions?: boolean;
}

function configPath(name: string): string {
  return join(getProfileDir(name), "clauth.json");
}

export async function getConfig(name: string): Promise<ProfileConfig> {
  try {
    const data = await readFile(configPath(name), "utf8");
    return JSON.parse(data) as ProfileConfig;
  } catch {
    return {};
  }
}

export async function setConfig(
  name: string,
  updates: Partial<ProfileConfig>
): Promise<ProfileConfig> {
  const config = { ...(await getConfig(name)), ...updates };
  await writeFile(configPath(name), JSON.stringify(config, null, 2) + "\n");
  return config;
}

// --- folder mapping ---

const FOLDERS_FILE = join(CLAUTH_DIR, "folders.json");

async function readFolders(): Promise<Record<string, string>> {
  try {
    const data = await readFile(FOLDERS_FILE, "utf8");
    return JSON.parse(data) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function getFolderProfile(): Promise<string | null> {
  const cwd = process.cwd();
  const folders = await readFolders();
  const name = folders[cwd];
  if (name && (await profileExists(name))) return name;
  return null;
}

export async function setFolderProfile(name: string): Promise<void> {
  await ensureClauthDir();
  const folders = await readFolders();
  folders[process.cwd()] = name;
  await writeFile(FOLDERS_FILE, JSON.stringify(folders, null, 2) + "\n");
}

// --- last used ---

const LAST_FILE = join(CLAUTH_DIR, ".last");

export async function getLastUsed(): Promise<string | null> {
  try {
    const name = (await readFile(LAST_FILE, "utf8")).trim();
    if (name && (await profileExists(name))) return name;
    return null;
  } catch {
    return null;
  }
}

export async function setLastUsed(name: string): Promise<void> {
  await ensureClauthDir();
  await writeFile(LAST_FILE, name + "\n");
}

// --- stats ---

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface StatsCache {
  totalSessions: number;
  totalMessages: number;
  firstSessionDate?: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
}

export async function getStats(name: string): Promise<StatsCache | null> {
  const file = join(getClaudeConfigDir(name), "stats-cache.json");
  try {
    const data = await readFile(file, "utf8");
    return JSON.parse(data) as StatsCache;
  } catch {
    return null;
  }
}

export interface ProfileInfo {
  name: string;
  authenticated: boolean;
  config: ProfileConfig;
}

export async function getProfilesWithStatus(): Promise<ProfileInfo[]> {
  const names = await getProfileNames();
  return Promise.all(
    names.map(async (name) => ({
      name,
      authenticated: await hasAuth(name),
      config: await getConfig(name),
    }))
  );
}
