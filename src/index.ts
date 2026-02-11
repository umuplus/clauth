#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";

const program = new Command();

program
  .name("clauth")
  .description("Manage multiple Claude CLI account profiles")
  .version("1.0.0");

program
  .command("add <name>")
  .description("Create a new profile")
  .action((name: string) => {
    console.log(chalk.green(`Adding profile: ${name}`));
  });

program
  .command("remove <name>")
  .description("Delete a profile")
  .action((name: string) => {
    console.log(chalk.red(`Removing profile: ${name}`));
  });

program
  .command("list")
  .description("Show all profiles")
  .action(() => {
    console.log(chalk.blue("Listing profiles..."));
  });

program
  .command("use <name>")
  .description("Launch claude with the selected profile")
  .allowUnknownOption(true)
  .action((name: string) => {
    console.log(chalk.cyan(`Using profile: ${name}`));
  });

// No args = interactive selector (TODO)
if (process.argv.length <= 2) {
  console.log(chalk.yellow("Interactive profile selector coming soon..."));
  process.exit(0);
}

program.parse();
