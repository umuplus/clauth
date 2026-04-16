import { join, basename, dirname } from "node:path";
import { mkdir, access, writeFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getClauthDir } from "./profiles.js";

const HIVE_DIR = join(getClauthDir(), "hive");

export function getHiveDir(): string {
  return HIVE_DIR;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (!(await fileExists(path))) {
    await writeFile(path, content);
  }
}

export async function ensureHiveDir(): Promise<void> {
  await mkdir(HIVE_DIR, { recursive: true });
  await mkdir(join(HIVE_DIR, "projects"), { recursive: true });
  await mkdir(join(HIVE_DIR, "concepts"), { recursive: true });

  await writeIfMissing(join(HIVE_DIR, "CLAUDE.md"), SCHEMA_CONTENT);
  await writeIfMissing(join(HIVE_DIR, "index.md"), INDEX_CONTENT);
  await writeIfMissing(join(HIVE_DIR, "log.md"), LOG_CONTENT);
}

const SCHEMA_CONTENT = `# Hive Mind Wiki — Schema

You are maintaining a personal knowledge wiki built from Claude Code sessions. This file governs how you read, write, and maintain every page in this wiki. Follow these conventions exactly.

## Purpose

This wiki captures the accumulated knowledge from development sessions across all projects — decisions made, problems solved, tradeoffs considered, architecture chosen, context discovered. It is a persistent, compounding artifact. Knowledge is compiled once and kept current, not re-derived from scratch.

## Directory structure

\`\`\`
~/.clauth/hive/
  CLAUDE.md         # This file — schema and conventions (do not delete)
  index.md          # Content catalog — every page with a one-line summary
  log.md            # Chronological record of all ingests and queries
  projects/         # Per-project knowledge
    <project-name>/
      decisions.md      # Key decisions and their rationale
      architecture.md   # System design, patterns, structure
      problems.md       # Bugs, failures, and how they were resolved
      context.md        # Constraints, requirements, goals, stakeholders
      ...               # Additional pages as needed
  concepts/         # Cross-project knowledge
    <concept-name>.md   # Patterns, tools, techniques that span projects
\`\`\`

**Project scoping**: Every project gets its own subdirectory under \`projects/\`. The directory name is derived from the working directory (e.g., \`/Users/umut/Projects/clauth\` → \`clauth\`). This prevents cross-project entity confusion — "the auth module" in project A is separate from project B.

**Concept pages** are for knowledge that spans multiple projects — a library, a pattern, a technique, a tool. Link concept pages from project pages when they're relevant.

## Page format

Every wiki page (except index.md and log.md) uses this structure:

\`\`\`markdown
---
title: Page Title
project: project-name    # omit for concept pages
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tag1, tag2]
---

# Page Title

Content organized under clear headings. Use concise prose.

## See also

- [Related Page](../path/to/page.md)
\`\`\`

Rules:
- Always include YAML frontmatter with at least \`title\`, \`created\`, \`updated\`
- Update the \`updated\` date whenever you modify a page
- Use relative links between wiki pages (e.g., \`../concepts/graphql.md\`)
- Keep pages focused — one topic per page. Split when a page grows beyond ~200 lines
- Use headings (##, ###) to structure content. Keep nesting shallow

## Operations

### Ingest from session log

When processing a session JSONL log:

1. **Skim first** — scan the log for structure. Identify the project, the main topics discussed, the key turning points. Don't read every line — focus on user messages, assistant reasoning, and tool call patterns that indicate decisions or problems.
2. **Read the current wiki state** — check index.md, then read relevant existing pages for this project. Understand what's already captured.
3. **Extract knowledge** — focus on:
   - **Decisions**: what was chosen and why (tech stack, library, approach, architecture)
   - **Problems**: what broke, the root cause, how it was fixed, what was learned
   - **Tradeoffs**: what alternatives were considered and why they were rejected
   - **Architecture**: system design, component structure, data flow, patterns adopted
   - **Context**: constraints, requirements, deadlines, stakeholder needs that shaped the work
4. **Skip noise** — do NOT extract:
   - Line-by-line code changes (that's what git is for)
   - Raw tool outputs (file contents, grep results, test output)
   - Trivial operations (formatting fixes, typo corrections, dependency updates)
   - Routine debugging steps that didn't reveal anything surprising
5. **Upsert pages** — create new pages or update existing ones:
   - If a relevant page exists, update it with new information. Merge, don't duplicate.
   - If the information doesn't fit any existing page, create a new one.
   - When new information contradicts existing content, update the page and note what changed and when.
6. **Update index.md** — add entries for any new pages. Update summaries for modified pages.
7. **Append to log.md** — record what you did.
8. **Print a summary** — as your final output, print a single line in this exact format:
   \`HIVE_SUMMARY: <short description of what was extracted and updated>\`
   Example: \`HIVE_SUMMARY: extracted 2 decisions, 1 architecture update; created projects/clauth/problems.md; updated index\`
   This line is parsed by clauth to display a brief status to the user. Keep it under 120 characters.

### Ingest from manual input

When processing a direct user prompt (via \`clauth hive\`):

1. Read the input carefully. It may be a decision, a correction, context, or a question.
2. Read index.md to understand current wiki state.
3. If it's new knowledge: upsert into the appropriate page(s), update index, append to log.
4. If it's a correction: find the relevant page(s), update them, note the correction in the log.
5. If it's a question: treat it as a query (see below).
6. **Print a summary** — as your final output, print: \`HIVE_SUMMARY: <what you did>\`

### Query

When answering a question against the wiki:

1. Read index.md to find relevant pages.
2. Read those pages and synthesize an answer.
3. Cite your sources with page links.
4. If the answer is substantial and reusable, offer to file it as a new wiki page.
5. **Print a summary** — as your final output, print: \`HIVE_SUMMARY: <what you answered or filed>\`

## Index maintenance — index.md

Format:

\`\`\`markdown
# Hive Mind — Index

## Projects

### project-name
- [Decisions](projects/project-name/decisions.md) — Key technical decisions and rationale
- [Architecture](projects/project-name/architecture.md) — System design and patterns

## Concepts

- [Concept Name](concepts/concept-name.md) — One-line summary
\`\`\`

Rules:
- One line per page: link + one-line summary (under 100 chars)
- Grouped by project, then concepts
- Alphabetical within each group
- Update on every ingest — add new entries, revise summaries for updated pages
- Remove entries for deleted pages

## Log maintenance — log.md

Format:

\`\`\`markdown
# Hive Mind — Log

## [YYYY-MM-DD] ingest | session | project-name
Extracted: 3 decisions, 1 architecture update. Created problems.md. Updated index.

## [YYYY-MM-DD] ingest | manual
Input: "switched from REST to GraphQL for mobile subscriptions"
Updated: projects/app/decisions.md, concepts/graphql.md. Updated index.

## [YYYY-MM-DD] query
Question: "what auth patterns am I using across projects?"
Answer filed as: concepts/auth-patterns.md
\`\`\`

Rules:
- Append only — never edit or delete previous entries
- Each entry starts with \`## [YYYY-MM-DD] type | details\`
- Types: \`ingest | session\`, \`ingest | manual\`, \`query\`, \`lint\`
- Keep entries concise — 1-3 lines each
- The log is parseable: \`grep "^## \\[" log.md | tail -10\` gives recent entries

## Decision rules — create vs. update

- **Update** when: the page already covers this topic and the new info adds to it, refines it, or corrects it.
- **Create** when: the topic is new and doesn't fit naturally into any existing page.
- **Split** when: a page is getting too long (>200 lines) or covers clearly distinct subtopics.
- **Never duplicate**: if the same decision or fact appears in two places, consolidate into one page and link from the other.
- When in doubt, update rather than create. Fewer, richer pages beat many shallow ones.
`;

const INDEX_CONTENT = `# Hive Mind — Index

## Projects

(No projects yet)

## Concepts

(No concepts yet)
`;

const LOG_CONTENT = `# Hive Mind — Log

(Initialized — no entries yet)
`;

// --- session log detection ---

export async function snapshotSessionFiles(
  configDir: string
): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  const projectsDir = join(configDir, "projects");

  let projectDirs: string[];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(projectsDir, e.name));
  } catch {
    return snapshot;
  }

  for (const dir of projectDirs) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const st = await stat(filePath);
        snapshot.set(filePath, st.mtimeMs);
      } catch {
        continue;
      }
    }
  }

  return snapshot;
}

export async function detectNewSessionLog(
  configDir: string,
  before: Map<string, number>
): Promise<string | null> {
  const after = await snapshotSessionFiles(configDir);

  let bestPath: string | null = null;
  let bestMtime = 0;

  for (const [filePath, mtimeMs] of after) {
    const prevMtime = before.get(filePath);
    // New file or modified file
    if (prevMtime === undefined || mtimeMs > prevMtime) {
      if (mtimeMs > bestMtime) {
        bestMtime = mtimeMs;
        bestPath = filePath;
      }
    }
  }

  return bestPath;
}

// --- project name ---

export function getProjectName(): string {
  return basename(process.cwd());
}

// --- post-session analysis ---

export interface HiveAnalysisResult {
  summary: string | null;
  error: string | null;
}

export function runHiveAnalysis(
  logPath: string,
  projectName: string,
  claudeConfigDir: string,
  profileName: string
): Promise<HiveAnalysisResult> {
  return new Promise((resolve) => {
    const prompt = [
      `Analyze the Claude Code session log at ${logPath} for project "${projectName}".`,
      `Extract knowledge and upsert into the wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
      `Read the session log from disk. Focus on decisions, problems, tradeoffs, architecture, and context.`,
      `Skip trivial operations and raw tool outputs.`,
      `When done, print a HIVE_SUMMARY line as described in the schema.`,
    ].join(" ");

    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--add-dir", HIVE_DIR,
      "--add-dir", dirname(logPath),
      prompt,
    ];

    const env = { ...process.env };
    if (profileName !== "default") {
      env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    }

    const child = spawn("claude", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      resolve({ summary: null, error: err.message });
    });

    child.on("close", (code) => {
      if (code !== 0 && stderr) {
        resolve({ summary: null, error: stderr.trim() });
        return;
      }

      // Parse stdout for HIVE_SUMMARY line
      const summaryLine = stdout
        .split("\n")
        .find((line) => line.startsWith("HIVE_SUMMARY:"));

      const summary = summaryLine
        ? summaryLine.replace("HIVE_SUMMARY:", "").trim()
        : null;

      resolve({ summary, error: null });
    });
  });
}
