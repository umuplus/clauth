import chalk from "chalk";
import Table from "cli-table3";
// @ts-ignore — asciichart has no type declarations
import asciichart from "asciichart";
import {
  getProfileNames,
  getStats,
  profileExists,
  type StatsCache,
} from "./profiles.js";
import { printHeader } from "./ui.js";

function formatNum(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function totalOutputTokens(stats: StatsCache): number {
  return Object.values(stats.modelUsage).reduce(
    (sum, m) => sum + m.outputTokens,
    0
  );
}

export async function showAllStats(): Promise<void> {
  const names = await getProfileNames();

  if (names.length === 0) {
    console.log(chalk.dim("\n  No profiles yet.\n"));
    return;
  }

  printHeader();

  const table = new Table({
    chars: {
      top: "─", "top-mid": "┬", "top-left": "╭", "top-right": "╮",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "╰", "bottom-right": "╯",
      left: "│", "left-mid": "├", mid: "─", "mid-mid": "┼",
      right: "│", "right-mid": "┤", middle: "│",
    },
    style: {
      head: ["cyan"],
      border: ["dim"],
      compact: false,
    },
    head: ["Profile", "Sessions", "Messages", "Tokens (out)", "First Used", "Last Active"],
  });

  for (const name of names) {
    const stats = await getStats(name);
    if (!stats) {
      table.push([name, chalk.dim("—"), chalk.dim("—"), chalk.dim("—"), chalk.dim("—"), chalk.dim("—")]);
      continue;
    }
    const lastActive = stats.dailyActivity.length > 0
      ? stats.dailyActivity[stats.dailyActivity.length - 1].date
      : undefined;
    table.push([
      chalk.bold(name),
      formatNum(stats.totalSessions),
      formatNum(stats.totalMessages),
      formatTokens(totalOutputTokens(stats)),
      stats.firstSessionDate ? formatDate(stats.firstSessionDate) : chalk.dim("—"),
      lastActive ? formatDate(lastActive) : chalk.dim("—"),
    ]);
  }

  console.log(table.toString());
  console.log();
}

export async function showProfileStats(name: string): Promise<void> {
  if (!(await profileExists(name))) {
    console.log(chalk.red(`\n  Profile "${name}" does not exist.\n`));
    return;
  }

  const stats = await getStats(name);
  if (!stats) {
    console.log(chalk.dim(`\n  No usage data yet for "${name}". Launch it first with: clauth launch ${name}\n`));
    return;
  }

  // --- Header ---
  console.log(chalk.bold.cyan(`\n  ▶ ${name}\n`));

  // --- Summary ---
  const summaryTable = new Table({
    chars: {
      top: "", "top-mid": "", "top-left": "", "top-right": "",
      bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
      left: "  ", "left-mid": "", mid: "", "mid-mid": "",
      right: "", "right-mid": "", middle: "  ",
    },
    style: { "padding-left": 0, "padding-right": 1 },
  });

  summaryTable.push(
    [chalk.dim("Sessions"), chalk.white(formatNum(stats.totalSessions)),
     chalk.dim("First used"), stats.firstSessionDate ? chalk.white(formatDate(stats.firstSessionDate)) : chalk.dim("—")],
    [chalk.dim("Messages"), chalk.white(formatNum(stats.totalMessages)),
     chalk.dim("Last active"), stats.dailyActivity.length > 0 ? chalk.white(stats.dailyActivity[stats.dailyActivity.length - 1].date) : chalk.dim("—")],
  );

  console.log(summaryTable.toString());

  // --- Model usage ---
  const models = Object.entries(stats.modelUsage);
  if (models.length > 0) {
    console.log(chalk.bold("\n  Tokens\n"));

    const modelTable = new Table({
      chars: {
        top: "", "top-mid": "", "top-left": "", "top-right": "",
        bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
        left: "  ", "left-mid": "", mid: "", "mid-mid": "",
        right: "", "right-mid": "", middle: "  ",
      },
      style: { "padding-left": 0, "padding-right": 1 },
      head: [chalk.dim("Model"), chalk.dim("Input"), chalk.dim("Output"), chalk.dim("Cache Read")],
    });

    for (const [model, usage] of models) {
      const shortName = model
        .replace("claude-", "")
        .replace(/-\d{8}$/, "");
      modelTable.push([
        chalk.white(shortName),
        formatTokens(usage.inputTokens),
        chalk.green(formatTokens(usage.outputTokens)),
        chalk.dim(formatTokens(usage.cacheReadInputTokens)),
      ]);
    }

    console.log(modelTable.toString());
  }

  // --- Daily activity chart (last 14 days) ---
  const recent = stats.dailyActivity.slice(-14);
  if (recent.length >= 2) {
    console.log(chalk.bold("\n  Messages (last 14 days)\n"));

    const values = recent.map((d) => d.messageCount);
    const chart = asciichart.plot(values, {
      height: 8,
      padding: "    ",
      format: (x: number) => String(Math.round(x)).padStart(6),
      colors: [asciichart.green],
    });
    console.log(chart);

    // Date labels
    const first = recent[0].date.slice(5);
    const last = recent[recent.length - 1].date.slice(5);
    const labelLine = `    ${first}${" ".repeat(Math.max(0, recent.length * 2 - first.length - last.length))}${last}`;
    console.log(chalk.dim(labelLine));
  }

  // --- Daily bar chart (last 7 days) ---
  const last7 = stats.dailyActivity.slice(-7);
  if (last7.length > 0) {
    console.log(chalk.bold("\n  Recent activity\n"));

    const maxMsgs = Math.max(...last7.map((d) => d.messageCount));
    const barWidth = 30;

    for (const day of last7) {
      const date = day.date.slice(5);
      const filled = maxMsgs > 0 ? Math.round((day.messageCount / maxMsgs) * barWidth) : 0;
      const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(barWidth - filled));
      console.log(`  ${chalk.dim(date)}  ${bar}  ${chalk.white(formatNum(day.messageCount))}`);
    }
  }

  console.log();
}
