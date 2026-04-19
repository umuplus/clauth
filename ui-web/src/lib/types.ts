export type Category = "projects" | "concepts" | "clients" | "company" | "personal" | "people";

export interface Profile {
  name: string;
  authenticated: boolean;
  config: {
    skipPermissions?: boolean;
    hiveMind?: { enabled: boolean };
  };
}

export interface WikiPage {
  category: Category;
  path: string;
  name: string;
}

export interface WikiPageContent {
  path: string;
  content: string;
  size: number;
  updated: string;
}

export interface LogEntry {
  date: string;
  type: string;
  details: string;
  body: string[];
}

export interface HiveResult {
  summary: string | null;
  error: string | null;
}

export type HiveStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "system"; message: string };

export interface StatsCache {
  totalSessions: number;
  totalMessages: number;
  firstSessionDate?: string;
  dailyActivity: {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }[];
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }
  >;
}
