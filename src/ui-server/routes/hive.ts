import { Hono } from "hono";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  getHiveDir,
  runHiveManual,
  runHiveQuery,
  runHiveLint,
  runHiveFileIngest,
} from "../../hive.js";
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

// --- LLM-backed endpoints ---

hiveRoutes.post("/feed", async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt || typeof prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }

  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found; run clauth launch <name> first" }, 400);
  }

  const result = await runHiveManual(prompt, profile.dir, profile.name);
  return c.json(result);
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

  const result = await runHiveQuery(prompt, profile.dir, profile.name);
  return c.json(result);
});

hiveRoutes.post("/lint", async (c) => {
  const profile = await resolveProfile();
  if (!profile) {
    return c.json({ error: "no profile found" }, 400);
  }

  const result = await runHiveLint(profile.dir, profile.name);
  return c.json(result);
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

  const result = await runHiveFileIngest(tmpPath, focus, profile.dir, profile.name);
  return c.json(result);
});
