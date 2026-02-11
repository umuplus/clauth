#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
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
  isValidName,
  isReservedName,
} from "./profiles.js";
import { selectProfile } from "./selector.js";
import { printHeader, formatProfileLine, printLaunchBanner } from "./ui.js";
import { showAllStats, showProfileStats } from "./stats.js";

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
  .version("1.0.0");

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
      console.log(
        chalk.red(
          `  "${name}" is a reserved profile name. It's auto-created as a link to your existing Claude config.`
        )
      );
      process.exit(1);
    }

    if (await profileExists(name)) {
      console.log(chalk.yellow(`  Profile "${name}" already exists. Remove it first with: clauth remove ${name}`));
      return;
    }

    await createProfile(name);
    console.log(chalk.green(`  ✓ Created profile "${name}"`));
    console.log(chalk.dim(`    ${getProfileDir(name)}\n`));
    console.log(`  Launch with ${chalk.cyan(`clauth use ${name}`)} — Claude will prompt to log in on first run.`);
  });

// --- remove ---
program
  .command("remove <name>")
  .description("Delete a profile and its config dir")
  .action(async (name: string) => {
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

// --- list ---
program
  .command("list")
  .description("Show all profiles")
  .action(async () => {
    const profiles = await getProfilesWithStatus();

    if (profiles.length === 0) {
      console.log(
        chalk.dim("\n  No profiles yet. Create one with: clauth add <name>\n")
      );
      return;
    }

    printHeader();

    const maxNameLen = Math.max(...profiles.map((p) => p.name.length));
    for (const p of profiles) {
      console.log(formatProfileLine(p, { maxNameLen }));
    }
    console.log();
  });

// --- config ---
program
  .command("config <name>")
  .description("Configure a profile")
  .option("--skip-permissions", "Always launch with --dangerously-skip-permissions")
  .option("--no-skip-permissions", "Require --dangerously-skip-permissions via --")
  .action(async (name: string, opts: { skipPermissions?: boolean }) => {
    if (!(await profileExists(name))) {
      console.log(chalk.red(`  Profile "${name}" does not exist.`));
      return;
    }

    if (opts.skipPermissions === undefined) {
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
      console.log();
      return;
    }

    await setConfig(name, { skipPermissions: opts.skipPermissions });
    const label = opts.skipPermissions ? chalk.green("on") : chalk.dim("off");
    console.log(`  ✓ skip-permissions ${label} for "${name}"`);
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

// --- use ---
program
  .command("use <name>")
  .description("Launch claude with the selected profile")
  .action((name: string) => {
    launchClaude(name, passthroughArgs);
  });

// --- helpers ---

async function launchClaude(name: string, args: string[]): Promise<void> {
  if (!(await profileExists(name))) {
    console.log(chalk.red(`\n  Profile "${name}" does not exist.`));
    console.log(
      chalk.dim('  Run "clauth list" to see available profiles.\n')
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

  await setLastUsed(name);
  printLaunchBanner(name, flags);

  const claudeDir = getClaudeConfigDir(name);
  const env = { ...process.env };
  // Only set CLAUDE_CONFIG_DIR for non-default profiles
  if (name !== "default") {
    env.CLAUDE_CONFIG_DIR = claudeDir;
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

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

// --- entry point ---

if (argv.length <= 2) {
  // No subcommand → last used profile, or interactive selector
  (async () => {
    await ensureDefaultProfile();

    const last = await getLastUsed();
    if (last) {
      await launchClaude(last, []);
      return;
    }

    const profiles = await getProfilesWithStatus();

    if (profiles.length === 0) {
      console.log(
        chalk.dim("\n  No profiles yet. Create one with: clauth add <name>\n")
      );
      process.exit(0);
    }

    const selected = await selectProfile(profiles);
    if (selected) {
      await launchClaude(selected, []);
    }
  })();
} else {
  ensureDefaultProfile().then(() => program.parse(argv));
}
