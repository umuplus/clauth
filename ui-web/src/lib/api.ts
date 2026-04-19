import type {
  Profile,
  WikiPage,
  WikiPageContent,
  LogEntry,
  HiveResult,
  HiveStreamEvent,
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

async function* parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trimStart();
      }
      yield { event, data };
    }
  }
}

async function streamHive(
  path: string,
  init: RequestInit,
  onProgress?: (ev: HiveStreamEvent) => void
): Promise<HiveResult> {
  const res = await fetch(path, init);
  if (!res.ok || !res.body) {
    const text = res.body ? await res.text() : "";
    throw new Error(`${res.status} ${text}`);
  }
  const reader = res.body.getReader();
  let result: HiveResult | null = null;
  for await (const evt of parseSSE(reader)) {
    if (evt.event === "progress" && onProgress) {
      try { onProgress(JSON.parse(evt.data) as HiveStreamEvent); } catch { /* ignore */ }
    } else if (evt.event === "done") {
      try { result = JSON.parse(evt.data) as HiveResult; } catch { /* ignore */ }
    } else if (evt.event === "error") {
      result = { summary: null, error: evt.data || "stream error" };
    }
  }
  return result ?? { summary: null, error: "stream ended without result" };
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

  // Hive operations (LLM, SSE-streamed)
  feedHive: (prompt: string, onProgress?: (ev: HiveStreamEvent) => void) =>
    streamHive(
      "/api/hive/feed",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
      onProgress
    ),
  queryHive: (prompt: string, onProgress?: (ev: HiveStreamEvent) => void) =>
    streamHive(
      "/api/hive/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
      onProgress
    ),
  lintHive: (onProgress?: (ev: HiveStreamEvent) => void) =>
    streamHive("/api/hive/lint", { method: "POST" }, onProgress),
  uploadFile: (
    file: File,
    focus?: string,
    onProgress?: (ev: HiveStreamEvent) => void
  ): Promise<HiveResult> => {
    const form = new FormData();
    form.append("file", file);
    if (focus) form.append("focus", focus);
    return streamHive("/api/hive/file", { method: "POST", body: form }, onProgress);
  },

  // Stats
  getStats: () =>
    request<{ profiles: { name: string; stats: StatsCache | null }[] }>("/api/stats"),
  getProfileStats: (name: string) =>
    request<{ name: string; stats: StatsCache | null }>(`/api/stats/${name}`),
};
