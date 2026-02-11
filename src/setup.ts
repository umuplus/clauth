import chalk from "chalk";
import { createInterface, type Interface } from "node:readline";
import {
  isValidName,
  isReservedName,
  profileExists,
  createProfile,
  setConfig,
  getProfilesWithStatus,
} from "./profiles.js";
import { printHeader, formatProfileLine } from "./ui.js";

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  printHeader();
  console.log(chalk.bold("  Profile Setup\n"));

  try {
    let addMore = true;
    while (addMore) {
      // Ask profile name
      const name = (await ask(rl, "  Profile name: ")).trim();

      if (!name) {
        console.log(chalk.red("  Profile name cannot be empty.\n"));
        continue;
      }

      if (!isValidName(name)) {
        console.log(
          chalk.red(
            `  Invalid name "${name}". Use letters, numbers, hyphens, underscores.\n`
          )
        );
        continue;
      }

      if (isReservedName(name)) {
        console.log(
          chalk.red(
            `  "${name}" is reserved. It's auto-created as a link to your existing Claude config.\n`
          )
        );
        continue;
      }

      if (await profileExists(name)) {
        console.log(chalk.yellow(`  Profile "${name}" already exists.\n`));
        continue;
      }

      // Create profile
      await createProfile(name);
      console.log(chalk.green(`  ✓ Created profile "${name}"\n`));

      // Ask skip-permissions
      const skipAnswer = (
        await ask(
          rl,
          "  Enable skip-permissions? (--dangerously-skip-permissions) [y/N]: "
        )
      ).trim();

      if (skipAnswer.toLowerCase() === "y") {
        await setConfig(name, { skipPermissions: true });
        console.log(chalk.green("  ✓ skip-permissions on\n"));
      } else {
        console.log(chalk.dim("  skip-permissions off\n"));
      }

      // Ask add another
      const another = (
        await ask(rl, "  Add another profile? [y/N]: ")
      ).trim();
      addMore = another.toLowerCase() === "y";
      console.log();
    }
  } finally {
    rl.close();
  }

  // Print summary
  const profiles = await getProfilesWithStatus();
  const maxNameLen = Math.max(...profiles.map((p) => p.name.length));

  console.log(chalk.bold("  ── Setup complete ──────────────────\n"));
  for (const p of profiles) {
    console.log(formatProfileLine(p, { maxNameLen }));
  }
  console.log();
  console.log(`  Launch a profile with: ${chalk.cyan("clauth use <name>")}\n`);
}
