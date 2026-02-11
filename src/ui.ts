import chalk from "chalk";
import gradient from "gradient-string";
import type { ProfileInfo } from "./profiles.js";

// Gradient theme: cyan → purple (Claude vibes)
const brand = gradient(["#86efac", "#38bdf8", "#60a5fa"]);

export function printHeader(): void {
  const title = "c l a u t h";
  const sub = "Claude Profile Manager";
  const width = 30;
  const tPad = Math.floor((width - title.length) / 2);
  const sPad = Math.floor((width - sub.length) / 2);

  console.log();
  console.log(brand(`  ╭${"─".repeat(width)}╮`));
  console.log(brand(`  │`) + brand(`${" ".repeat(tPad)}${title}${" ".repeat(width - tPad - title.length)}`) + brand(`│`));
  console.log(brand(`  │`) + chalk.dim(`${" ".repeat(sPad)}${sub}${" ".repeat(width - sPad - sub.length)}`) + brand(`│`));
  console.log(brand(`  ╰${"─".repeat(width)}╯`));
  console.log();
}

export function formatProfileLine(
  p: ProfileInfo,
  opts: { selected?: boolean; maxNameLen?: number } = {}
): string {
  const { selected = false, maxNameLen = 0 } = opts;

  const cursor = selected ? chalk.cyan("❯") : " ";
  const dot = p.authenticated ? chalk.green("●") : chalk.dim("○");
  const name = selected
    ? chalk.cyan.bold(p.name.padEnd(maxNameLen))
    : chalk.white(p.name.padEnd(maxNameLen));

  const badges: string[] = [];
  if (p.authenticated) {
    badges.push(chalk.green("authenticated"));
  } else {
    badges.push(chalk.dim("no auth"));
  }
  if (p.config.skipPermissions) {
    badges.push(chalk.yellow("skip-permissions"));
  }

  return `  ${cursor} ${dot} ${name}  ${badges.join(chalk.dim(" · "))}`;
}

export function printLaunchBanner(
  name: string,
  flags: string[]
): void {
  const label = `▶ ${name}`;
  const flagLine = flags.length > 0 ? flags.join(" · ") : "";
  const contentWidth = Math.max(label.length, flagLine.length) + 4;

  console.log();
  console.log(brand(`  ╭${"─".repeat(contentWidth)}╮`));
  console.log(brand(`  │  `) + chalk.bold.white(label.padEnd(contentWidth - 2)) + brand(`│`));
  if (flagLine) {
    console.log(brand(`  │  `) + chalk.dim(flagLine.padEnd(contentWidth - 2)) + brand(`│`));
  }
  console.log(brand(`  ╰${"─".repeat(contentWidth)}╯`));
  console.log();
}
