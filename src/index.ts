#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { platform, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
import {
  ensureClauthDir,
  ensureDefaultProfile,
  getProfilesWithStatus,
  profileExists,
  createProfile,
  removeProfile,
  getProfileDir,
  getClaudeConfigDir,
  getConfig,
  setConfig,
  getLastUsed,
  setLastUsed,
  getFolderProfile,
  setFolderProfile,
  isValidName,
  isReservedName,
} from "./profiles.js";
import { selectProfile } from "./selector.js";
import { printLaunchBanner } from "./ui.js";
import { showAllStats, showProfileStats } from "./stats.js";
import { runSetup } from "./setup.js";
import {
  enqueue,
  readQueue,
  acquireLock,
  releaseLock,
  peek,
  markDone,
  markFailed,
  markSkipped,
  statusOf,
  retryFailed,
  clearFailed,
  MAX_ATTEMPTS,
} from "./hive-queue.js";
import {
  ensureHiveDir,
  snapshotSessionFiles,
  detectNewSessionLog,
  runHiveAnalysis,
  runHiveManual,
  runHiveQuery,
  runHiveLint,
  runHiveFileIngest,
  getProjectName,
  getHiveDir,
  buildProjectContext,
  listHiveProjects,
  listHivePages,
  resetHiveProject,
  resetHivePage,
  resetHiveAll,
  runHiveBackfillSummaries,
  computeHiveUsage,
  listRecentSessions,
  FLAT_CATEGORIES,
  type HiveCategory,
  type SchemaUpgrade,
} from "./hive.js";

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow(prompt), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow(prompt), (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Enter means yes — the session just ended and the user wants to move on.
 *
 * Resolves to the default if stdin closes without an answer (EOF, disconnected
 * terminal). Leaving the promise unsettled would drop the session silently,
 * which is the exact failure the queue exists to prevent.
 */
function confirmDefaultYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };

    rl.question(chalk.yellow(prompt), (answer) => finish(!answer.trim().toLowerCase().startsWith("n")));
    // Deferred: when input arrives and stdin closes in the same tick, `close`
    // can fire before the answer callback. Yielding lets a real answer win.
    rl.on("close", () => setImmediate(() => finish(true)));
  });
}

/** Parse "1,3-5" into indices. Invalid pieces are ignored rather than aborting the pick. */
function parseSelection(input: string, max: number): number[] {
  const picked = new Set<number>();
  for (const part of input.split(",")) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [from, to] = [parseInt(range[1], 10), parseInt(range[2], 10)].sort((a, b) => a - b);
      for (let i = from; i <= to; i++) if (i >= 1 && i <= max) picked.add(i);
      continue;
    }
    const single = parseInt(part.trim(), 10);
    if (single >= 1 && single <= max) picked.add(single);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * Start the queue worker as a detached child so the terminal returns immediately.
 * If it dies (sleep, closed terminal, crash) the item simply stays queued and is
 * picked up by the next worker — the queue, not the process, is the source of truth.
 */
function spawnQueueWorker(): void {
  const child = spawn(process.execPath, [process.argv[1], "hive", "--catchup", "--quiet"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Process queued sessions one at a time. Returns how many succeeded. */
async function processQueue(quiet: boolean): Promise<number> {
  if (!(await acquireLock())) {
    if (!quiet) console.log(chalk.dim("  hive: another analysis is already running."));
    return 0;
  }

  let done = 0;
  try {
    for (let item = await peek(); item; item = await peek()) {
      if (!quiet) console.log(chalk.dim(`  hive: analyzing ${item.project}...`));
      try {
        const result = await runHiveAnalysis(
          item.logPath,
          item.project,
          getClaudeConfigDir(item.profile),
          item.profile,
          quiet
            ? undefined
            : (ev) => {
                if (ev.kind === "tool") {
                  console.log(chalk.dim(ev.detail ? `  hive · ${ev.name} ${ev.detail}` : `  hive · ${ev.name}`));
                }
              }
        );

        if (result.error) {
          await markFailed(item.logPath, result.error);
          if (!quiet) console.log(chalk.red(`  hive: failed — ${result.error}`));
        } else {
          await markDone(item.logPath, result.summary, item.project);
          done++;
          if (!quiet) console.log(chalk.dim(`  hive: ${result.summary ?? "done"}`));
        }
      } catch (err) {
        await markFailed(item.logPath, String(err));
        if (!quiet) console.log(chalk.red(`  hive: failed — ${err}`));
      }
    }
  } finally {
    await releaseLock();
  }
  return done;
}

function getObsidianConfigPath(): string | null {
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  if (p === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "obsidian", "obsidian.json");
  }
  if (p === "linux") {
    const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    return join(configHome, "obsidian", "obsidian.json");
  }
  return null;
}

// Extract passthrough args (everything after --) before Commander parses
const dashIdx = process.argv.indexOf("--");
const passthroughArgs =
  dashIdx !== -1 ? process.argv.slice(dashIdx + 1) : [];
const argv =
  dashIdx !== -1 ? process.argv.slice(0, dashIdx) : process.argv;

const program = new Command();

program
  .name("clauth")
  .description("Manage multiple Claude CLI account profiles")
  .version(pkg.version);

// --- add ---
program
  .command("add <name>")
  .description("Create a new profile")
  .action(async (name: string) => {
    if (!isValidName(name)) {
      console.log(
        chalk.red(
          `  Invalid profile name "${name}". Use letters, numbers, hyphens, underscores.`
        )
      );
      process.exit(1);
    }

    if (isReservedName(name)) {
      const reasons: Record<string, string> = {
        hive: "It's reserved for the Hive Mind knowledge wiki.",
        "hive-backups": "It's where clauth keeps wiki backups.",
        default: "It's auto-created as a link to your existing Claude config.",
      };
      const reason = reasons[name.toLowerCase()] ?? "It's reserved by clauth.";
      console.log(chalk.red(`  "${name}" is a reserved profile name. ${reason}`));
      process.exit(1);
    }

    if (await profileExists(name)) {
      console.log(chalk.yellow(`  Profile "${name}" already exists. Remove it first with: clauth remove ${name}`));
      return;
    }

    await createProfile(name);
    console.log(chalk.green(`  ✓ Created profile "${name}"`));
    console.log(chalk.dim(`    ${getProfileDir(name)}\n`));
    console.log(`  Launch with ${chalk.cyan(`clauth launch ${name}`)} — Claude will prompt to log in on first run.`);
  });

// --- remove ---
program
  .command("remove <name>")
  .description("Delete a profile and its config dir")
  .action(async (name: string) => {
    if (name.toLowerCase() === "hive") {
      console.log(chalk.red(`  "hive" is not a profile. It's the Hive Mind knowledge wiki.`));
      return;
    }

    if (!(await profileExists(name))) {
      console.log(chalk.red(`  Profile "${name}" does not exist.`));
      return;
    }

    const isDefault = name === "default";
    const prompt = isDefault
      ? `Remove "default" profile? (Your ~/.claude config will not be deleted) [y/N] `
      : `Delete profile "${name}" and all its data? [y/N] `;

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow(`  ${prompt}`), async (answer) => {
      rl.close();
      if (answer.toLowerCase() === "y") {
        await removeProfile(name);
        console.log(chalk.green(`  ✓ Removed profile "${name}"`));
      } else {
        console.log(chalk.dim("  Cancelled."));
      }
    });
  });

// --- config ---
program
  .command("config <name>")
  .description("Configure a profile")
  .option("--skip-permissions", "Always launch with --dangerously-skip-permissions")
  .option("--no-skip-permissions", "Require --dangerously-skip-permissions via --")
  .option("--hive-mind", "Enable hive mind for this profile")
  .option("--no-hive-mind", "Disable hive mind for this profile")
  .option("--analyze <mode>", "What to do with a finished session: ask | always | never")
  .action(async (name: string, opts: { skipPermissions?: boolean; hiveMind?: boolean; analyze?: string }) => {
    if (name.toLowerCase() === "hive") {
      console.log(chalk.red(`  "hive" is not a profile. It's the Hive Mind knowledge wiki.`));
      return;
    }

    if (!(await profileExists(name))) {
      console.log(chalk.red(`  Profile "${name}" does not exist.`));
      return;
    }

    const ANALYZE_MODES = ["ask", "always", "never"] as const;
    if (opts.analyze !== undefined && !ANALYZE_MODES.includes(opts.analyze as (typeof ANALYZE_MODES)[number])) {
      console.log(chalk.red(`  Invalid --analyze "${opts.analyze}". Use: ${ANALYZE_MODES.join(", ")}`));
      process.exit(1);
    }

    const noFlags =
      opts.skipPermissions === undefined && opts.hiveMind === undefined && opts.analyze === undefined;

    if (noFlags) {
      // No flags provided — show current config
      const config = await getConfig(name);
      console.log(chalk.bold(`\n  Config for "${name}"\n`));
      console.log(
        `  skip-permissions  ${
          config.skipPermissions
            ? chalk.green("on")
            : chalk.dim("off")
        }`
      );
      console.log(
        `  hive-mind         ${
          config.hiveMind?.enabled
            ? chalk.green("on")
            : chalk.dim("off")
        }`
      );
      if (config.hiveMind?.enabled) {
        const mode = config.hiveMind.analyze ?? "ask";
        const hint =
          mode === "ask" ? "prompt after each session"
          : mode === "always" ? "queue every session"
          : "never queue";
        console.log(`  analyze           ${chalk.cyan(mode)} ${chalk.dim(`— ${hint}`)}`);
      }
      console.log();
      return;
    }

    if (opts.skipPermissions !== undefined) {
      await setConfig(name, { skipPermissions: opts.skipPermissions });
      const label = opts.skipPermissions ? chalk.green("on") : chalk.dim("off");
      console.log(`  ✓ skip-permissions ${label} for "${name}"`);
    }

    // setConfig merges shallowly, so hiveMind must be rebuilt from the existing
    // object — otherwise toggling one field silently drops the other.
    if (opts.hiveMind !== undefined || opts.analyze !== undefined) {
      const current = (await getConfig(name)).hiveMind;
      const hiveMind = {
        enabled: opts.hiveMind ?? current?.enabled ?? false,
        ...(current?.analyze ? { analyze: current.analyze } : {}),
        ...(opts.analyze ? { analyze: opts.analyze as "ask" | "always" | "never" } : {}),
      };
      await setConfig(name, { hiveMind });

      if (opts.hiveMind !== undefined) {
        console.log(`  ✓ hive-mind ${opts.hiveMind ? chalk.green("on") : chalk.dim("off")} for "${name}"`);
      }
      if (opts.analyze !== undefined) {
        console.log(`  ✓ analyze ${chalk.cyan(opts.analyze)} for "${name}"`);
      }
    }
  });

// --- stats ---
program
  .command("stats [name]")
  .description("Show usage statistics")
  .action(async (name?: string) => {
    if (name) {
      await showProfileStats(name);
    } else {
      await showAllStats();
    }
  });

// --- setup ---
program
  .command("setup")
  .description("Guided profile setup wizard")
  .action(async () => {
    await runSetup();
  });

// --- hive ---
program
  .command("hive [prompt]")
  .description("Feed knowledge, query, or lint the hive mind wiki")
  .option("--query", "Query the wiki (read-only, no modifications)")
  .option("--lint", "Health-check the wiki for issues")
  .option("--file <path>", "Ingest a file into the wiki")
  .option("--index", "Print the wiki index")
  .option("--log [n]", "Print the last n log entries (default: 10)")
  .option("--open", "Open the wiki directory in the system file manager")
  .option("--obsidian", "Open the wiki in Obsidian (requires Obsidian 1.0+)")
  .option("--reset [target]", "Delete a project, a <category>/<page>, or the entire wiki if no target is given")
  .option("--backfill-summaries", "Fill in the summary frontmatter field across every wiki page")
  .option("--usage", "Show whether sessions actually open the wiki pages they are pointed at")
  .option("--queue", "Show sessions waiting to be analysed")
  .option("--catchup", "Analyse queued sessions now")
  .option("--sessions [n]", "List recent sessions and pick ones to analyse (default 20)")
  .option("--retry-failed", "Requeue sessions that gave up (use with --queue)")
  .option("--clear-failed", "Drop sessions that gave up (use with --queue)")
  .option("--quiet", "Suppress output (used by the background worker)")
  .option("-y, --yes", "Skip the confirmation prompt (use with --reset)")
  .action(async (prompt: string | undefined, opts: {
    query?: boolean; lint?: boolean; file?: string;
    index?: boolean; log?: string | boolean; open?: boolean; obsidian?: boolean;
    reset?: string | boolean; yes?: boolean; backfillSummaries?: boolean; usage?: boolean;
    queue?: boolean; catchup?: boolean; sessions?: string | boolean; retryFailed?: boolean; clearFailed?: boolean; quiet?: boolean;
  }) => {
    try {
      if (opts.reset !== undefined) {
        const raw = typeof opts.reset === "string" ? opts.reset.replace(/\/+$/, "") : null;
        const today = new Date().toISOString().slice(0, 10);

        // Bare name = project (back-compat); "<category>/<name>" = a single page.
        const slash = raw?.indexOf("/") ?? -1;
        const category = raw && slash > 0 ? raw.slice(0, slash) : null;
        const pageName = raw && slash > 0 ? raw.slice(slash + 1).replace(/\.md$/, "") : null;

        let describe: string;
        let doReset: () => Promise<void>;
        let doneMsg: string;

        if (!raw) {
          describe = "the ENTIRE hive wiki (all projects, concepts, clients, company, personal, people)";
          doReset = resetHiveAll;
          doneMsg = "Reset the entire hive wiki";
        } else if (category && category !== "projects") {
          if (!FLAT_CATEGORIES.includes(category as (typeof FLAT_CATEGORIES)[number])) {
            console.log(chalk.red(`  Unknown category "${category}".`));
            console.log(chalk.dim(`  Valid categories: ${FLAT_CATEGORIES.join(", ")}`));
            process.exit(1);
          }
          const cat = category as HiveCategory;
          const pages = await listHivePages(cat);
          if (!pages.includes(pageName!)) {
            console.log(chalk.red(`  No page "${pageName}" in ${category}.`));
            if (pages.length > 0) console.log(chalk.dim(`  Known: ${pages.join(", ")}`));
            process.exit(1);
          }
          describe = `the page ${category}/${pageName}.md`;
          doReset = () => resetHivePage(cat, pageName!, today);
          doneMsg = `Reset ${category}/${pageName}`;
        } else {
          const project = category === "projects" ? pageName! : raw;
          const projects = await listHiveProjects();
          if (!projects.includes(project)) {
            console.log(chalk.red(`  No hive knowledge for project "${project}".`));
            if (projects.length > 0) {
              console.log(chalk.dim(`  Known projects: ${projects.join(", ")}`));
            }
            process.exit(1);
          }
          describe = `all hive knowledge for "${project}"`;
          doReset = () => resetHiveProject(project, today);
          doneMsg = `Reset hive knowledge for "${project}"`;
        }

        console.log(chalk.yellow(`  This will permanently delete ${describe}.`));
        if (!raw) {
          console.log(chalk.dim(`  ${getHiveDir()} will be wiped and rescaffolded empty.`));
        }

        if (!opts.yes) {
          const confirmed = await confirm(`  Continue? (y/N) `);
          if (!confirmed) {
            console.log(chalk.dim("  Cancelled."));
            return;
          }
        }

        await doReset();
        console.log(chalk.green(`  ✓ ${doneMsg}`));
        return;
      }

      // --- Phase 10: local browse commands (no LLM needed) ---
      if (opts.index) {
        try {
          const content = await readFile(join(getHiveDir(), "index.md"), "utf8");
          console.log(content);
        } catch {
          console.log(chalk.dim("  No index.md found. Run a session with hive mind enabled first."));
        }
        return;
      }

      if (opts.log !== undefined) {
        const n = typeof opts.log === "string" ? (parseInt(opts.log, 10) || 10) : 10;
        try {
          const content = await readFile(join(getHiveDir(), "log.md"), "utf8");
          const entries = content.split("\n").filter((l) => l.startsWith("## ["));
          if (entries.length === 0) {
            console.log(chalk.dim("  No log entries yet."));
          } else {
            entries.slice(-n).forEach((e) => console.log(e));
          }
        } catch {
          console.log(chalk.dim("  No log.md found. Run a session with hive mind enabled first."));
        }
        return;
      }

      if (opts.open) {
        const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "explorer" : "xdg-open";
        spawn(cmd, [getHiveDir()], { detached: true, stdio: "ignore" }).unref();
        console.log(chalk.dim(`  Opened ${getHiveDir()}`));
        return;
      }

      if (opts.obsidian) {
        const hiveDir = getHiveDir();
        const configPath = getObsidianConfigPath();
        if (!configPath) {
          console.log(chalk.red("  Unsupported platform for --obsidian"));
          return;
        }

        // Obsidian only treats a folder as a vault if it contains a .obsidian/ dir.
        // Without it, it falls back to the vault-picker screen even when open: true is set.
        await mkdir(join(hiveDir, ".obsidian"), { recursive: true });

        let config: { vaults?: Record<string, { path: string; ts?: number; open?: boolean }> } = {};
        try {
          config = JSON.parse(await readFile(configPath, "utf8"));
        } catch {
          await mkdir(dirname(configPath), { recursive: true });
        }
        if (!config.vaults) config.vaults = {};

        let vaultId = Object.keys(config.vaults).find((id) => config.vaults![id].path === hiveDir);
        if (!vaultId) {
          vaultId = randomBytes(8).toString("hex");
          config.vaults[vaultId] = { path: hiveDir, ts: Date.now() };
        }
        config.vaults[vaultId].open = true;

        await writeFile(configPath, JSON.stringify(config, null, 2));

        if (platform() === "darwin") {
          spawn("open", ["-a", "Obsidian"], { detached: true, stdio: "ignore" }).unref();
        } else {
          spawn("obsidian", [], { detached: true, stdio: "ignore" }).unref();
        }
        console.log(chalk.dim(`  Registered ${hiveDir} as an Obsidian vault and launched Obsidian`));
        console.log(chalk.dim("  (If Obsidian was already running, quit it and rerun this command)"));
        return;
      }

      if (opts.sessions !== undefined) {
        const limit = typeof opts.sessions === "string" ? (parseInt(opts.sessions, 10) || 20) : 20;

        const withHive: { name: string; configDir: string }[] = [];
        for (const p of await getProfilesWithStatus()) {
          const cfg = await getConfig(p.name);
          if (cfg.hiveMind?.enabled) withHive.push({ name: p.name, configDir: getClaudeConfigDir(p.name) });
        }
        if (withHive.length === 0) {
          console.log(chalk.dim("  No profile has hive mind enabled."));
          return;
        }

        const sessions = await listRecentSessions(withHive, limit);
        if (sessions.length === 0) {
          console.log(chalk.dim("  No sessions found."));
          return;
        }

        const state = await readQueue();
        // Pad the plain text before colouring — ANSI codes break padEnd's width maths.
        const pad = (s: string) => s.padEnd(9);
        const marks: Record<string, string> = {
          done: chalk.green(pad("✓ added")),
          skipped: chalk.dim(pad("· skipped")),
          pending: chalk.yellow(pad("… queued")),
          failed: chalk.red(pad("✗ failed")),
          new: chalk.dim(pad("–")),
        };

        console.log(chalk.bold(`\n  Last ${sessions.length} sessions\n`));
        const statuses: string[] = [];
        for (const [i, s] of sessions.entries()) {
          const status = await statusOf(state, s.logPath);
          statuses.push(status);
          const when = s.modifiedAt.toISOString().replace("T", " ").slice(5, 16);
          const label = s.firstPrompt ?? s.slug ?? chalk.dim("(no prompt found)");
          console.log(
            `  ${String(i + 1).padStart(2)}. ${marks[status]}  ${chalk.dim(when)}  ` +
            `${chalk.cyan(s.project.padEnd(14))} ${label}`
          );
        }

        const addable = sessions.filter((_, i) => statuses[i] !== "pending");
        if (addable.length === 0) {
          console.log(chalk.dim("\n  Everything here is already queued.\n"));
          return;
        }

        console.log(chalk.dim("\n  Pick sessions to add (e.g. 1,3-5) — blank to cancel."));
        const answer = await ask("  > ");
        const picked = parseSelection(answer, sessions.length);
        if (picked.length === 0) {
          console.log(chalk.dim("  Cancelled.\n"));
          return;
        }

        let added = 0;
        for (const n of picked) {
          const s = sessions[n - 1];
          if (statuses[n - 1] === "pending") continue;
          await enqueue({ logPath: s.logPath, project: s.project, profile: s.profile });
          added++;
        }

        console.log(chalk.green(`\n  ✓ Queued ${added} session(s)`));
        if (added > 0) {
          spawnQueueWorker();
          console.log(chalk.dim("  Analysing in the background — check: clauth hive --queue\n"));
        }
        return;
      }

      if (opts.catchup) {
        const n = await processQueue(!!opts.quiet);
        if (!opts.quiet && n === 0) {
          const { pending } = await readQueue();
          if (pending.length === 0) console.log(chalk.dim("  hive: nothing queued."));
        }
        return;
      }

      if (opts.queue) {
        const state = await readQueue();

        if (opts.retryFailed) {
          const n = await retryFailed();
          console.log(chalk.green(`  ✓ Requeued ${n} failed session(s)`));
          return;
        }
        if (opts.clearFailed) {
          const n = await clearFailed();
          console.log(chalk.green(`  ✓ Dropped ${n} failed session(s)`));
          return;
        }

        console.log(chalk.bold("\n  Hive queue\n"));

        if (state.lastProcessed) {
          const when = state.lastProcessed.at.replace("T", " ").slice(0, 16);
          console.log(chalk.dim(`  Last analysed: ${state.lastProcessed.project} at ${when}`));
          if (state.lastProcessed.summary) {
            console.log(chalk.dim(`  ${state.lastProcessed.summary}`));
          }
          console.log();
        }

        if (state.pending.length === 0 && state.failed.length === 0) {
          console.log(chalk.green("  Up to date — nothing waiting.\n"));
          return;
        }

        if (state.pending.length > 0) {
          console.log(`  Pending (${state.pending.length})`);
          state.pending.forEach((p) =>
            console.log(
              chalk.dim(`    ${p.project.padEnd(18)} queued ${p.enqueuedAt.replace("T", " ").slice(0, 16)}` +
                (p.attempts > 0 ? `  (${p.attempts} failed attempt${p.attempts > 1 ? "s" : ""})` : ""))
            )
          );
          console.log(chalk.dim("\n  Run: clauth hive --catchup\n"));
        }

        if (state.failed.length > 0) {
          console.log(chalk.yellow(`  Failed (${state.failed.length}) — gave up after ${MAX_ATTEMPTS} attempts`));
          state.failed.forEach((p) => {
            console.log(chalk.dim(`    ${p.project}`));
            if (p.lastError) console.log(chalk.dim(`      ${p.lastError.split("\n")[0].slice(0, 100)}`));
          });
          console.log(chalk.dim("\n  Retry: clauth hive --queue --retry-failed"));
          console.log(chalk.dim("  Drop:  clauth hive --queue --clear-failed\n"));
        }
        return;
      }

      if (opts.usage) {
        // Only profiles with hive mind on ever get a map injected.
        const profiles = await getProfilesWithStatus();
        const enabled: string[] = [];
        for (const p of profiles) {
          const cfg = await getConfig(p.name);
          if (cfg.hiveMind?.enabled) enabled.push(p.name);
        }

        if (enabled.length === 0) {
          console.log(chalk.dim("  No profile has hive mind enabled — nothing to measure."));
          console.log(chalk.dim("  Enable it with: clauth config <name> --hive-mind"));
          return;
        }

        const usage = await computeHiveUsage(enabled.map((n) => getClaudeConfigDir(n)));

        console.log(chalk.bold("\n  Hive usage\n"));
        console.log(chalk.dim(`  Profiles: ${enabled.join(", ")}`));
        console.log(chalk.dim(`  Sessions scanned: ${usage.scannedSessions}${usage.since ? ` (since ${usage.since.slice(0, 10)})` : ""}`));

        if (usage.sessionsWithMap === 0) {
          console.log(chalk.dim("\n  No sessions yet in a project that has wiki pages."));
          console.log(chalk.dim("  Run a few sessions with hive mind on, then check again.\n"));
          return;
        }

        const pct = Math.round((usage.sessionsThatRead / usage.sessionsWithMap) * 100);
        const colour = pct === 0 ? chalk.red : pct < 30 ? chalk.yellow : chalk.green;
        console.log(
          `\n  Sessions given a map:  ${usage.sessionsWithMap}` +
          `\n  ...that opened a page: ${colour(`${usage.sessionsThatRead} (${pct}%)`)}\n`
        );

        const ranked = Object.entries(usage.pageHits).sort(([, a], [, b]) => b - a);
        if (ranked.length > 0) {
          console.log(chalk.bold("  Most-opened pages"));
          ranked.slice(0, 10).forEach(([p, n]) => console.log(`    ${String(n).padStart(3)}  ${p}`));
          console.log();
        }

        if (usage.neverRead.length > 0) {
          console.log(chalk.bold(`  Never opened (${usage.neverRead.length})`));
          usage.neverRead.slice(0, 10).forEach((p) => console.log(chalk.dim(`         ${p}`)));
          if (usage.neverRead.length > 10) {
            console.log(chalk.dim(`         … and ${usage.neverRead.length - 10} more`));
          }
          console.log();
        }

        console.log(chalk.dim("  Note: a session counts as \"given a map\" if its project has wiki"));
        console.log(chalk.dim("  pages now, so sessions from before those pages existed inflate the"));
        console.log(chalk.dim("  denominator. Treat low percentages as a signal, not a measurement.\n"));
        return;
      }

      // --- LLM-powered operations (need a profile for auth) ---
      const folder = await getFolderProfile();
      const profileName = folder ?? (await getLastUsed());
      if (!profileName) {
        console.log(chalk.dim("\n  No profile found. Run: clauth launch <name> first.\n"));
        process.exit(1);
      }

      const claudeDir = getClaudeConfigDir(profileName);

      if (opts.backfillSummaries) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        console.log(chalk.dim("  hive: backing up wiki and backfilling summaries..."));
        const res = await runHiveBackfillSummaries(claudeDir, profileName, stamp, (ev) => {
          if (ev.kind === "tool") {
            console.log(chalk.dim(ev.detail ? `  hive · ${ev.name} ${ev.detail}` : `  hive · ${ev.name}`));
          }
        });

        if (res.error) {
          console.log(chalk.red("  hive: backfill failed"));
          console.log(chalk.red(res.error));
        } else {
          console.log(chalk.dim(`  hive: ${res.summary ?? "done"}`));
        }

        if (res.bodiesChanged.length > 0) {
          console.log(chalk.yellow(`\n  ⚠ ${res.bodiesChanged.length} page(s) had prose modified, not just frontmatter:`));
          res.bodiesChanged.forEach((p) => console.log(chalk.yellow(`    ${p}`)));
          console.log(chalk.dim(`  Restore from: ${res.backupDir}`));
        } else {
          console.log(chalk.dim("  Verified: only frontmatter changed."));
          console.log(chalk.dim(`  Backup: ${res.backupDir}`));
        }
        return;
      }

      let result;
      if (opts.lint) {
        console.log(chalk.dim("  hive: running lint..."));
        result = await runHiveLint(claudeDir, profileName);
      } else if (opts.file) {
        const filePath = resolve(opts.file);
        try {
          await access(filePath);
        } catch {
          console.log(chalk.red(`  File not found: ${filePath}`));
          process.exit(1);
        }
        console.log(chalk.dim(`  hive: ingesting ${opts.file}...`));
        result = await runHiveFileIngest(filePath, prompt, claudeDir, profileName);
      } else if (!prompt) {
        console.log(chalk.red("  A prompt is required. Usage: clauth hive \"<prompt>\", clauth hive --lint, or clauth hive --file <path>"));
        process.exit(1);
      } else if (opts.query) {
        console.log(chalk.dim("  hive: querying..."));
        result = await runHiveQuery(prompt, claudeDir, profileName);
      } else {
        console.log(chalk.dim("  hive: processing..."));
        result = await runHiveManual(prompt, claudeDir, profileName);
      }

      if (result.summary) {
        console.log(chalk.dim(`  hive: ${result.summary}`));
      } else if (result.error) {
        console.log(chalk.red("  hive: failed"));
        console.log(chalk.red(result.error));
      } else {
        console.log(chalk.dim("  hive: done (no summary returned)"));
      }
    } catch (err) {
      console.log(chalk.red(`  hive: unexpected error — ${err}`));
      process.exit(1);
    }
  });

// --- ui ---
program
  .command("ui")
  .description("Launch the clauth web UI in your browser")
  .option("-p, --port <port>", "Specific port (default: random free port)")
  .option("--no-open", "Don't auto-open browser")
  .action(async (opts: { port?: string; open?: boolean }) => {
    try {
      const { startUiServer } = await import("./ui-server/server.js");
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const { url } = await startUiServer({ port, openBrowser: opts.open !== false });
      console.log(chalk.green(`\n  ✓ clauth UI running at ${chalk.cyan(url)}`));
      console.log(chalk.dim("  Press Ctrl+C to stop.\n"));
    } catch (err) {
      console.log(chalk.red(`  Failed to start UI: ${err}`));
      process.exit(1);
    }
  });

// --- launch ---
program
  .command("launch [name]")
  .description("Launch claude with a profile (defaults to folder/last used)")
  .action(async (name?: string) => {
    if (!name) {
      const folder = await getFolderProfile();
      const last = folder ?? (await getLastUsed());
      if (!last) {
        console.log(chalk.dim("\n  No last used profile. Run: clauth switch\n"));
        process.exit(1);
      }
      name = last;
    }
    launchClaude(name, passthroughArgs);
  });

// --- helpers ---

async function launchClaude(name: string, args: string[]): Promise<void> {
  if (name.toLowerCase() === "hive") {
    console.log(chalk.red(`  "hive" is not a profile. It's the Hive Mind knowledge wiki.`));
    process.exit(1);
  }

  if (!(await profileExists(name))) {
    console.log(chalk.red(`\n  Profile "${name}" does not exist.`));
    console.log(
      chalk.dim('  Run "clauth" to see available profiles.\n')
    );
    process.exit(1);
  }

  const config = await getConfig(name);
  const configArgs: string[] = [];
  const flags: string[] = [];
  if (config.skipPermissions) {
    configArgs.push("--dangerously-skip-permissions");
    flags.push("skip-permissions");
  }
  if (config.hiveMind?.enabled) {
    flags.push("hive-mind");

    // Surface a backlog where the user is already looking. Silent when there is
    // nothing waiting — a status line that always shows becomes invisible.
    const { pending, failed } = await readQueue();
    if (pending.length > 0) flags.push(`${pending.length} queued`);
    if (failed.length > 0) flags.push(`${failed.length} failed`);
  }

  await setLastUsed(name);
  await setFolderProfile(name);
  printLaunchBanner(name, flags);

  const claudeDir = getClaudeConfigDir(name);
  const env = { ...process.env };
  // Only set CLAUDE_CONFIG_DIR for non-default profiles
  if (name !== "default") {
    env.CLAUDE_CONFIG_DIR = claudeDir;
  }

  // Snapshot session files before launch (for hive mind detection)
  const hiveEnabled = config.hiveMind?.enabled ?? false;
  const sessionSnapshot = hiveEnabled
    ? await snapshotSessionFiles(claudeDir)
    : null;

  // Inject prior project knowledge from hive wiki
  if (hiveEnabled) {
    const context = await buildProjectContext(getProjectName());
    if (context) {
      configArgs.push("--append-system-prompt", context);
    }
  }

  const child = spawn("claude", [...configArgs, ...args], {
    env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(chalk.red("  Error: claude CLI not found."));
    } else {
      console.log(chalk.red(`  Error: ${err.message}`));
    }
    process.exit(1);
  });

  child.on("close", async (code) => {
    if (sessionSnapshot) {
      try {
        const logPath = await detectNewSessionLog(claudeDir, sessionSnapshot);
        if (logPath) {
          // Queue, don't analyse. Running it here blocked the terminal for
          // minutes after every session, so it got interrupted — and an
          // interrupted analysis lost that session's knowledge for good.
          // detectNewSessionLog only returns logs from this cwd's own folder, so
          // the launch directory already names the project — no need to reopen the log.
          const project = getProjectName();
          const mode = config.hiveMind?.analyze ?? "ask";

          // Only ask when there is someone to answer; piped or scripted runs
          // would otherwise hang forever on a prompt nobody sees.
          const canAsk = mode === "ask" && process.stdin.isTTY && process.stdout.isTTY;
          const wanted = mode === "always" || (canAsk ? await confirmDefaultYes("\n  Add this session to hive? [Y/n] ") : mode !== "never");

          if (wanted) {
            await enqueue({ logPath, project, profile: name });
            spawnQueueWorker();
            console.log(chalk.dim("  hive: queued — analysing in the background"));
          } else {
            await markSkipped(logPath, project);
            console.log(chalk.dim("  hive: skipped (recover later with: clauth hive --sessions)"));
          }
        }
      } catch (err) {
        console.log(chalk.red(`  hive: could not queue session — ${err}`));
      }
    }
    process.exit(code ?? 0);
  });
}

// --- helpers ---

async function interactiveSelect(): Promise<void> {
  const profiles = await getProfilesWithStatus();

  if (profiles.length === 0) {
    console.log(
      chalk.dim("\n  No profiles yet. Create one with: clauth add <name>\n")
    );
    process.exit(0);
  }

  const preselect = await getFolderProfile();
  const selected = await selectProfile(profiles, preselect ?? undefined);
  if (selected) {
    await launchClaude(selected, passthroughArgs);
  }
}

// --- entry point ---

function reportSchemaUpgrade(upgrade: SchemaUpgrade | null): void {
  if (!upgrade) return;
  console.log(
    chalk.dim(`  hive: schema upgraded v${upgrade.from} → v${upgrade.to} (previous kept at ${upgrade.backupPath})`)
  );
}

if (argv.length <= 2) {
  // No subcommand → always show interactive selector
  (async () => {
    await ensureDefaultProfile();
    reportSchemaUpgrade(await ensureHiveDir());
    await interactiveSelect();
  })();
} else {
  ensureDefaultProfile()
    .then(() => ensureHiveDir())
    .then((upgrade) => {
      reportSchemaUpgrade(upgrade);
      program.parse(argv);
    });
}
