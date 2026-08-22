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

export interface QueueItem {
  logPath: string;
  project: string;
  profile: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface QueueState {
  pending: QueueItem[];
  failed: QueueItem[];
  lastProcessed: { project: string; at: string; summary: string | null } | null;
  /** Set while an analyzer holds the lock — pending[0] is the one being worked on. */
  running: { pid: number; startedAt: string } | null;
}

export type QuestionStatus = "open" | "answered" | "applied" | "dismissed";

export interface Question {
  id: string;
  question: string;
  /** Wiki-relative page carrying the gap this question would close. */
  page: string | null;
  /** What the analyzer would write differently once it knows. */
  why: string | null;
  source: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
  appliedAt?: string;
  status: QuestionStatus;
}

export interface QuestionState {
  open: Question[];
  /** Answered but not yet written into the wiki. */
  answered: Question[];
  running: { pid: number; startedAt: string } | null;
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
