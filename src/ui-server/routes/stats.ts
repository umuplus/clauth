import { Hono } from "hono";
import { getStats, getProfileNames, profileExists } from "../../profiles.js";

export const statsRoutes = new Hono();

statsRoutes.get("/", async (c) => {
  const names = await getProfileNames();
  const all = await Promise.all(
    names.map(async (name) => ({
      name,
      stats: await getStats(name),
    }))
  );
  return c.json({ profiles: all });
});

statsRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (name.toLowerCase() === "hive") {
    return c.json({ error: "hive is not a profile" }, 400);
  }
  if (!(await profileExists(name))) {
    return c.json({ error: `Profile "${name}" does not exist` }, 404);
  }
  const stats = await getStats(name);
  return c.json({ name, stats });
});
