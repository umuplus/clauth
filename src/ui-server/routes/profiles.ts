import { Hono } from "hono";
import {
  getProfilesWithStatus,
  getConfig,
  setConfig,
  profileExists,
  type ProfileConfig,
} from "../../profiles.js";

export const profilesRoutes = new Hono();

profilesRoutes.get("/", async (c) => {
  const profiles = await getProfilesWithStatus();
  return c.json({ profiles });
});

profilesRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (name.toLowerCase() === "hive") {
    return c.json({ error: "hive is not a profile" }, 400);
  }
  if (!(await profileExists(name))) {
    return c.json({ error: `Profile "${name}" does not exist` }, 404);
  }
  const config = await getConfig(name);
  return c.json({ name, config });
});

profilesRoutes.patch("/:name/config", async (c) => {
  const name = c.req.param("name");
  if (name.toLowerCase() === "hive") {
    return c.json({ error: "hive is not a profile" }, 400);
  }
  if (!(await profileExists(name))) {
    return c.json({ error: `Profile "${name}" does not exist` }, 404);
  }

  const updates = await c.req.json<Partial<ProfileConfig>>();
  const config = await setConfig(name, updates);
  return c.json({ name, config });
});
