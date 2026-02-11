#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  ensureClauthDir,
  getProfilesWithStatus,
  profileExists,
  createProfile,
  removeProfile,
  getProfileDir,
  getConfig,
  setConfig,
  isValidName,
} from "./profiles.js";
import { selectProfile } from "./selector.js";

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
  .description("Create a new profile and launch claude login")
  .action(async (name: string) => {
    if (!isValidName(name)) {
      console.log(
        chalk.red(
          `  Invalid profile name "${name}". Use letters, numbers, hyphens, underscores.`
        )
      );
      process.exit(1);
    }

    if (await profileExists(name)) {
      console.log(chalk.yellow(`  Profile "${name}" already exists.`));
      return;
    }

    await createProfile(name);
    console.log(chalk.green(`  ✓ Created profile "${name}"`));
    console.log(chalk.dim(`    ${getProfileDir(name)}`));
    console.log();
    console.log(chalk.blue("  Launching claude login...\n"));

    const child = spawn("claude", ["/login"], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: getProfileDir(name) },
      stdio: "inherit",
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(
          chalk.red(
            "  Error: claude CLI not found. Make sure it's installed and in your PATH."
          )
        );
      } else {
        console.log(chalk.red(`  Error: ${err.message}`));
      }
      process.exit(1);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green(`\n  ✓ Profile "${name}" is ready!`));
      }
      process.exit(code ?? 0);
    });
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

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      chalk.yellow(`  Delete profile "${name}" and all its data? [y/N] `),
      async (answer) => {
        rl.close();
        if (answer.toLowerCase() === "y") {
          await removeProfile(name);
          console.log(chalk.green(`  ✓ Removed profile "${name}"`));
        } else {
          console.log(chalk.dim("  Cancelled."));
        }
      }
    );
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

    console.log(chalk.bold("\n  Profiles\n"));

    for (const p of profiles) {
      const dot = p.authenticated ? chalk.green("●") : chalk.dim("○");
      const status = p.authenticated
        ? chalk.green("authenticated")
        : chalk.dim("no auth");
      console.log(`  ${dot} ${chalk.bold(p.name)}  ${status}`);
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

// --- use ---
program
  .command("use <name>")
  .description("Launch claude with the selected profile")
  .action((name: string) => {
    launchClaude(name, passthroughArgs);
  });

// --- helpers ---

function printBanner(name: string): void {
  const label = `Profile: ${name}`;
  const pad = 2;
  const inner = label.length + pad * 2;
  console.log(chalk.cyan(`\n  ╭${"─".repeat(inner)}╮`));
  console.log(
    chalk.cyan(
      `  │${" ".repeat(pad)}${chalk.bold.white(label)}${" ".repeat(pad)}│`
    )
  );
  console.log(chalk.cyan(`  ╰${"─".repeat(inner)}╯\n`));
}

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
  if (config.skipPermissions) {
    configArgs.push("--dangerously-skip-permissions");
  }

  printBanner(name);

  const child = spawn("claude", [...configArgs, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: getProfileDir(name) },
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
  // No subcommand → interactive selector
  (async () => {
    await ensureClauthDir();
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
  program.parse(argv);
}
