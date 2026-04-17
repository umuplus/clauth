#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { platform } from "node:os";
import { createInterface } from "node:readline";
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
} from "./hive.js";

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
  .version("1.1.0");

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
      const reason =
        name.toLowerCase() === "hive"
          ? "It's reserved for the Hive Mind knowledge wiki."
          : "It's auto-created as a link to your existing Claude config.";
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
  .action(async (name: string, opts: { skipPermissions?: boolean; hiveMind?: boolean }) => {
    if (name.toLowerCase() === "hive") {
      console.log(chalk.red(`  "hive" is not a profile. It's the Hive Mind knowledge wiki.`));
      return;
    }

    if (!(await profileExists(name))) {
      console.log(chalk.red(`  Profile "${name}" does not exist.`));
      return;
    }

    const noFlags = opts.skipPermissions === undefined && opts.hiveMind === undefined;

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
      console.log();
      return;
    }

    if (opts.skipPermissions !== undefined) {
      await setConfig(name, { skipPermissions: opts.skipPermissions });
      const label = opts.skipPermissions ? chalk.green("on") : chalk.dim("off");
      console.log(`  ✓ skip-permissions ${label} for "${name}"`);
    }

    if (opts.hiveMind !== undefined) {
      await setConfig(name, { hiveMind: { enabled: opts.hiveMind } });
      const label = opts.hiveMind ? chalk.green("on") : chalk.dim("off");
      console.log(`  ✓ hive-mind ${label} for "${name}"`);
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
  .action(async (prompt: string | undefined, opts: {
    query?: boolean; lint?: boolean; file?: string;
    index?: boolean; log?: string | boolean; open?: boolean;
  }) => {
    try {
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

      // --- LLM-powered operations (need a profile for auth) ---
      const folder = await getFolderProfile();
      const profileName = folder ?? (await getLastUsed());
      if (!profileName) {
        console.log(chalk.dim("\n  No profile found. Run: clauth launch <name> first.\n"));
        process.exit(1);
      }

      const claudeDir = getClaudeConfigDir(profileName);

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
          console.log(chalk.dim("\n  hive: analyzing session..."));
          const result = await runHiveAnalysis(logPath, getProjectName(), claudeDir, name);
          if (result.summary) {
            console.log(chalk.dim(`  hive: ${result.summary}`));
          } else if (result.error) {
            console.log(chalk.red("  hive: analysis failed"));
            console.log(chalk.red(result.error));
          } else {
            console.log(chalk.dim("  hive: analysis complete (no summary returned)"));
          }
        }
      } catch (err) {
        console.log(chalk.red(`  hive: unexpected error — ${err}`));
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

if (argv.length <= 2) {
  // No subcommand → always show interactive selector
  (async () => {
    await ensureDefaultProfile();
    await ensureHiveDir();
    await interactiveSelect();
  })();
} else {
  ensureDefaultProfile()
    .then(() => ensureHiveDir())
    .then(() => program.parse(argv));
}
