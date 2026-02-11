import chalk from "chalk";
import type { ProfileInfo } from "./profiles.js";
import { printHeader, formatProfileLine } from "./ui.js";

export function selectProfile(
  profiles: ProfileInfo[],
  preselect?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let index = preselect
      ? Math.max(0, profiles.findIndex((p) => p.name === preselect))
      : 0;
    const { stdin, stdout } = process;
    const maxNameLen = Math.max(...profiles.map((p) => p.name.length));

    stdout.write("\x1B[?25l"); // hide cursor

    // Header
    printHeader();
    const headerLines = 7; // header box + surrounding blank lines

    function render(initial: boolean): void {
      if (!initial) {
        stdout.write(`\x1B[${profiles.length + 2}A`);
      }
      stdout.write(
        `\x1B[2K  ${chalk.dim("↑↓ navigate · enter select · q quit")}\n\n`
      );
      for (let i = 0; i < profiles.length; i++) {
        stdout.write(
          `\x1B[2K${formatProfileLine(profiles[i], { selected: i === index, maxNameLen })}\n`
        );
      }
    }

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
