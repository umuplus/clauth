import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  getHiveDir,
  runHiveManual,
  runHiveQuery,
  runHiveLint,
  runHiveFileIngest,
  listHiveProjects,
  listHivePages,
  resetHiveProject,
  resetHivePage,
  resetHiveAll,
  FLAT_CATEGORIES,
  type HiveCategory,
  type HiveStreamEvent,
  type HiveAnalysisResult,
} from "../../hive.js";
import {
  readQueue,
  readRunning,
  retryFailed,
  clearFailed,
  spawnQueueWorker,
} from "../../hive-queue.js";
import {
  readQuestions,
  openQuestions,
  unappliedAnswers,
  answerQuestion,
  dismissQuestion,
  dismissAllOpen,
} from "../../hive-questions.js";
import {
  getClaudeConfigDir,
  getFolderProfile,
  getLastUsed,
} from "../../profiles.js";

export const hiveRoutes = new Hono();

const CATEGORIES = ["projects", "concepts", "clients", "company", "personal", "people"] as const;
type Category = typeof CATEGORIES[number];

async function resolveProfile(): Promise<{ name: string; dir: string } | null> {
  const folder = await getFolderProfile();
  const name = folder ?? (await getLastUsed());
  if (!name) return null;
  return { name, dir: getClaudeConfigDir(name) };
}

// --- content endpoints (no LLM) ---

hiveRoutes.get("/index", async (c) => {
  try {
    const content = await readFile(join(getHiveDir(), "index.md"), "utf8");
    return c.json({ content });
  } catch {
    return c.json({ content: null });
  }
});

hiveRoutes.get("/log", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10) || 50;
  try {
    const content = await readFile(join(getHiveDir(), "log.md"), "utf8");
    const entries: { date: string; type: string; details: string; body: string[] }[] = [];
    const lines = content.split("\n");
    let current: typeof entries[number] | null = null;
    for (const line of lines) {
      const match = line.match(/^## \[(\d{4}-\d{2}-\d{2})\] (.+?)$/);
      if (match) {
        if (current) entries.push(current);
        current = { date: match[1], type: match[2], details: match[2], body: [] };
      } else if (current && line.trim()) {
        current.body.push(line);
      }
    }
    if (current) entries.push(current);
    return c.json({ entries: entries.slice(-limit).reverse() });
  } catch {
    return c.json({ entries: [] });
  }
});

hiveRoutes.get("/pages", async (c) => {
  const pages: { category: Category; path: string; name: string }[] = [];

  for (const category of CATEGORIES) {
    const dir = join(getHiveDir(), category);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // projects/<project-name>/<page>.md
          const subdir = join(dir, entry.name);
          try {
            const files = await readdir(subdir);
            for (const file of files) {
              if (file.endsWith(".md")) {
                pages.push({
                  category,
                  path: `${category}/${entry.name}/${file}`,
                  name: `${entry.name}/${file.replace(".md", "")}`,
                });
              }
            }
          } catch {
            continue;
          }
        } else if (entry.name.endsWith(".md")) {
          pages.push({
            category,
            path: `${category}/${entry.name}`,
            name: entry.name.replace(".md", ""),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return c.json({ pages });
});

hiveRoutes.get("/page/:path{.+}", async (c) => {
  const path = c.req.param("path");
  if (!path) return c.json({ error: "path required" }, 400);

  // Security: confine to hive dir
  const fullPath = resolve(getHiveDir(), path);
  if (!fullPath.startsWith(resolve(getHiveDir()) + "/")) {
    return c.json({ error: "path outside hive" }, 400);
  }

  try {
    const content = await readFile(fullPath, "utf8");
    const st = await stat(fullPath);
    return c.json({ path, content, size: st.size, updated: st.mtime.toISOString() });
  } catch {
    return c.json({ error: "page not found" }, 404);
  }
});

// --- analysis queue ---

hiveRoutes.get("/queue", async (c) => {
  const [state, running] = await Promise.all([readQueue(), readRunning()]);
  return c.json({ ...state, running });
});

hiveRoutes.post("/queue/retry-failed", async (c) => {
  return c.json({ requeued: await retryFailed() });
});

hiveRoutes.post("/queue/clear-failed", async (c) => {
  return c.json({ dropped: await clearFailed() });
});

// --- questions the wiki has for the owner ---
//
// The same queue `clauth hive --questions` walks. Answering here writes the
// answer to the same file and starts the same background worker, so the two
// front ends stay interchangeable — answer some in the terminal, the rest here.

hiveRoutes.get("/questions", async (c) => {
  const state = await readQuestions();
  return c.json({
    open: openQuestions(state),
    answered: unappliedAnswers(state),
    running: await readRunning(),
  });
});

hiveRoutes.post("/questions/dismiss-all", async (c) => {
  return c.json({ dismissed: await dismissAllOpen() });
});

/**
 * Fold the answers already given into the wiki. Separate from answering so the
 * owner can work through several questions and pay for one analyzer pass, which
 * is what the terminal loop does at the end of its run.
 */
hiveRoutes.post("/questions/apply", async (c) => {
  const state = await readQuestions();
  const waiting = unappliedAnswers(state).length;
  if (waiting === 0) return c.json({ started: false, waiting: 0, running: null });

  // Read the lock before spawning, or the worker we are about to start is
  // itself the "analysis in progress" this reports.
  const running = await readRunning();
  spawnQueueWorker();
  return c.json({ started: true, waiting, running });
});

hiveRoutes.post("/questions/:id/answer", async (c) => {
  const id = c.req.param("id");
  let answer: unknown;
  try {
    ({ answer } = await c.req.json<{ answer?: unknown }>());
  } catch {
    answer = undefined;
  }
  if (typeof answer !== "string" || !answer.trim()) {
    return c.json({ error: "answer is required" }, 400);
  }

  const state = await readQuestions();
  if (!state.questions.some((q) => q.id === id)) {
    return c.json({ error: `no question "${id}"` }, 404);
  }

  await answerQuestion(id, answer);
  return c.json({ answered: id });
});

hiveRoutes.post("/questions/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const state = await readQuestions();
  if (!state.questions.some((q) => q.id === id)) {
    return c.json({ error: `no question "${id}"` }, 404);
  }

  await dismissQuestion(id);
  return c.json({ dismissed: id });
});

// --- reset endpoints (destructive, no LLM) ---

hiveRoutes.get("/projects", async (c) => {
  return c.json({ projects: await listHiveProjects() });
});

hiveRoutes.delete("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const projects = await listHiveProjects();
  if (!projects.includes(name)) {
    return c.json({ error: `no hive knowledge for project "${name}"`, projects }, 404);
  }

  try {
    await resetHiveProject(name, new Date().toISOString().slice(0, 10));
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
  return c.json({ reset: name });
});

hiveRoutes.delete("/pages/:category/:name", async (c) => {
  const category = c.req.param("category");
  const name = c.req.param("name").replace(/\.md$/, "");

  if (!FLAT_CATEGORIES.includes(category as (typeof FLAT_CATEGORIES)[number])) {
    return c.json({ error: `invalid category "${category}"`, categories: FLAT_CATEGORIES }, 400);
  }
  const cat = category as HiveCategory;

  const pages = await listHivePages(cat);
  if (!pages.includes(name)) {
    return c.json({ error: `no page "${name}" in ${category}`, pages }, 404);
  }

  try {
    await resetHivePage(cat, name, new Date().toISOString().slice(0, 10));
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
  return c.json({ reset: `${category}/${name}` });
});

// Full wipe. The body confirmation is deliberate friction: a stray DELETE to
// this path should not be able to destroy the whole wiki.
hiveRoutes.delete("/", async (c) => {
  let confirm: unknown;
  try {
    ({ confirm } = await c.req.json<{ confirm?: unknown }>());
  } catch {
    confirm = undefined;
  }
  if (confirm !== "RESET") {
    return c.json({ error: 'full reset requires {"confirm":"RESET"}' }, 400);
  }

  await resetHiveAll();
  return c.json({ reset: "all" });
});

// --- LLM-backed endpoints (SSE streaming) ---

async function streamRun(
  c: Context,
  run: (onEvent: (e: HiveStreamEvent) => void) => Promise<HiveAnalysisResult>
) {
  return streamSSE(c, async (stream) => {
    const queue: HiveStreamEvent[] = [];
    let waiter: (() => void) | null = null;
    let finished = false;

    const onEvent = (e: HiveStreamEvent) => {
      queue.push(e);
      waiter?.();
      waiter = null;
    };

    const runPromise = run(onEvent).finally(() => {
      finished = true;
      waiter?.();
      waiter = null;
    });

    while (true) {
      while (queue.length > 0) {
        const e = queue.shift()!;
        await stream.writeSSE({ event: "progress", data: JSON.stringify(e) });
      }
      if (finished) break;
      await new Promise<void>((r) => { waiter = r; });
    }

    const result = await runPromise;
    await stream.writeSSE({ event: "done", data: JSON.stringify(result) });
  });
}

hiveRoutes.post("/feed", async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt || typeof prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }

  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found; run clauth launch <name> first" }, 400);
  }

  return streamRun(c, (onEvent) =>
    runHiveManual(prompt, profile.dir, profile.name, onEvent)
  );
});

hiveRoutes.post("/query", async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt || typeof prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }

  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found" }, 400);
  }

  return streamRun(c, (onEvent) =>
    runHiveQuery(prompt, profile.dir, profile.name, onEvent)
  );
});

hiveRoutes.post("/lint", async (c) => {
  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found" }, 400);
  }

  return streamRun(c, (onEvent) =>
    runHiveLint(profile.dir, profile.name, onEvent)
  );
});

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

hiveRoutes.post("/file", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const focus = typeof body.focus === "string" ? body.focus : undefined;

  if (!(file instanceof File)) {
    return c.json({ error: "file upload required" }, 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` }, 413);
  }

  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found" }, 400);
  }

  // Write uploaded file to temp location so the LLM can read from disk
  const tmpDir = join(tmpdir(), "clauth-hive-uploads");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, file.name);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(tmpPath, buf);

  return streamRun(c, (onEvent) =>
    runHiveFileIngest(tmpPath, focus, profile.dir, profile.name, onEvent)
  );
});
