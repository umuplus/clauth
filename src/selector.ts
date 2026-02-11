import chalk from "chalk";
import type { ProfileInfo } from "./profiles.js";

export function selectProfile(
  profiles: ProfileInfo[]
): Promise<string | null> {
  return new Promise((resolve) => {
    let index = 0;
    const { stdin, stdout } = process;

    stdout.write("\x1B[?25l"); // hide cursor

    function formatLine(i: number): string {
      const p = profiles[i];
      const cursor = i === index ? chalk.cyan("❯") : " ";
      const dot = p.authenticated ? chalk.green("●") : chalk.dim("○");
      const name =
        i === index ? chalk.cyan.bold(p.name) : chalk.white(p.name);
      const auth = p.authenticated ? chalk.dim(" authenticated") : "";
      return `  ${cursor} ${dot} ${name}${auth}`;
    }

    function render(initial: boolean): void {
      if (!initial) {
        stdout.write(`\x1B[${profiles.length}A`);
      }
      for (let i = 0; i < profiles.length; i++) {
        stdout.write(`\x1B[2K${formatLine(i)}\n`);
      }
    }

    // Header
    stdout.write(
      `\n  ${chalk.bold("Select a profile")}  ${chalk.dim("↑↓ navigate · enter select · q quit")}\n\n`
    );
    render(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function cleanup(): void {
      stdout.write("\x1B[?25h"); // show cursor
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onKey);
    }

    function onKey(key: string): void {
      if (key === "\x03") {
        cleanup();
        console.log();
        process.exit(0);
      }

      if (key === "q" || (key === "\x1B" && key.length === 1)) {
        cleanup();
        console.log();
        resolve(null);
        return;
      }

      // Up
      if (key === "\x1B[A" || key === "k") {
        index = (index - 1 + profiles.length) % profiles.length;
        render(false);
      }

      // Down
      if (key === "\x1B[B" || key === "j") {
        index = (index + 1) % profiles.length;
        render(false);
      }

      // Enter
      if (key === "\r") {
        cleanup();
        console.log();
        resolve(profiles[index].name);
      }
    }

    stdin.on("data", onKey);
  });
}
