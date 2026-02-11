import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { StatsCache, DailyActivity, ModelUsage } from "./profiles.js";

interface AssistantMessage {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  toolCalls: number;
}

export async function computeStatsFromSessions(
  configDir: string
): Promise<StatsCache | null> {
  const projectsDir = join(configDir, "projects");

  let projectDirs: string[];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(projectsDir, e.name));
  } catch {
    return null;
  }

  if (projectDirs.length === 0) return null;

  const sessionIds = new Set<string>();
  const assistantMessages: AssistantMessage[] = [];
  let totalUserMessages = 0;

  for (const projectDir of projectDirs) {
    let files: string[];
    try {
      files = (await readdir(projectDir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = file.replace(".jsonl", "");
      const filePath = join(projectDir, file);

      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        continue;
      }

      let hasMessages = false;
      // Deduplicate assistant messages by message.id — keep last entry
      const assistantByMsgId = new Map<string, AssistantMessage & { toolCallTypes: number }>();

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        const type = entry.type as string;
        const timestamp = entry.timestamp as string | undefined;

        if (type === "user") {
          totalUserMessages++;
          hasMessages = true;
          continue;
        }

        if (type === "assistant" && timestamp) {
          const msg = entry.message as Record<string, unknown> | undefined;
          if (!msg) continue;

          const msgId = msg.id as string;
          const model = (msg.model as string) || "unknown";
          const usage = (msg.usage as Record<string, number>) || {};
          const content = (msg.content as Array<Record<string, unknown>>) || [];

          const toolCalls = content.filter((c) => c.type === "tool_use").length;
          const date = new Date(timestamp).toISOString().slice(0, 10);

          assistantByMsgId.set(msgId, {
            date,
            model,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cacheReadInputTokens: usage.cache_read_input_tokens || 0,
            cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
            toolCalls,
            toolCallTypes: toolCalls,
          });
        }
      }

      if (hasMessages) {
        sessionIds.add(sessionId);
      }

      for (const am of assistantByMsgId.values()) {
        assistantMessages.push(am);
      }
    }
  }

  if (totalUserMessages === 0 && assistantMessages.length === 0) return null;

  // Aggregate daily activity
  const dailyMap = new Map<
    string,
    { messageCount: number; sessionCount: number; toolCallCount: number }
  >();
  const modelUsage: Record<string, ModelUsage> = {};

  // Count user messages per date from assistant timestamps (approximate)
  // We use assistant message dates as proxy for daily activity
  const dateSessions = new Map<string, Set<string>>();

  for (const am of assistantMessages) {
    const day = dailyMap.get(am.date) || {
      messageCount: 0,
      sessionCount: 0,
      toolCallCount: 0,
    };
    day.messageCount++;
    day.toolCallCount += am.toolCalls;
    dailyMap.set(am.date, day);

    // Model usage
    if (!modelUsage[am.model]) {
      modelUsage[am.model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
    }
    const mu = modelUsage[am.model];
    mu.inputTokens += am.inputTokens;
    mu.outputTokens += am.outputTokens;
    mu.cacheReadInputTokens += am.cacheReadInputTokens;
    mu.cacheCreationInputTokens += am.cacheCreationInputTokens;
  }

  // Add user messages to daily counts (distribute proportionally or just add total)
  // Since we don't have per-date user message counts, add them to assistant message counts
  // The total messages = user + assistant
  for (const day of dailyMap.values()) {
    // Each assistant message roughly corresponds to a user message
    day.messageCount *= 2; // approximate: user + assistant pairs
  }

  const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      messageCount: d.messageCount,
      sessionCount: d.sessionCount,
      toolCallCount: d.toolCallCount,
    }));

  const allDates = dailyActivity.map((d) => d.date);
  const firstSessionDate = allDates.length > 0 ? allDates[0] : undefined;

  return {
    totalSessions: sessionIds.size,
    totalMessages: totalUserMessages + assistantMessages.length,
    firstSessionDate,
    dailyActivity,
    dailyModelTokens: [],
    modelUsage,
  };
}
