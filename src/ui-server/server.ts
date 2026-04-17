import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { profilesRoutes } from "./routes/profiles.js";
import { hiveRoutes } from "./routes/hive.js";
import { statsRoutes } from "./routes/stats.js";
import { findFreePort } from "./lib/free-port.js";
import { openBrowser } from "./lib/open-browser.js";

export interface StartOptions {
  port?: number;
  openBrowser?: boolean;
}

export async function startUiServer(opts: StartOptions = {}): Promise<{ url: string; close: () => void }> {
  const app = new Hono();

  app.route("/api/profiles", profilesRoutes);
  app.route("/api/hive", hiveRoutes);
  app.route("/api/stats", statsRoutes);

  // Explicit 404 for unknown API routes (otherwise they'd fall through to SPA)
  app.all("/api/*", (c) => c.json({ error: "unknown endpoint" }, 404));

  // Static files (built Svelte frontend)
  const distDir = dirname(fileURLToPath(import.meta.url));
  const webRoot = join(distDir, "..", "ui-web");

  // Verify the built UI is present — helpful error if not
  try {
    const { access } = await import("node:fs/promises");
    await access(join(webRoot, "index.html"));
  } catch {
    throw new Error(
      `UI assets not found at ${webRoot}. Run "npm run build" first, or reinstall clauth.`
    );
  }

  app.use("/*", serveStatic({ root: webRoot }));
  app.get("/*", serveStatic({ path: join(webRoot, "index.html") }));

  const port = opts.port ?? (await findFreePort());
  const url = `http://127.0.0.1:${port}`;

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
      if (opts.openBrowser !== false) {
        openBrowser(url);
      }
      resolve({
        url,
        close: () => server.close(),
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Try a different port or omit --port to use a random one.`));
      } else {
        reject(err);
      }
    });
  });
}
