import type {
  Profile,
  WikiPage,
  WikiPageContent,
  LogEntry,
  HiveResult,
  StatsCache,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Profiles
  listProfiles: () => request<{ profiles: Profile[] }>("/api/profiles"),
  getProfile: (name: string) =>
    request<{ name: string; config: Profile["config"] }>(`/api/profiles/${name}`),
  updateProfileConfig: (name: string, updates: Partial<Profile["config"]>) =>
    request<{ name: string; config: Profile["config"] }>(
      `/api/profiles/${name}/config`,
      { method: "PATCH", body: JSON.stringify(updates) }
    ),

  // Hive content
  getHiveIndex: () => request<{ content: string | null }>("/api/hive/index"),
  getHiveLog: (limit = 50) =>
    request<{ entries: LogEntry[] }>(`/api/hive/log?limit=${limit}`),
  listWikiPages: () => request<{ pages: WikiPage[] }>("/api/hive/pages"),
  getWikiPage: (path: string) =>
    request<WikiPageContent>(`/api/hive/page/${path}`),

  // Hive operations (LLM)
  feedHive: (prompt: string) =>
    request<HiveResult>("/api/hive/feed", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  queryHive: (prompt: string) =>
    request<HiveResult>("/api/hive/query", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  lintHive: () =>
    request<HiveResult>("/api/hive/lint", { method: "POST" }),
  uploadFile: async (file: File, focus?: string): Promise<HiveResult> => {
    const form = new FormData();
    form.append("file", file);
    if (focus) form.append("focus", focus);
    const res = await fetch("/api/hive/file", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<HiveResult>;
  },

  // Stats
  getStats: () =>
    request<{ profiles: { name: string; stats: StatsCache | null }[] }>("/api/stats"),
  getProfileStats: (name: string) =>
    request<{ name: string; stats: StatsCache | null }>(`/api/stats/${name}`),
};
