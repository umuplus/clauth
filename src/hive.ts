import { join, basename, dirname } from "node:path";
import { mkdir, access, writeFile, readFile, readdir, stat } from "node:fs/promises";
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
  for (const dir of ["projects", "concepts", "clients", "company", "personal", "people"]) {
    await mkdir(join(HIVE_DIR, dir), { recursive: true });
  }

  await writeIfMissing(join(HIVE_DIR, "CLAUDE.md"), SCHEMA_CONTENT);
  await writeIfMissing(join(HIVE_DIR, "index.md"), INDEX_CONTENT);
  await writeIfMissing(join(HIVE_DIR, "log.md"), LOG_CONTENT);
}

const SCHEMA_CONTENT = `# Hive Mind Wiki — Schema

You are maintaining a personal knowledge wiki. This file governs how you read, write, and maintain every page in this wiki. Follow these conventions exactly.

## Purpose

This wiki captures accumulated knowledge across all domains of the owner's life — development projects, business decisions, client relationships, company strategy, and personal interests. It is a persistent, compounding artifact. Knowledge is compiled once and kept current, not re-derived from scratch.

Sources include Claude Code session logs (auto-analyzed after sessions), manual input (direct prompts), and file ingests. The wiki synthesizes all of these into a coherent, cross-referenced knowledge base.

## Directory structure

\`\`\`
~/.clauth/hive/
  CLAUDE.md         # This file — schema and conventions (do not delete)
  index.md          # Content catalog — every page with a one-line summary
  log.md            # Chronological record of all ingests and queries
  projects/         # Per-project technical knowledge
    <project-name>/
      decisions.md      # Key decisions and their rationale
      architecture.md   # System design, patterns, structure
      problems.md       # Bugs, failures, and how they were resolved
      context.md        # Constraints, requirements, goals, stakeholders
      ...               # Additional pages as needed
  concepts/         # Cross-project technical concepts
    <concept-name>.md   # Patterns, tools, techniques that span projects
  clients/          # Customer/client profiles
    <client-name>.md    # Ownership, projects, requirements, communication
  company/          # Internal organization knowledge
    <topic>.md          # Team, processes, strategy, roadmap, culture
  personal/         # Personal knowledge
    <topic>.md          # Health, interests, goals, habits, reflections
  people/           # Contact and collaborator profiles
    <person-name>.md    # Role, expertise, context, relationship
\`\`\`

### Category conventions

**projects/**: Every project gets its own subdirectory. The directory name is derived from the working directory (e.g., \`/Users/umut/Projects/clauth\` → \`clauth\`). This prevents cross-project entity confusion.

**concepts/**: Knowledge that spans multiple projects — a library, a pattern, a technique, a tool. Link from project pages when relevant.

**clients/**: One page per client/customer. Include which projects they own, key requirements, communication style, important context. Link to project pages.

**company/**: Internal organizational knowledge — team structure, processes, strategy, roadmap, values. Things that shape how work gets done but aren't tied to a single project.

**personal/**: The owner's personal knowledge — health tracking, interests, goals, learning notes, habits. Private and subjective.

**people/**: Profiles of collaborators, contacts, stakeholders. Their role, expertise, and how they relate to projects/clients. Not a contacts database — only people relevant to the knowledge base.

### Relationship linking

When entities relate across categories, link in both directions:
- Client page mentions projects → link to \`../projects/<name>/\`
- Project context page mentions client → link to \`../clients/<name>.md\`
- Person page mentions their projects → link to \`../projects/<name>/\`
- Concept page mentions projects using it → link to \`../projects/<name>/\`

## Page format

Every wiki page (except index.md and log.md) uses this structure:

\`\`\`markdown
---
title: Page Title
category: project | concept | client | company | personal | people
project: project-name    # only for project category pages
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
- Always include YAML frontmatter with at least \`title\`, \`category\`, \`created\`, \`updated\`
- Update the \`updated\` date whenever you modify a page
- Use relative links between wiki pages (e.g., \`../concepts/graphql.md\`)
- Keep pages focused — one topic per page. Split when a page grows beyond ~200 lines
- Use headings (##, ###) to structure content. Keep nesting shallow
- Add bidirectional links when entities relate across categories

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

### Ingest from file

When processing a file (invoked with \`clauth hive --file <path>\`):

1. Read the file from disk. Supported formats: markdown, plain text, PDF.
2. If an additional prompt was provided, use it as focus/context for what to extract.
3. Read index.md to understand current wiki state.
4. Extract knowledge from the file — treat it like any other source. Focus on decisions, context, entities, and facts.
5. Upsert into the appropriate page(s), update index, append to log.
6. In the log entry, note the source file path.
7. **Print a summary** — as your final output, print: \`HIVE_SUMMARY: <what you extracted and updated>\`

### Query

When answering a question against the wiki (invoked with \`clauth hive --query\`):

1. Read index.md to find relevant pages.
2. Read those pages and synthesize an answer.
3. Cite your sources with page links.
4. Do NOT modify any wiki pages — queries are read-only.
5. If the answer is substantial and reusable, suggest filing it as a new page (but don't do it unless explicitly asked).
6. **Print a summary** — as your final output, print: \`HIVE_SUMMARY: <what you answered>\`

### Lint

When health-checking the wiki (invoked with \`clauth hive --lint\`):

1. Read index.md and scan all wiki pages.
2. Check for:
   - **Contradictions** — pages that disagree with each other
   - **Stale claims** — information that newer entries have superseded
   - **Orphan pages** — pages with no inbound links from other pages
   - **Missing pages** — concepts or entities mentioned but lacking their own page
   - **Missing cross-references** — related pages that should link to each other but don't
   - **Broken links** — links that point to pages that don't exist
3. Fix what you can (add missing links, remove broken links, update stale claims).
4. Report what you found and what you fixed.
5. Append a lint entry to log.md.
6. **Print a summary** — as your final output, print: \`HIVE_SUMMARY: <what you found and fixed>\`

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

## Clients

- [Client Name](clients/client-name.md) — One-line summary

## Company

- [Topic](company/topic.md) — One-line summary

## Personal

- [Topic](personal/topic.md) — One-line summary

## People

- [Person Name](people/person-name.md) — One-line summary
\`\`\`

Rules:
- One line per page: link + one-line summary (under 100 chars)
- Grouped by category: Projects, Concepts, Clients, Company, Personal, People
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

## Clients

(No clients yet)

## Company

(No company knowledge yet)

## Personal

(No personal knowledge yet)

## People

(No people yet)
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

// --- hive operations ---

export interface HiveAnalysisResult {
  summary: string | null;
  error: string | null;
}

export type HiveStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "system"; message: string };

export type HiveOnEvent = (event: HiveStreamEvent) => void;

function extractSummary(text: string): string | null {
  const line = text
    .split("\n")
    .find((l) => l.startsWith("HIVE_SUMMARY:"));
  return line ? line.replace("HIVE_SUMMARY:", "").trim() : null;
}

function shorten(s: string, max = 70): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function formatToolDetail(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : undefined);
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return str("file_path");
    case "Bash":
      return str("command") ? shorten(str("command")!) : str("description");
    case "Grep": {
      const pattern = str("pattern");
      const path = str("path") ?? str("glob");
      return pattern ? (path ? `${pattern} in ${path}` : pattern) : undefined;
    }
    case "Glob":
      return str("pattern");
    case "WebFetch":
      return str("url");
    case "WebSearch":
      return str("query");
    case "Task":
    case "Agent":
      return str("description");
    default:
      return undefined;
  }
}

function handleStreamLine(line: string, onEvent: HiveOnEvent): void {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (!ev || typeof ev !== "object") return;
  const e = ev as { type?: string; subtype?: string; message?: { content?: unknown[] } };
  if (e.type === "assistant" && Array.isArray(e.message?.content)) {
    for (const block of e.message!.content as Array<{ type?: string; text?: string; name?: string; input?: unknown }>) {
      if (block.type === "text" && typeof block.text === "string") {
        onEvent({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const detail = formatToolDetail(block.name, block.input);
        onEvent({ kind: "tool", name: block.name, detail });
      }
    }
  } else if (e.type === "system" && e.subtype === "init") {
    onEvent({ kind: "system", message: "session started" });
  }
}

function spawnHiveSession(
  prompt: string,
  extraAddDirs: string[],
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  return new Promise((resolve) => {
    // Pass prompt via stdin (not as positional arg) because --add-dir is
    // variadic in claude CLI and would consume the prompt as a directory.
    const useStream = !!onEvent;
    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--add-dir", HIVE_DIR,
      ...extraAddDirs.flatMap((dir) => ["--add-dir", dir]),
    ];
    if (useStream) {
      // stream-json requires --verbose in non-interactive mode
      args.push("--output-format", "stream-json", "--verbose");
    }

    const env = { ...process.env };
    if (profileName !== "default") {
      env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    }

    const child = spawn("claude", args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let buf = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (!useStream) return;
      buf += text;
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) handleStreamLine(line, onEvent!);
      }
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

      if (!useStream) {
        resolve({ summary: extractSummary(stdout), error: null });
        return;
      }

      // In stream-json mode the summary may live inside a content block
      // or the final result event. Concatenate all assistant text.
      let allText = "";
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
            for (const b of ev.message.content) {
              if (b.type === "text" && typeof b.text === "string") allText += b.text + "\n";
            }
          } else if (ev.type === "result" && typeof ev.result === "string") {
            allText += ev.result + "\n";
          }
        } catch {
          continue;
        }
      }
      resolve({ summary: extractSummary(allText), error: null });
    });
  });
}

export function runHiveAnalysis(
  logPath: string,
  projectName: string,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const prompt = [
    `Analyze the Claude Code session log at ${logPath} for project "${projectName}".`,
    `Extract knowledge and upsert into the wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Read the session log from disk. Focus on decisions, problems, tradeoffs, architecture, and context.`,
    `Skip trivial operations and raw tool outputs.`,
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [dirname(logPath)], claudeConfigDir, profileName, onEvent);
}

export function runHiveManual(
  userPrompt: string,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const prompt = [
    `You are maintaining the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Process the following input and upsert accordingly:`,
    userPrompt,
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent);
}

export function runHiveQuery(
  userPrompt: string,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const prompt = [
    `You are querying the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `This is a READ-ONLY query. Do NOT create, modify, or delete any wiki pages.`,
    `Answer the following question using the wiki's content:`,
    userPrompt,
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent);
}

export function runHiveLint(
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const prompt = [
    `You are performing a health check on the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Run the Lint operation as described in the schema.`,
    `Check for contradictions, stale claims, orphan pages, missing pages, missing cross-references, and broken links.`,
    `Fix what you can, report what you found.`,
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent);
}

export function runHiveFileIngest(
  filePath: string,
  focusPrompt: string | undefined,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const parts = [
    `You are maintaining the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Read the file at ${filePath} and extract knowledge from it.`,
  ];
  if (focusPrompt) {
    parts.push(`Focus on: ${focusPrompt}`);
  }
  parts.push(`Upsert into the wiki, update index, append to log.`);
  parts.push(`When done, print a HIVE_SUMMARY line as described in the schema.`);

  return spawnHiveSession(parts.join(" "), [dirname(filePath)], claudeConfigDir, profileName, onEvent);
}

// --- cross-session context injection ---

export async function buildProjectContext(projectName: string): Promise<string | null> {
  const projectDir = join(HIVE_DIR, "projects", projectName);

  let files: string[];
  try {
    files = (await readdir(projectDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = await readFile(join(projectDir, file), "utf8");
      sections.push(content);
    } catch {
      continue;
    }
  }

  if (sections.length === 0) return null;

  return [
    `# Hive Mind — Prior knowledge for project "${projectName}"`,
    "",
    "The following is accumulated knowledge from previous sessions and manual input, maintained in the Hive Mind wiki.",
    "",
    ...sections,
  ].join("\n");
}
