import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rm, access } from "node:fs/promises";

const CLAUTH_DIR = join(homedir(), ".clauth");

export function getClauthDir(): string {
  return CLAUTH_DIR;
}

export function getProfileDir(name: string): string {
  return join(CLAUTH_DIR, name);
}

export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name);
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

export async function hasAuth(name: string): Promise<boolean> {
  const dir = getProfileDir(name);
  try {
    const entries = await readdir(dir);
    return entries.some((e) => e.includes("credentials"));
  } catch {
    return false;
  }
}

export interface ProfileInfo {
  name: string;
  authenticated: boolean;
}

export async function getProfilesWithStatus(): Promise<ProfileInfo[]> {
  const names = await getProfileNames();
  return Promise.all(
    names.map(async (name) => ({
      name,
      authenticated: await hasAuth(name),
    }))
  );
}
