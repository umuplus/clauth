Build a Node.js CLI tool called `clauth` (Claude + Auth) for managing multiple Claude CLI account profiles.

**Core concept:** Each profile is just a named wrapper around `CLAUDE_CONFIG_DIR=~/.clauth/<name> claude`. No credential handling, no proxying — just isolated config directories and a nice UX.

**Commands:**
- `clauth add <name>` — Create a new profile (creates config dir, runs `claude /login` with that config dir)
- `clauth remove <name>` — Delete a profile and its config dir (with confirmation)
- `clauth list` — Show all profiles, highlight which ones have active auth
- `clauth use <name> [-- ...args]` — Launch `claude` with the selected profile's config dir, forwarding any extra args
- `clauth` (no args) — Interactive profile selector with arrow keys, then launches claude

**UX requirements:**
- Use a TUI library (ink, inquirer, or similar) for the interactive selector
- Colorful, polished terminal output — profile names color-coded, status indicators, boxed layouts
- Show the active profile name in a banner before launching claude
- Fast startup, minimal dependencies

**Important constraints:**
- NEVER touch or read credential files directly — only set `CLAUDE_CONFIG_DIR` env var and let claude handle auth
- All profiles stored under `~/.clauth/`
- Pass through all claude CLI args transparently via `--` separator
- Works on macOS and Linux

Make it something you'd actually want to use daily.

---

`clauth` rolls off the tongue nicely — good luck with the build! Let me know if you want to brainstorm anything else for it.
