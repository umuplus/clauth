# clauth

Manage multiple Claude CLI account profiles. Switch between accounts, track per-profile usage stats, and launch Claude with per-directory profile memory.

## Install

```bash
npm install -g @cloudomium/clauth
```

Requires the [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) to be installed.

## Quick Start

```bash
# Create profiles for your accounts
clauth add work
clauth add personal

# Launch Claude with a profile — it will prompt to log in on first use
clauth launch work

# Or just run clauth to get an interactive selector
clauth
```

## Commands

### `clauth`

Running clauth with no arguments opens an interactive profile selector. Navigate with arrow keys (or j/k), press enter to select, q to quit.

The selector remembers which profile you last used in the current directory and pre-selects it.

### `clauth add <name>`

Create a new profile. Profile names can contain letters, numbers, hyphens, and underscores.

```bash
clauth add work
# ✓ Created profile "work"
```

### `clauth remove <name>`

Delete a profile and all its data. Prompts for confirmation before deleting.

```bash
clauth remove work
# Delete profile "work" and all its data? [y/N]
```

### `clauth launch [name]`

Launch Claude CLI with the given profile. If no name is provided, it uses the profile last used in the current directory (or the globally last-used profile).

```bash
# Launch a specific profile
clauth launch work

# Launch the last-used profile for this directory
clauth launch
```

You can pass extra arguments to the Claude CLI after `--`:

```bash
clauth launch work -- --model sonnet
```

### `clauth config <name>`

View or update per-profile configuration.

```bash
# View current config
clauth config work

# Enable --dangerously-skip-permissions for a profile
clauth config work --skip-permissions

# Disable it
clauth config work --no-skip-permissions
```

### `clauth stats [name]`

Show usage statistics. Without a name, shows a summary table for all profiles. With a name, shows detailed stats including token usage by model and activity charts.

```bash
# Overview of all profiles
clauth stats

# Detailed stats for a specific profile
clauth stats work
```

Detailed view includes:
- Session and message counts
- Token usage broken down by model (input, output, cache)
- 14-day message activity chart
- 7-day bar chart

### `clauth setup`

Interactive wizard that walks you through creating profiles and configuring them.

```bash
clauth setup
```

## How It Works

Profiles are stored under `~/.clauth/`. Each profile gets its own directory that acts as an isolated Claude configuration directory.

- **default** — automatically created, points to your existing `~/.claude` config
- **Other profiles** — stored as `~/.clauth/<name>/` and launched with `CLAUDE_CONFIG_DIR` set accordingly

When you launch a profile, clauth:
1. Records it as the last-used profile for the current directory (`~/.clauth/folders.json`)
2. Sets `CLAUDE_CONFIG_DIR` to the profile's directory (except for `default`)
3. Spawns `claude` with any configured flags and passthrough arguments

## Directory Structure

```
~/.clauth/
  ├── default/          # metadata for the default profile
  │   └── clauth.json   # per-profile config (e.g. skipPermissions)
  ├── work/             # full Claude config dir for "work"
  │   ├── clauth.json
  │   ├── credentials.json
  │   └── ...
  ├── personal/
  │   └── ...
  ├── folders.json      # directory → profile mapping
  └── .last             # globally last-used profile name
```

## License

MIT
