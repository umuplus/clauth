# clauth

Manage multiple Claude CLI account profiles. Switch between accounts, track per-profile usage stats, launch Claude with per-directory profile memory, and build a persistent knowledge wiki that compounds across sessions (Hive Mind). Use the CLI or the built-in web UI.

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
clauth config work --no-skip-permissions

# Enable Hive Mind for a profile (see below)
clauth config work --hive-mind
clauth config work --no-hive-mind
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

### `clauth ui`

Launch the clauth web UI in your browser. A local, graphical interface for browsing the Hive Mind wiki, feeding knowledge, querying, managing profiles, and viewing stats.

```bash
clauth ui                  # random free port, opens browser
clauth ui --port 3030      # specific port
clauth ui --no-open        # don't auto-open browser (useful for SSH tunneling)
```

The server binds only to `127.0.0.1` (localhost) — never exposed to the network.

Features available in the UI:
- **Dashboard** — overview of wiki pages, profile status, recent activity
- **Hive browser** — navigate wiki pages by category with rendered markdown
- **Feed** — textarea or drag-drop file upload for ingest
- **Query** — chat-like interface for read-only questions
- **Graph** — visual knowledge graph (Cytoscape.js) showing links between pages
- **Profiles** — toggle skip-permissions and hive-mind per profile
- **Stats** — real charts for token usage and activity

### `clauth hive [prompt]`

Feed knowledge into the Hive Mind wiki, query it, or browse it. See the **Hive Mind** section below for the full picture.

```bash
# Feed knowledge manually (ingest)
clauth hive "decided to use Postgres for project X because we need transactions"

# Query the wiki (read-only)
clauth hive --query "what databases am I using across projects?"

# Health-check the wiki (find contradictions, orphans, broken links)
clauth hive --lint

# Ingest a file (markdown, text, PDF)
clauth hive --file meeting-notes.md
clauth hive --file report.pdf "focus on the client requirements section"

# Browse the wiki (instant, no LLM)
clauth hive --index           # print the content catalog
clauth hive --log             # print the last 10 log entries
clauth hive --log 30          # print the last 30 entries
clauth hive --open            # open the wiki directory in your file manager
clauth hive --obsidian        # open the wiki in Obsidian (requires Obsidian 1.0+)

# Reset knowledge (destructive, prompts for confirmation)
clauth hive --reset clauth              # drop one project's pages + its index entry
clauth hive --reset clients/mmi         # drop a single client page
clauth hive --reset people/muge-gunduz  # drop a single person page
clauth hive --reset                     # wipe the entire wiki and rescaffold it empty
clauth hive --reset -y                  # skip the confirmation prompt
```

## Hive Mind

A personal knowledge wiki that the LLM builds and maintains for you. It captures decisions, problems, tradeoffs, architecture, and context from your Claude Code sessions and makes them available to future sessions.

The wiki is a folder of markdown files at `~/.clauth/hive/` — open it in Obsidian for a visual knowledge graph.

### Enable it

```bash
clauth config <profile> --hive-mind
```

When enabled, after every Claude session ends under that profile, clauth spawns a headless analysis session that reads the session log and upserts extracted knowledge into the wiki. Runs synchronously with a brief summary.

### Two feed paths

**1. Automatic** — Claude Code sessions are analyzed after they end. Decisions, problems, tradeoffs, and architecture are extracted and filed into the appropriate wiki pages.

**2. Manual** — `clauth hive "<prompt>"` feeds knowledge directly. Useful for decisions made in meetings, context from Slack, corrections, or anything that didn't come from a session. Also supports file ingest via `--file`.

### Categories

The wiki organizes knowledge across six categories:

| Category | What goes here |
|----------|----------------|
| `projects/` | Per-project technical knowledge (decisions, architecture, problems) |
| `concepts/` | Cross-project patterns, tools, techniques |
| `clients/` | Customer profiles, ownership, requirements |
| `company/` | Internal organization — team, processes, strategy |
| `personal/` | Health, interests, goals, habits |
| `people/` | Contacts, collaborators, stakeholders |

Pages use YAML frontmatter and relative markdown links. Obsidian-compatible out of the box.

### Context injection

When you launch a session in a project that already has wiki pages, clauth injects the accumulated knowledge into Claude's system prompt. The session starts already knowing your prior decisions and context — no need to re-explain.

### The schema

The wiki has its own `CLAUDE.md` at `~/.clauth/hive/CLAUDE.md` that governs how the LLM maintains it — page format, operation rules, create-vs-update logic. It's co-evolved over time. To refresh it from the latest clauth version: delete the file and run any clauth command to regenerate.

### Design lineage — Karpathy's LLM wiki

Hive Mind is a direct implementation of the **LLM wiki** pattern proposed by Andrej Karpathy ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)). The core idea: instead of RAG rediscovering answers from raw documents on every query, an LLM maintains a *persistent, compounding* wiki where cross-references and synthesis already reflect everything it has read. The pattern has three layers — immutable raw sources, an LLM-owned wiki, and a schema that disciplines how the LLM maintains it — plus three workflows: **ingest**, **query**, and **lint**.

**Where Hive Mind stays faithful to the pattern:**

- **Three layers, intact.** Raw sources (session logs), the LLM-owned wiki (`~/.clauth/hive/`), and the governing schema (`hive/CLAUDE.md`) map one-to-one onto Karpathy's model.
- **Schema as the disciplined maintainer.** The gist warns that without a schema the LLM "behaves like a generic chatbot." Hive Mind's `CLAUDE.md` encodes page format, the six categories, and explicit create-vs-update rules — exactly this role.
- **LLM-only writes; humans curate.** Wiki pages are never hand-edited in the normal flow; the LLM owns synthesis while you direct what gets fed in.
- **`index.md` + `log.md` navigation.** Surfaced as `clauth hive --index` and `--log`, mirroring the gist's catalog-and-chronicle pair.
- **The lint workflow.** `clauth hive --lint` performs the health check Karpathy describes — contradictions, orphans, broken links, stale claims — and the same warning applies: skip it and "hallucinations slowly become the ground truth."
- **Deterministic vs. LLM split.** `--index` / `--log` / `--open` browse the wiki with zero LLM calls, keeping token spend for synthesis and judgment, as the gist recommends.

**Where Hive Mind deliberately diverges — adapted for its goal of a passive, personal knowledge base:**

- **Source capture is inverted — and automated.** Karpathy's pattern assumes humans curate the raw sources and direct ingestion. Hive Mind's distinctive bet is the opposite: the primary "raw source" is your *coding sessions themselves*, ingested automatically by a post-session analyzer. The wiki compounds passively, without you stopping to file anything — at the cost of trading away human-in-the-loop curation, which makes the `--lint` discipline more load-bearing, not less. (The manual `clauth hive "<text>"` / `--file` path preserves the classic human-curated flow alongside it.)
- **Closed-loop context injection.** The gist focuses on read/write within the wiki. Hive Mind adds a step beyond it: accumulated project knowledge is re-injected into future sessions via `--append-system-prompt`, so the wiki doesn't just answer queries — it silently primes the next session. This turns "compounding artifact" into a closed feedback loop specific to the coding-agent setting.
- **Query is read-only by design.** Karpathy suggests queries should file valuable discoveries back into the wiki. Hive Mind keeps `--query` side-effect-free so reading never mutates the knowledge base; new knowledge enters only through the (automatic or manual) ingest paths, where it's subject to the schema's create-vs-update discipline. This is a deliberate trade — predictability over maximal compounding.

## How It Works

Profiles are stored under `~/.clauth/`. Each profile gets its own directory that acts as an isolated Claude configuration directory.

- **default** — automatically created, points to your existing `~/.claude` config
- **Other profiles** — stored as `~/.clauth/<name>/` and launched with `CLAUDE_CONFIG_DIR` set accordingly
- **hive** — reserved name for the Hive Mind wiki directory (not a profile)

When you launch a profile, clauth:
1. Records it as the last-used profile for the current directory (`~/.clauth/folders.json`)
2. Sets `CLAUDE_CONFIG_DIR` to the profile's directory (except for `default`)
3. If Hive Mind is enabled, injects accumulated project knowledge via `--append-system-prompt`
4. Spawns `claude` with any configured flags and passthrough arguments
5. After the session exits, if Hive Mind is enabled, runs a headless analysis session that upserts new knowledge into the wiki

## Directory Structure

```
~/.clauth/
  ├── default/          # metadata for the default profile
  │   └── clauth.json   # per-profile config (e.g. skipPermissions, hiveMind)
  ├── work/             # full Claude config dir for "work"
  │   ├── clauth.json
  │   ├── credentials.json
  │   └── ...
  ├── personal/
  │   └── ...
  ├── hive/             # Hive Mind wiki (see above)
  │   ├── CLAUDE.md     # schema — how the LLM maintains the wiki
  │   ├── index.md      # content catalog
  │   ├── log.md        # chronological record of ingests and queries
  │   ├── projects/
  │   ├── concepts/
  │   ├── clients/
  │   ├── company/
  │   ├── personal/
  │   └── people/
  ├── folders.json      # directory → profile mapping
  └── .last             # globally last-used profile name
```

## License

MIT
