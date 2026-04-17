import { writable, derived } from "svelte/store";
import type { Profile, WikiPage } from "./types";

export const profiles = writable<Profile[]>([]);
export const wikiPages = writable<WikiPage[]>([]);
export const currentRoute = writable<string>(location.hash.slice(1) || "/");

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    currentRoute.set(location.hash.slice(1) || "/");
  });
}

export function navigate(path: string): void {
  location.hash = path;
  currentRoute.set(path);
}

export const pagesByCategory = derived(wikiPages, ($pages) => {
  const byCat = new Map<string, WikiPage[]>();
  for (const page of $pages) {
    if (!byCat.has(page.category)) byCat.set(page.category, []);
    byCat.get(page.category)!.push(page);
  }
  return byCat;
});
