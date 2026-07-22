import { join, basename, dirname, resolve, relative, sep } from "node:path";
import { mkdir, access, writeFile, readFile, readdir, stat, rm, cp, open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getClauthDir } from "./profiles.js";
import {
  addQuestions,
  askedQuestionTexts,
  MAX_PER_RUN,
  type Question,
  type QuestionDraft,
} from "./hive-questions.js";

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

/**
 * Bump whenever SCHEMA_CONTENT changes in a way the analyzer must follow.
 * Wikis created before versioning existed are treated as v1.
 *
 * 2 — `summary` frontmatter field; the injected context became a map built from it.
 * 3 — cross-linking promoted from a convention to a numbered ingest step, after
 *     measurement showed backlinks were written in only one direction.
 * 4 — `## Sources` provenance section; each ingest records its origin on every
 *     page it touches, so a wrong claim can be traced to its source.
 * 5 — Synthesize operation; concepts/ pages must cite >=2 projects.
 * 6 — concepts/ restricted to technical knowledge; person/process recurrences
 *     (which pass the two-project test trivially) go to personal/ or company/.
 * 7 — the analyzer may ask the owner a question instead of guessing: the gap is
 *     marked on the page and the question queued, never blocking the write.
 */
const SCHEMA_VERSION = 7;

export interface SchemaUpgrade {
  from: number;
  to: number;
  backupPath: string;
}

const BACKUP_DIR = join(getClauthDir(), "hive-backups");
const BACKUPS_KEPT = 3;

/** Names this code creates. Anything else in the directory is left alone. */
const WIKI_SNAPSHOT = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;
const SCHEMA_SNAPSHOT = /^CLAUDE\.md\.v\d+-\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

/**
 * Keep the most recent `keep` backups of each kind and delete the rest.
 * Timestamped names sort lexicographically, so sorting is enough — no stat calls.
 * Only files this code wrote are eligible; anything a user put here is untouched.
 */
export async function pruneBackups(keep = BACKUPS_KEPT): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const wiki = entries.filter((e) => e.isDirectory() && WIKI_SNAPSHOT.test(e.name)).map((e) => e.name);
  const schema = entries.filter((e) => e.isFile() && SCHEMA_SNAPSHOT.test(e.name)).map((e) => e.name);

  const stale = [...wiki.sort().slice(0, -keep), ...schema.sort().slice(0, -keep)];
  for (const name of stale) {
    await rm(join(BACKUP_DIR, name), { recursive: true, force: true });
  }
  return stale;
}

function readSchemaVersion(content: string): number {
  const m = content.match(/<!--\s*clauth-schema-version:\s*(\d+)\s*-->/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Upgrade the wiki's CLAUDE.md when clauth ships a newer schema.
 *
 * Without this the file is written once and never touched again, so an existing
 * wiki keeps an old rulebook forever — the analyzer goes on following rules that
 * no longer match what the rest of clauth expects. The previous file is kept
 * rather than overwritten, since it is the one file a user may have hand-edited.
 */
async function upgradeSchema(stamp: string): Promise<SchemaUpgrade | null> {
  const schemaPath = join(HIVE_DIR, "CLAUDE.md");
  const current = await readPage(schemaPath);

  if (current === null) {
    await writeFile(schemaPath, SCHEMA_CONTENT);
    return null;
  }

  const from = readSchemaVersion(current);
  if (from >= SCHEMA_VERSION) return null;

  const backupPath = join(BACKUP_DIR, `CLAUDE.md.v${from}-${stamp}`);
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(backupPath, current);
  await writeFile(schemaPath, SCHEMA_CONTENT);
  await pruneBackups();

  return { from, to: SCHEMA_VERSION, backupPath };
}

export async function ensureHiveDir(): Promise<SchemaUpgrade | null> {
  await mkdir(HIVE_DIR, { recursive: true });
  for (const dir of ["projects", "concepts", "clients", "company", "personal", "people"]) {
    await mkdir(join(HIVE_DIR, dir), { recursive: true });
  }

  await writeIfMissing(join(HIVE_DIR, "index.md"), INDEX_CONTENT);
  await writeIfMissing(join(HIVE_DIR, "log.md"), LOG_CONTENT);

  return upgradeSchema(new Date().toISOString().replace(/[:.]/g, "-"));
}

const SCHEMA_CONTENT = `<!-- clauth-schema-version: 7 -->
# Hive Mind Wiki — Schema

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

**concepts/**: **Technical** knowledge that spans multiple projects — a library, a pattern, a technique, a tool. Link from project pages when relevant. Something that recurs across projects because the *same person* works on them — how they want to be worked with, their habits, their review preferences — is not a concept: file it under \`personal/\` (the owner's own preferences) or \`company/\` (process and ways of working). The test is whether the knowledge would still hold if someone else did the work.

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
summary: One line, under 100 characters — a pointer, not a summary
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tag1, tag2]
---

# Page Title

Content organized under clear headings. Use concise prose.

## See also

- [Related Page](../path/to/page.md)

## Sources

- 2026-01-15 · session a1b2c3d4-...
- 2026-01-20 · manual input
\`\`\`

Rules:
- Always include YAML frontmatter with at least \`title\`, \`category\`, \`summary\`, \`created\`, \`updated\`
- Update the \`updated\` date whenever you modify a page
- Use relative links between wiki pages (e.g., \`../concepts/graphql.md\`)
- Keep pages focused — one topic per page. Split when a page grows beyond ~200 lines
- Use headings (##, ###) to structure content. Keep nesting shallow
- Add bidirectional links when entities relate across categories

### The \`summary\` field — hard rules

\`summary\` is not decoration. It is the only thing about this page that future
sessions see by default: clauth builds a compact knowledge map from these fields
and injects that map instead of the page bodies. Everything else is read on demand.

- **Under 100 characters. This is a hard cap, not a guideline.** Longer summaries
  are truncated when the map is built, so an overlong one loses its tail.
- **Write a pointer, not an answer.** \`Auth decisions and their rationale\` is
  correct. \`Uses JWT with 24h expiry\` is wrong — it invites the reader to act on
  a partial fact instead of opening the page, and it goes stale silently.
- Name what *kind* of knowledge lives here, so a reader can tell whether it is
  relevant to the task in front of them.
- Update it when the page's scope changes — not on every content edit.

### The \`## Sources\` section — provenance

Every page ends with a \`## Sources\` section recording where its knowledge came
from. This is what lets a wrong claim be traced back: if a fact turns out to be
mistaken, its source line points at the exact session (or manual input) that
introduced it, so the other claims from that same source can be re-checked too.

- Each ingest is given its own source line (a date plus a session id, a file
  name, or "manual input"). Add that exact line to the \`## Sources\` section of
  **every page you create or touch** during the ingest.
- **Append only — never delete or rewrite existing source lines.** A page
  accumulates the full list of sources that shaped it over time.
- If the ingest's source line is already present on a page (you edited it twice
  in one run), do not add a duplicate.
- Order oldest-first. Keep it to one line per source; no prose.

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
6. **Cross-link both ways** — this is a required step, not a convention to apply if convenient.
   For every client, person or concept named in what you just extracted:
   - Open that entity's page (create it if it doesn't exist).
   - Make sure it links to this project.
   - **Then go back and edit the project page so it links to the entity.** This second
     edit is the one that gets forgotten: you have already finished writing the project
     page by this point, and re-opening it feels redundant. Do it anyway. A link that
     exists in only one direction is invisible from the other side — clauth builds each
     session's knowledge map by following these links, so a missing backlink means the
     entity never reaches the session that needed it.
   - Verify before finishing: for each entity you touched, both pages name the other.
7. **Update index.md** — add entries for any new pages. Update summaries for modified pages.
8. **Append to log.md** — record what you did.
9. **Print a summary** — as your final output, print a single line in this exact format:
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

### Synthesize

When synthesizing (invoked with \`clauth hive --synthesize\`):

The goal is to fill \`concepts/\` with knowledge that lives *between* projects —
patterns, tools, or approaches that recur across two or more of them. This is
knowledge no single project page can hold, because its value is the comparison.

1. Read the knowledge map and index.md to see what projects exist and what each holds.
2. Read the existing \`concepts/\` pages first, so you update rather than duplicate.
3. Look for a technique, library, pattern, or decision that appears in **two or
   more projects**. Open the relevant project pages to confirm it genuinely recurs.
4. For each real recurrence, create or update a \`concepts/<name>.md\` page. **Hard rules:**
   - **It must involve at least two projects.** Something in one project belongs on
     that project's page, not here. A concept page that cites fewer than two
     projects is invalid and will be flagged.
   - **It must be technical.** Two projects share the owner's habits, review
     preferences and working style by definition — that is one person, not a
     recurring technical pattern, and it passes the two-project test without
     meaning anything. Such findings belong in \`personal/\` or \`company/\`.
     Test: would this still be true if someone else did the work? If no, it is
     not a concept.
   - **Cite the evidence.** Link to the specific project pages the pattern is drawn
     from. These links are how the claim is checked.
   - **The difference is the content.** If two projects did the same thing
     differently, the valuable knowledge is *why they diverged* and *what each
     chose* — not merely that both use the technique. "Both use DynamoDB" is a
     label; "mmiProductHUB single-table vs spinneys table-per-entity, because …"
     is knowledge. If you cannot state the difference or the shared lesson, do not
     write the page.
   - **When you can see the difference but not its cause**, that reason usually
     exists only in the owner's head. Write the page with what you can observe,
     mark the gap, and put a question to the owner — see "Asking the owner a
     question". Do not guess a rationale, and do not drop the page over it.
5. Cross-link: from each project page the concept draws on, link back to the concept
   (the same bidirectional rule as ingest step 6).
6. Do NOT invent patterns to fill the section. An empty \`concepts/\` is better than
   a padded one. If nothing genuinely recurs across projects, write nothing.
7. Update index.md, append a synthesis entry to log.md, and record provenance
   (source line \`… · synthesis\`) on every page you create or modify.
8. **Print a summary** — \`HIVE_SUMMARY: <concepts created/updated, or "nothing to synthesize">\`

## Asking the owner a question

Some knowledge exists nowhere you can read it — only in the owner's head. The
commonest case is synthesis: you can see *that* two projects solved the same
problem differently, but the reason is not written down anywhere.

You may put a question to the owner. The bar is deliberately high, because the
asymmetry runs the wrong way: a question costs you nothing and costs them their
attention. Ask only when **both** hold:

- The answer cannot be derived from any wiki page, session log, or file you can read.
- Knowing it would **change what you write** — not merely add colour to it.

### A question never blocks

Write the page anyway. Where the missing knowledge would have gone, mark the gap
inline, on its own line:

\`\`\`markdown
> **Rationale unrecorded** — <the question, in full>
\`\`\`

That marker is what the answer replaces later, so phrase the question so it still
makes sense to a reader months from now.

### Recording the question

Append **one line of JSON** to \`.questions-inbox.jsonl\` in the wiki root — create
the file if it does not exist, and never rewrite or remove lines already in it:

\`\`\`json
{"question": "…", "page": "concepts/x.md", "why": "what you would write differently once you know"}
\`\`\`

Rules:
- At most **${MAX_PER_RUN} questions per run**. If you have more, keep the ones whose answers change the most.
- **Never re-ask.** Questions already put to the owner are listed in your prompt; a repeat, including one they declined to answer, teaches them to ignore the queue.
- Ask about **rationale and intent** — "why did X diverge from Y", "which constraint drove this". Never ask something you could find by reading.
- One question per line. Do not ask compound questions.

The owner answers at their convenience via \`clauth hive --questions\`; their
answers come back to you later as a separate ingest.

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

/** Claude Code stores a project's logs under the cwd with every `/` turned into `-`. */
export function sessionDirForCwd(configDir: string, cwd: string): string {
  return join(configDir, "projects", cwd.replace(/\//g, "-"));
}

/**
 * Find the log of the session that just ended.
 *
 * Scoped to the launch directory's own log folder: scanning every project meant
 * that any other Claude session running at the same time — its log being written
 * more recently — was picked instead, and its knowledge filed under the wrong
 * project. A newly created file also wins over a merely modified one, so a
 * concurrent session in the *same* project does not shadow the new one either.
 */
export async function detectNewSessionLog(
  configDir: string,
  before: Map<string, number>,
  cwd: string = process.cwd()
): Promise<string | null> {
  const scope = sessionDirForCwd(configDir, cwd) + sep;
  const after = await snapshotSessionFiles(configDir);

  let created: { path: string; mtime: number } | null = null;
  let modified: { path: string; mtime: number } | null = null;

  for (const [filePath, mtimeMs] of after) {
    if (!filePath.startsWith(scope)) continue;

    const prevMtime = before.get(filePath);
    if (prevMtime === undefined) {
      if (!created || mtimeMs > created.mtime) created = { path: filePath, mtime: mtimeMs };
    } else if (mtimeMs > prevMtime) {
      if (!modified || mtimeMs > modified.mtime) modified = { path: filePath, mtime: mtimeMs };
    }
  }

  return (created ?? modified)?.path ?? null;
}


// --- project name ---

export function getProjectName(): string {
  return basename(process.cwd());
}

// --- reset ---

export async function listHiveProjects(): Promise<string[]> {
  try {
    const entries = await readdir(join(HIVE_DIR, "projects"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export const HIVE_CATEGORIES = [
  "projects", "concepts", "clients", "company", "personal", "people",
] as const;
export type HiveCategory = typeof HIVE_CATEGORIES[number];

/** Categories stored as flat `<category>/<name>.md` files (everything but projects). */
export const FLAT_CATEGORIES = HIVE_CATEGORIES.filter((c) => c !== "projects");

export async function listHivePages(category: HiveCategory): Promise<string[]> {
  try {
    const entries = await readdir(join(HIVE_DIR, category), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Collapse the run of blank lines around `at` down to a single blank line.
 * Removing a block leaves the blank that preceded it adjacent to the blank that
 * followed it; without this the index accumulates blank lines on every reset.
 */
function collapseBlankRun(lines: string[], at: number): string[] {
  let start = at;
  while (start > 0 && lines[start - 1].trim() === "") start--;
  let end = at;
  while (end < lines.length && lines[end].trim() === "") end++;
  if (end > start) lines.splice(start, end - start, "");
  return lines;
}

/**
 * Drop a project's `### <name>` block from the Projects section of index.md.
 * The block runs from its `### ` heading to the next heading of equal or
 * higher level (`### ` or `## `), matching the index format in CLAUDE.md.
 */
function stripProjectFromIndex(index: string, project: string): string {
  const lines = index.split("\n");
  const start = lines.findIndex((l) => l.trim() === `### ${project}`);
  if (start === -1) return index;

  let end = start + 1;
  while (end < lines.length && !/^#{2,3} /.test(lines[end])) end++;

  lines.splice(start, end - start);
  return tidyIndex(lines, start).join("\n");
}

/** Placeholders the scaffolded index uses for an empty section. */
const EMPTY_SECTION: Record<string, string> = {
  Projects: "(No projects yet)",
  Concepts: "(No concepts yet)",
  Clients: "(No clients yet)",
  Company: "(No company knowledge yet)",
  Personal: "(No personal knowledge yet)",
  People: "(No people yet)",
};

/**
 * Restore the `(No … yet)` placeholder if removing an entry emptied a section,
 * so a reset-to-empty index matches what ensureHiveDir() would have scaffolded.
 */
function restoreEmptySection(lines: string[], at: number): boolean {
  // After the splice, lines[at] may be the *next* section's heading (the removed
  // entry was the last thing in its section). Step back so the scan finds the
  // heading the entry belonged to, not the one that followed it.
  let head = /^## /.test(lines[at] ?? "") ? at - 1 : at;
  while (head >= 0 && !/^## /.test(lines[head] ?? "")) head--;
  if (head < 0) return false;

  const title = lines[head].replace(/^##\s+/, "").trim();
  const placeholder = EMPTY_SECTION[title];
  if (!placeholder) return false;

  let end = head + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  if (lines.slice(head + 1, end).some((l) => l.trim() !== "")) return false;

  lines.splice(head + 1, end - (head + 1), "", placeholder, "");
  return true;
}

/**
 * Tidy the seam left by removing an entry at `at`. Restoring an emptied
 * section must be tried first: collapsing shifts the array, which would push
 * `at` into the following section and check the wrong one for emptiness.
 */
function tidyIndex(lines: string[], at: number): string[] {
  if (restoreEmptySection(lines, at)) return lines;
  return collapseBlankRun(lines, at);
}

/**
 * Drop a flat page's bullet from index.md. Entries look like
 * `- [Title](clients/name.md) — summary`, so match on the link target rather
 * than the title, which is free-form and need not match the filename.
 */
function stripPageFromIndex(index: string, relPath: string): string {
  const lines = index.split("\n");
  const target = `(${relPath})`;
  const at = lines.findIndex((l) => l.trimStart().startsWith("- ") && l.includes(target));
  if (at === -1) return index;

  lines.splice(at, 1);
  return tidyIndex(lines, at).join("\n");
}

async function appendLogEntry(entry: string): Promise<void> {
  const logPath = join(HIVE_DIR, "log.md");
  try {
    const current = await readFile(logPath, "utf8");
    await writeFile(logPath, `${current.replace(/\n*$/, "")}\n\n${entry}\n`);
  } catch {
    await writeFile(logPath, `${LOG_CONTENT.replace(/\n*$/, "")}\n\n${entry}\n`);
  }
}

/**
 * Resolve a project directory, refusing anything that escapes projects/.
 * This is reachable from the local HTTP API, so a name like "../.." must not
 * be able to turn a project reset into a wipe of the whole wiki (or worse).
 */
function resolveProjectDir(project: string): string {
  const projectsRoot = resolve(HIVE_DIR, "projects");
  const dir = resolve(projectsRoot, project);
  if (dir !== projectsRoot && !dir.startsWith(projectsRoot + sep)) {
    throw new Error(`invalid project name: ${project}`);
  }
  if (dir === projectsRoot) throw new Error("project name is required");
  return dir;
}

/**
 * Remove one project's pages and its index entry. The log is append-only per
 * the wiki schema, so the reset is recorded rather than scrubbed from history.
 */
export async function resetHiveProject(project: string, today: string): Promise<void> {
  const dir = resolveProjectDir(project);
  await rm(dir, { recursive: true, force: true });

  const indexPath = join(HIVE_DIR, "index.md");
  try {
    const index = await readFile(indexPath, "utf8");
    await writeFile(indexPath, stripProjectFromIndex(index, project));
  } catch {
    // No index yet — nothing to strip.
  }

  await appendLogEntry(
    `## [${today}] reset | project | ${project}\nRemoved projects/${project}/ and its index entry.`,
  );
}

/**
 * Remove a single flat page (clients/people/concepts/company/personal) and its
 * index bullet. Same containment guard as projects — this is HTTP-reachable.
 */
export async function resetHivePage(
  category: HiveCategory,
  name: string,
  today: string,
): Promise<void> {
  if (!FLAT_CATEGORIES.includes(category as (typeof FLAT_CATEGORIES)[number])) {
    throw new Error(`invalid category: ${category}`);
  }

  const categoryRoot = resolve(HIVE_DIR, category);
  const file = resolve(categoryRoot, `${name}.md`);
  if (!file.startsWith(categoryRoot + sep)) {
    throw new Error(`invalid page name: ${name}`);
  }

  await rm(file, { force: true });

  const relPath = `${category}/${name}.md`;
  const indexPath = join(HIVE_DIR, "index.md");
  try {
    const index = await readFile(indexPath, "utf8");
    await writeFile(indexPath, stripPageFromIndex(index, relPath));
  } catch {
    // No index yet — nothing to strip.
  }

  await appendLogEntry(
    `## [${today}] reset | page | ${relPath}\nRemoved ${relPath} and its index entry.`,
  );
}

/** Delete the entire wiki and rescaffold an empty one. */
export async function resetHiveAll(): Promise<void> {
  await rm(HIVE_DIR, { recursive: true, force: true });
  await ensureHiveDir();
}

// --- hive operations ---

export interface HiveAnalysisResult {
  summary: string | null;
  error: string | null;
  /** Questions this run put to the owner. Empty unless it hit a gap only they can close. */
  questions: Question[];
}

/**
 * Where a run drops the questions it wants to ask. A file the analyzer appends
 * to, rather than the queue itself: the queue is shared state with its own
 * write discipline, and an LLM rewriting it wholesale could lose answers that
 * are already in it. Lines are drained into the real queue after the run.
 *
 * Inside the wiki because that is the only directory the analyzer can write to.
 * Dot-prefixed so it stays out of the wiki proper — Obsidian and the link check
 * both skip it.
 */
const QUESTION_INBOX = join(HIVE_DIR, ".questions-inbox.jsonl");

/**
 * Read and clear the inbox. Tolerant on purpose: a malformed line is skipped
 * rather than failing the drain, and a whole-file JSON array is accepted too,
 * since that is the shape a model most often writes when told "JSON".
 */
async function drainQuestionInbox(): Promise<QuestionDraft[]> {
  let raw: string;
  try {
    raw = await readFile(QUESTION_INBOX, "utf8");
  } catch {
    return [];
  }
  await unlink(QUESTION_INBOX).catch(() => {});

  const drafts: QuestionDraft[] = [];
  const take = (value: unknown) => {
    if (value && typeof value === "object" && typeof (value as QuestionDraft).question === "string") {
      drafts.push(value as QuestionDraft);
    }
  };

  try {
    const whole = JSON.parse(raw);
    (Array.isArray(whole) ? whole : [whole]).forEach(take);
    return drafts;
  } catch {
    // Not a single JSON document — the expected case, one object per line.
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      take(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return drafts;
}

/**
 * Tell a knowledge-writing run how to ask, and what has already been asked.
 * The rules live in the wiki's CLAUDE.md; this carries the two things that
 * cannot be written there — the absolute inbox path and the current queue.
 */
async function questionInstruction(): Promise<string> {
  const asked = await askedQuestionTexts();
  const parts = [
    `If you hit knowledge that exists only in the owner's head, follow the schema's "Asking the owner a question" section: write the page with the gap marked, and append one JSON line per question to ${QUESTION_INBOX}. Never block on a question, and never guess a rationale instead of asking.`,
  ];
  if (asked.length > 0) {
    parts.push(
      `Already put to the owner — do NOT ask these again, in any wording: ${asked.map((q) => `"${q}"`).join("; ")}.`
    );
  }
  return parts.join(" ");
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

/**
 * Run one headless claude session against the wiki, then collect any questions
 * it left in the inbox. Every operation drains the inbox, not just the ones told
 * how to ask — the rule lives in the wiki's schema, so any run can reach it, and
 * a question left behind would otherwise be credited to whichever run came next.
 */
async function spawnHiveSession(
  prompt: string,
  extraAddDirs: string[],
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent,
  source = "hive"
): Promise<HiveAnalysisResult> {
  const result = await runClaudeSession(prompt, extraAddDirs, claudeConfigDir, profileName, onEvent);
  const questions = await addQuestions(await drainQuestionInbox(), source);
  return { ...result, questions };
}

function runClaudeSession(
  prompt: string,
  extraAddDirs: string[],
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<{ summary: string | null; error: string | null }> {
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

/**
 * A provenance line identifying where an ingest's knowledge came from, so a
 * claim can later be traced to its origin. The session id is the log's own file
 * name — stable, and the log stays on disk to be re-read if a claim turns out wrong.
 */
function provenanceLine(
  source:
    | { kind: "session"; ref: string }
    | { kind: "file"; ref: string }
    | { kind: "manual" }
    | { kind: "synthesis" }
    | { kind: "answer" }
): string {
  const today = new Date().toISOString().slice(0, 10);
  const what =
    source.kind === "session" ? `session ${source.ref}`
    : source.kind === "file" ? `file ${source.ref}`
    : source.kind === "synthesis" ? "synthesis"
    : source.kind === "answer" ? "answered question"
    : "manual input";
  return `${today} · ${what}`;
}

/** Instruction appended to every knowledge-writing ingest so pages record their origin. */
function provenanceInstruction(line: string): string {
  return `Provenance: the source of this ingest is "${line}". Per the schema's Sources rule, add this exact line to the ## Sources section of every page you create or modify, and never remove source lines already there.`;
}

export async function runHiveAnalysis(
  logPath: string,
  projectName: string,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const sessionId = basename(logPath).replace(/\.jsonl$/, "");
  const prompt = [
    `Analyze the Claude Code session log at ${logPath} for project "${projectName}".`,
    `Extract knowledge and upsert into the wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Read the session log from disk. Focus on decisions, problems, tradeoffs, architecture, and context.`,
    `Skip trivial operations and raw tool outputs.`,
    provenanceInstruction(provenanceLine({ kind: "session", ref: sessionId })),
    await questionInstruction(),
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [dirname(logPath)], claudeConfigDir, profileName, onEvent, "session");
}

export async function runHiveManual(
  userPrompt: string,
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const prompt = [
    `You are maintaining the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `Process the following input and upsert accordingly:`,
    userPrompt,
    provenanceInstruction(provenanceLine({ kind: "manual" })),
    await questionInstruction(),
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent, "manual");
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

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent, "query");
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

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent, "lint");
}

// --- session listing (for the picker) ---

export interface SessionSummary {
  logPath: string;
  project: string;
  profile: string;
  modifiedAt: Date;
  slug: string | null;
  firstPrompt: string | null;
}

/**
 * Only the head of a log is read — session files reach megabytes, while the slug
 * and first prompt both sit near the top. The picker reads this for every listed
 * session, so the window is kept modest.
 */
const SESSION_HEAD_BYTES = 200_000;

async function readHead(path: string): Promise<string | null> {
  try {
    const handle = await open(path, "r");
    const buf = Buffer.alloc(SESSION_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SESSION_HEAD_BYTES, 0);
    await handle.close();
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A human label for a session: Claude Code's own slug when present, plus the
 * first real user message. Harness noise (`[Request interrupted…]`, tool
 * results, slash commands) is skipped — those are never what the session was about.
 */
async function describeSession(
  logPath: string
): Promise<{ slug: string | null; firstPrompt: string | null }> {
  const head = await readHead(logPath);
  if (head === null) return { slug: null, firstPrompt: null };

  let slug: string | null = null;
  let firstPrompt: string | null = null;

  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // truncated final line of the head slice
    }

    if (!slug && typeof d.slug === "string") slug = d.slug;
    if (firstPrompt || d.type !== "user" || d.isMeta) continue;

    const content = d?.message?.content;
    const texts: string[] =
      typeof content === "string"
        ? [content]
        : Array.isArray(content)
          ? content.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? ""))
          : [];

    for (const raw of texts) {
      const text = raw.trim();
      if (!text || text.startsWith("[") || text.startsWith("<") || text.startsWith("/")) continue;
      firstPrompt = text.replace(/\s+/g, " ").slice(0, 70);
      break;
    }
  }

  return { slug, firstPrompt };
}

/** Most recent sessions across the given profiles, newest first. */
/**
 * Recent sessions for the current directory only — the same scoping the
 * post-session queue uses. Restricting to this project's own log folder means
 * the project is `basename(cwd)` with certainty, so nothing has to be recovered
 * from a log's `cwd` (which the picker can't do reliably: the folder encoding
 * replaces every `/` with `-`, losing dashes in names like dijji-ai).
 */
export async function listRecentSessions(
  profiles: { name: string; configDir: string }[],
  limit: number,
  cwd: string = process.cwd()
): Promise<SessionSummary[]> {
  const project = basename(cwd);
  const found: { logPath: string; profile: string; mtime: number }[] = [];

  for (const profile of profiles) {
    const scope = sessionDirForCwd(profile.configDir, cwd) + sep;
    for (const [logPath, mtime] of await snapshotSessionFiles(profile.configDir)) {
      if (logPath.startsWith(scope)) found.push({ logPath, profile: profile.name, mtime });
    }
  }

  found.sort((a, b) => b.mtime - a.mtime);

  const out: SessionSummary[] = [];
  for (const entry of found.slice(0, limit)) {
    const { slug, firstPrompt } = await describeSession(entry.logPath);
    out.push({
      logPath: entry.logPath,
      project,
      profile: entry.profile,
      modifiedAt: new Date(entry.mtime),
      slug,
      firstPrompt,
    });
  }
  return out;
}

// --- link graph ---

export interface LinkReport {
  pages: number;
  /** Links whose target does not exist — always a defect. */
  broken: { from: string; to: string }[];
  /**
   * A links to B across a category or project boundary, but B does not link back.
   * Links within one project are excluded — the schema asks for bidirectional
   * links between *related entities*, not for every internal navigation link.
   */
  oneWay: { from: string; to: string }[];
  /** Pages nothing links to. Reachable only by knowing they exist. */
  orphans: string[];
}

/** Every content page, wiki-relative. CLAUDE.md/index.md/log.md are not pages. */
async function listContentPages(): Promise<string[]> {
  const out: string[] = [];
  for (const category of HIVE_CATEGORIES) {
    const root = join(HIVE_DIR, category);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) out.push(`${category}/${entry.name}`);
      else if (entry.isDirectory()) {
        try {
          for (const file of await readdir(join(root, entry.name))) {
            if (file.endsWith(".md")) out.push(`${category}/${entry.name}/${file}`);
          }
        } catch {
          continue;
        }
      }
    }
  }
  return out.sort();
}

/**
 * Check the wiki's link graph — deterministic, no LLM.
 *
 * Moving or deleting a page silently breaks every link into it, and the damage
 * is invisible until someone follows one. `--lint` can find this too, but it
 * costs a model call and its answer is not reproducible; this is cheap enough to
 * run after any edit. It also measures how often links run in only one
 * direction, which is the signal for whether the schema's cross-linking step is
 * actually being followed.
 */
export async function analyzeLinks(): Promise<LinkReport> {
  const pages = await listContentPages();
  const known = new Set(pages);
  const outbound = new Map<string, Set<string>>();

  for (const page of pages) {
    const content = await readPage(join(HIVE_DIR, page));
    const targets = new Set<string>();
    if (content !== null) {
      for (const m of content.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        const raw = m[1];
        if (/^[a-z]+:\/\//i.test(raw)) continue;
        // Resolve relative to the linking page, then express wiki-relative again.
        const abs = resolve(HIVE_DIR, dirname(page), raw);
        targets.add(relative(HIVE_DIR, abs).split(sep).join("/"));
      }
    }
    outbound.set(page, targets);
  }

  /** The unit a backlink is expected across: a whole project, or a flat category. */
  const group = (page: string) => page.split("/").slice(0, page.startsWith("projects/") ? 2 : 1).join("/");

  const broken: { from: string; to: string }[] = [];
  const oneWay: { from: string; to: string }[] = [];
  const linkedTo = new Set<string>();

  for (const [page, targets] of outbound) {
    for (const target of targets) {
      if (!known.has(target)) {
        broken.push({ from: page, to: target });
        continue;
      }
      linkedTo.add(target);
      if (group(page) === group(target)) continue; // internal navigation, not a relationship
      if (!outbound.get(target)?.has(page)) oneWay.push({ from: page, to: target });
    }
  }

  return {
    pages: pages.length,
    broken,
    oneWay,
    orphans: pages.filter((p) => !linkedTo.has(p)),
  };
}

// --- launch-time nudges ---

/** Something worth the user's attention, and the command that acts on it. */
export interface HiveNudge {
  reason: string;
  command: string;
}

/**
 * What the wiki needs, computed at launch.
 *
 * The launch banner is the only surface every user sees every time, so anything
 * that needs a human has to arrive there. The alternative is what clauth had
 * before: maintenance commands that only ever run if you happen to remember
 * they exist — which, for a wiki you never open, means never. Both checks are
 * deterministic file reads; neither costs an LLM call.
 */
export async function getHiveNudges(): Promise<HiveNudge[]> {
  const projects = await listHiveProjects();
  if (projects.length === 0) return [];

  const nudges: HiveNudge[] = [];

  // Cross-project knowledge is the wiki's whole point, and nothing else tells
  // you the threshold has been crossed. Silent once concepts/ has anything —
  // a nudge that never stops is a nudge you stop reading.
  if (projects.length >= 2 && (await listHivePages("concepts")).length === 0) {
    nudges.push({
      reason: `${projects.length} projects, concepts/ still empty`,
      command: "clauth hive --synthesize",
    });
  }

  // Pages get moved, split and consolidated by the analyzer in the background,
  // and a link left pointing at nothing is invisible from every direction.
  const { broken } = await analyzeLinks();
  if (broken.length > 0) {
    nudges.push({
      reason: broken.length === 1
        ? "1 link points at a page that is gone"
        : `${broken.length} links point at pages that are gone`,
      command: "clauth hive --lint",
    });
  }

  return nudges;
}

export interface HiveSynthesisResult extends HiveAnalysisResult {
  /** concepts/ pages after the run, each with the distinct projects it links to. */
  concepts: { page: string; projects: string[] }[];
  /** Concept pages citing fewer than two real projects — a violation of the synthesis rule. */
  underCited: string[];
  backupDir: string;
}

/** Distinct project names a page links into (`projects/<name>/...`). */
function projectsLinkedFrom(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    const mm = target.match(/^projects\/([^/]+)\//);
    if (mm) out.add(mm[1]);
  }
  return [...out];
}

/**
 * Fill concepts/ with cross-project knowledge.
 *
 * Backs the wiki up first (it edits pages, and the wiki is not version-controlled),
 * then verifies in code the one rule that must hold: every concept page cites at
 * least two *existing* projects. The LLM is told this, but "involves two projects"
 * is exactly the claim it is most tempted to fudge to fill the section, so it is
 * checked rather than trusted.
 */
export async function runHiveSynthesize(
  claudeConfigDir: string,
  profileName: string,
  stamp: string,
  onEvent?: HiveOnEvent
): Promise<HiveSynthesisResult> {
  const backupDir = join(BACKUP_DIR, stamp);
  await mkdir(BACKUP_DIR, { recursive: true });
  await cp(HIVE_DIR, backupDir, { recursive: true });
  await pruneBackups();

  const prompt = [
    `You are synthesizing cross-project knowledge in the wiki at ${HIVE_DIR}/.`,
    `Read CLAUDE.md there first — follow the "Synthesize" operation exactly.`,
    `Find patterns that genuinely recur across two or more projects and write them as concepts/ pages, citing the project pages as evidence.`,
    `Every concept page MUST link to at least two existing project pages; this is verified in code afterwards and violations are reported.`,
    `Do not invent patterns to fill the section — if nothing recurs, write nothing.`,
    `Where two projects clearly diverged but the reason is written down nowhere, that reason is the knowledge worth having and only the owner has it: write the page with the gap marked and ask, per the schema. Never guess a rationale.`,
    provenanceInstruction(provenanceLine({ kind: "synthesis" })),
    await questionInstruction(),
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  const result = await spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent, "synthesis");

  const projects = new Set(await listHiveProjects());
  const concepts: { page: string; projects: string[] }[] = [];
  for (const name of await listHivePages("concepts")) {
    const content = await readPage(join(HIVE_DIR, "concepts", `${name}.md`));
    if (content === null) continue;
    const cited = projectsLinkedFrom(content).filter((p) => projects.has(p));
    concepts.push({ page: `concepts/${name}.md`, projects: cited });
  }
  const underCited = concepts.filter((c) => c.projects.length < 2).map((c) => c.page);

  return { ...result, concepts, underCited, backupDir };
}

export async function runHiveFileIngest(
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
  parts.push(provenanceInstruction(provenanceLine({ kind: "file", ref: basename(filePath) })));
  parts.push(await questionInstruction());
  parts.push(`When done, print a HIVE_SUMMARY line as described in the schema.`);

  return spawnHiveSession(parts.join(" "), [dirname(filePath)], claudeConfigDir, profileName, onEvent, "file");
}

/**
 * Fold the owner's answers back into the wiki.
 *
 * Batched into a single run on purpose: each run re-reads the schema and the
 * pages it touches, so answering five questions one at a time costs five times
 * as much for the same edit. Answers arrive as knowledge, not as a transcript —
 * the question was scaffolding for getting it, and does not belong on the page.
 */
export function runHiveAnswers(
  answered: Question[],
  claudeConfigDir: string,
  profileName: string,
  onEvent?: HiveOnEvent
): Promise<HiveAnalysisResult> {
  const items = answered.map((q, i) =>
    [
      `${i + 1}. page: ${q.page ?? "(not recorded — find where it belongs)"}`,
      `   question asked: ${q.question}`,
      `   owner's answer: ${q.answer ?? ""}`,
    ].join("\n")
  );

  const prompt = [
    `You are maintaining the knowledge wiki at ${HIVE_DIR}/ following the schema in CLAUDE.md.`,
    `The owner has answered questions the wiki previously recorded as unanswered. Fold each answer into the wiki:`,
    `On the named page, find the gap marker (a line beginning "> **Rationale unrecorded**") that matches the question and REPLACE it with the knowledge the answer gives, written as prose in the page's own voice.`,
    `Write it as established knowledge — do not quote the question, do not write "the owner said", and do not leave the marker in place.`,
    `If the marker is no longer there, or no page was recorded, work out where the knowledge belongs and add it there.`,
    `Treat the answer as authoritative: where it contradicts what a page claims, correct the page and note what changed.`,
    `Update index.md if a page's scope changed, and append a log entry.`,
    provenanceInstruction(provenanceLine({ kind: "answer" })),
    `Here are the answered questions:\n${items.join("\n")}`,
    `When done, print a HIVE_SUMMARY line as described in the schema.`,
  ].join(" ");

  return spawnHiveSession(prompt, [], claudeConfigDir, profileName, onEvent, "answers");
}

// --- cross-session context injection ---

/**
 * The map is injected into every session, so it must stay bounded no matter how
 * large the wiki grows. Page bodies are never injected — the agent reads them on
 * demand with Read/Grep, which is why these lines are pointers, not summaries.
 */
const SUMMARY_MAX = 100;
const MAP_MAX_CHARS = 4000;

function firstProseLine(body: string): string | null {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("---") || t.startsWith("|")) continue;
    // Require whitespace after the bullet so `**Bold` is not mistaken for a list item.
    return t.replace(/^[-*+]\s+/, "");
  }
  return null;
}

/** Strip inline markdown so a pointer line reads as plain text. */
function plainText(s: string): string {
  return s
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A page's map line. Prefers the `summary` frontmatter field; pages written
 * before that field existed fall back to their first prose line, then the title,
 * so the map degrades gracefully instead of going blank during migration.
 */
function pageSummary(content: string): string {
  const fm = content.startsWith("---") ? content.slice(3, content.indexOf("\n---", 3)) : "";
  const field = (name: string): string | null => {
    const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  };

  const body = content.replace(/^---[\s\S]*?\n---\n?/, "");
  const flat = plainText(field("summary") ?? firstProseLine(body) ?? field("title") ?? "");
  if (flat.length <= SUMMARY_MAX) return flat;

  // Cut at a word boundary and drop dangling punctuation, so a truncated
  // fallback doesn't read as a sentence that was going somewhere.
  const cut = flat.slice(0, SUMMARY_MAX - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > SUMMARY_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, "")}…`;
}

/** Wiki-relative targets of markdown links, e.g. `../clients/mmi.md` → `clients/mmi.md`. */
function linkedEntities(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = m[1].replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    const category = target.split("/")[0];
    if (FLAT_CATEGORIES.includes(category as (typeof FLAT_CATEGORIES)[number])) out.push(target);
  }
  return out;
}

/** Does this page link into the given project? Matches any page or anchor within it. */
function linksToProject(content: string, projectName: string): boolean {
  for (const m of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    if (target.startsWith(`projects/${projectName}/`)) return true;
  }
  return false;
}

async function readPage(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Build the knowledge map injected at session start: the current project page by
 * page, the client/people pages its own pages link to, and every other project as
 * a single line. Derived from frontmatter rather than index.md — index.md is
 * LLM-maintained prose and has no size guarantee, whereas this must fit a budget.
 */
export async function buildProjectContext(projectName: string): Promise<string | null> {
  const projects = await listHiveProjects();
  const projectDir = join(HIVE_DIR, "projects", projectName);

  let files: string[] = [];
  try {
    files = (await readdir(projectDir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    // Unknown project — the map is still useful for what else exists.
  }

  const lines: string[] = [];
  const related = new Set<string>();

  if (files.length > 0) {
    lines.push(`## This project: ${projectName} (${files.length} pages)`);
    for (const file of files) {
      const content = await readPage(join(projectDir, file));
      if (content === null) continue;
      lines.push(`- projects/${projectName}/${file} — ${pageSummary(content)}`);
      for (const target of linkedEntities(content)) related.add(target);
    }
    lines.push("");
  }

  // Also collect entities that link *to* this project. In practice the wiki's
  // links run overwhelmingly in that direction — a client page names the
  // projects it owns, while the project page rarely names the client — so
  // reading only outward links misses nearly every relationship that exists.
  for (const category of FLAT_CATEGORIES) {
    for (const name of await listHivePages(category)) {
      const rel = `${category}/${name}.md`;
      if (related.has(rel)) continue;
      const content = await readPage(join(HIVE_DIR, rel));
      if (content === null) continue;
      if (linksToProject(content, projectName)) related.add(rel);
    }
  }

  if (related.size > 0) {
    const entries: string[] = [];
    for (const target of [...related].sort()) {
      const content = await readPage(join(HIVE_DIR, target));
      if (content === null) continue; // linked page was deleted; skip rather than point at nothing
      entries.push(`- ${target} — ${pageSummary(content)}`);
    }
    if (entries.length > 0) {
      lines.push("## Related people and clients", ...entries, "");
    }
  }

  const others = projects.filter((p) => p !== projectName);
  if (others.length > 0) {
    lines.push("## Other projects");
    for (const other of others) {
      const content =
        (await readPage(join(HIVE_DIR, "projects", other, "context.md"))) ??
        (await readPage(join(HIVE_DIR, "projects", other, "architecture.md")));
      const summary = content ? ` — ${pageSummary(content)}` : "";
      lines.push(`- projects/${other}/${summary}`);
    }
    lines.push("");
  }

  if (lines.length === 0) return null;

  let body = lines.join("\n").trimEnd();
  if (body.length > MAP_MAX_CHARS) {
    body = `${body.slice(0, MAP_MAX_CHARS)}\n… map truncated; list the wiki directory for the rest.`;
  }

  return [
    `# Hive Mind — knowledge map`,
    "",
    `Accumulated knowledge from previous sessions lives at ${HIVE_DIR}/ as markdown files.`,
    `The lines below are pointers, not summaries — they say what kind of knowledge each`,
    `page holds, not what it says. Open the relevant page with Read (or Grep across the`,
    `wiki) before relying on prior context or repeating a decision. Do not assume a page's`,
    `contents from its pointer.`,
    "",
    body,
  ].join("\n");
}
