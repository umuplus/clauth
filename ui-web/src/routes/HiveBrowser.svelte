<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { renderMarkdown, parseFrontmatter } from "../lib/markdown";
  import { wikiPages, navigate } from "../lib/stores";
  import type {
    Category,
    WikiPage,
    WikiPageContent,
  } from "../lib/types";

  let { path }: { path?: string } = $props();

  const categoryOrder: Category[] = [
    "projects",
    "concepts",
    "clients",
    "company",
    "personal",
    "people",
  ];

  let search = $state("");
  let indexContent = $state<string | null>(null);
  let loading = $state(true);
  let expandedProjects = $state<Record<string, boolean>>({});

  let pageData = $state<WikiPageContent | null>(null);
  let pageHtml = $state("");
  let pageFrontmatter = $state<Record<string, string>>({});
  let pageLoading = $state(false);
  let pageError = $state<string | null>(null);

  type ResetTarget =
    | { kind: "all" }
    | { kind: "project"; name: string }
    | { kind: "page"; category: string; name: string };

  let resetTarget = $state<ResetTarget | null>(null);
  let resetConfirmText = $state("");
  let resetting = $state(false);
  let resetError = $state<string | null>(null);

  async function refreshPages() {
    const [p, idx] = await Promise.all([api.listWikiPages(), api.getHiveIndex()]);
    wikiPages.set(p.pages);
    indexContent = idx.content;
  }

  onMount(async () => {
    try {
      await refreshPages();
    } finally {
      loading = false;
    }
  });

  function askReset(target: ResetTarget) {
    resetTarget = target;
    resetConfirmText = "";
    resetError = null;
  }

  /** Path of the page the reset would delete, for the redirect-away check. */
  function deletedPath(t: ResetTarget): string | null {
    if (t.kind === "project") return `projects/${t.name}/`;
    if (t.kind === "page") return `${t.category}/${t.name}.md`;
    return null;
  }

  async function performReset() {
    if (!resetTarget) return;
    const target = resetTarget;
    resetting = true;
    resetError = null;
    try {
      if (target.kind === "all") await api.resetHiveAll();
      else if (target.kind === "project") await api.resetHiveProject(target.name);
      else await api.resetHivePage(target.category, target.name);

      await refreshPages();
      // The open page may have just been deleted — fall back to the index.
      const prefix = deletedPath(target);
      const gone = target.kind === "all" || (prefix ? (path?.startsWith(prefix) ?? false) : false);
      if (gone && path) navigate("/hive");
      resetTarget = null;
    } catch (e) {
      resetError = String(e);
    } finally {
      resetting = false;
    }
  }

  $effect(() => {
    const current = path;
    if (!current) {
      pageData = null;
      pageHtml = "";
      pageFrontmatter = {};
      pageError = null;
      return;
    }
    pageLoading = true;
    pageError = null;
    api
      .getWikiPage(current)
      .then((p) => {
        pageData = p;
        pageFrontmatter = parseFrontmatter(p.content);
        pageHtml = renderMarkdown(p.content);
      })
      .catch((e) => {
        pageError = String(e);
      })
      .finally(() => {
        pageLoading = false;
      });
  });

  let filtered = $derived.by(() => {
    if (!search.trim()) return $wikiPages;
    const q = search.toLowerCase();
    return $wikiPages.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  });

  // For projects category: group pages by project name (first segment)
  let projectGroups = $derived.by(() => {
    const groups = new Map<string, WikiPage[]>();
    for (const page of filtered) {
      if (page.category !== "projects") continue;
      const slash = page.name.indexOf("/");
      const projectName = slash >= 0 ? page.name.slice(0, slash) : page.name;
      if (!groups.has(projectName)) groups.set(projectName, []);
      groups.get(projectName)!.push(page);
    }
    return groups;
  });

  // For non-project categories: flat list
  let flatByCategory = $derived.by(() => {
    const byCat = new Map<string, WikiPage[]>();
    for (const page of filtered) {
      if (page.category === "projects") continue;
      if (!byCat.has(page.category)) byCat.set(page.category, []);
      byCat.get(page.category)!.push(page);
    }
    return byCat;
  });

  function toggleProject(name: string) {
    expandedProjects = { ...expandedProjects, [name]: !expandedProjects[name] };
  }

  function pageLabel(page: WikiPage): string {
    // For projects, show just the filename (after the slash)
    if (page.category === "projects") {
      const slash = page.name.indexOf("/");
      if (slash >= 0) return page.name.slice(slash + 1);
    }
    return page.name;
  }
</script>

<div class="flex h-screen">
  <div class="w-72 border-r border-neutral-800 flex flex-col">
    <div class="p-3 border-b border-neutral-800">
      <input
        class="input"
        type="text"
        placeholder="Search pages..."
        bind:value={search}
      />
    </div>
    <div class="flex-1 overflow-auto p-2">
      {#if loading}
        <div class="text-sm text-neutral-500 p-3">Loading...</div>
      {:else if $wikiPages.length === 0}
        <div class="text-sm text-neutral-500 p-3">
          No pages yet.
          <br /><br />
          Run a session with hive mind enabled, or feed knowledge manually.
        </div>
      {:else}
        <!-- Projects: collapsable tree -->
        {#if projectGroups.size > 0}
          <div class="mb-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-500 px-3 py-1 font-semibold">
              projects
            </div>
            {#each Array.from(projectGroups.entries()).sort(([a], [b]) => a.localeCompare(b)) as [projectName, pages]}
              {@const expanded = (expandedProjects[projectName] ?? false) || search.trim().length > 0 || pages.some((p) => p.path === path)}
              <div class="group relative flex items-center">
                <button
                  class="nav-link flex-1 min-w-0 text-left"
                  onclick={() => toggleProject(projectName)}
                  aria-expanded={expanded}
                >
                  <span class="w-3 text-center text-neutral-500 text-xs">
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span class="font-medium text-neutral-200 truncate">{projectName}</span>
                  <span
                    class="ml-auto text-[10px] text-neutral-600 font-mono group-hover:invisible"
                  >{pages.length}</span>
                </button>
                <button
                  class="absolute right-2 px-1 text-xs text-neutral-500 opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                  title="Reset {projectName}"
                  aria-label="Reset project {projectName}"
                  onclick={() => askReset({ kind: "project", name: projectName })}
                >✕</button>
              </div>
              {#if expanded}
                <div class="ml-3 border-l border-neutral-800">
                  {#each pages.sort((a, b) => a.name.localeCompare(b.name)) as page}
                    <button
                      class="nav-link w-full text-left pl-4 {page.path === path ? 'active' : ''}"
                      onclick={() => navigate(`/hive/page/${page.path}`)}
                    >
                      <span class="truncate text-neutral-400">{pageLabel(page)}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Other categories: flat list -->
        {#each categoryOrder.filter((c) => c !== "projects") as category}
          {@const pages = flatByCategory.get(category) ?? []}
          {#if pages.length > 0}
            <div class="mb-3">
              <div class="text-[10px] uppercase tracking-wider text-neutral-500 px-3 py-1 font-semibold">
                {category}
              </div>
              {#each pages.sort((a, b) => a.name.localeCompare(b.name)) as page}
                <div class="group relative flex items-center">
                  <button
                    class="nav-link flex-1 min-w-0 text-left {page.path === path ? 'active' : ''}"
                    onclick={() => navigate(`/hive/page/${page.path}`)}
                  >
                    <span class="truncate">{pageLabel(page)}</span>
                  </button>
                  <button
                    class="absolute right-2 px-1 text-xs text-neutral-500 opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    title="Reset {category}/{page.name}"
                    aria-label="Reset page {category}/{page.name}"
                    onclick={() => askReset({ kind: "page", category, name: page.name })}
                  >✕</button>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-auto p-8">
    {#if path}
      <div class="max-w-4xl mx-auto">
        {#if pageLoading}
          <div class="text-sm text-neutral-500">Loading...</div>
        {:else if pageError}
          <div class="card border-red-900 bg-red-950/30">
            <div class="text-sm text-red-400">{pageError}</div>
          </div>
        {:else if pageData}
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <span class="badge bg-neutral-800 text-neutral-400 font-mono">{path}</span>
            {#if pageFrontmatter.category}
              <span class="badge bg-accent/20 text-accent">{pageFrontmatter.category}</span>
            {/if}
            {#if pageFrontmatter.project}
              <span class="badge bg-blue-500/20 text-blue-400">{pageFrontmatter.project}</span>
            {/if}
            {#if pageFrontmatter.updated}
              <span class="text-xs text-neutral-500 font-mono">updated {pageFrontmatter.updated}</span>
            {/if}
          </div>

          <article class="prose prose-invert prose-neutral max-w-none prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800 prose-code:text-accent prose-a:text-accent hover:prose-a:text-sky-300">
            {@html pageHtml}
          </article>
        {/if}
      </div>
    {:else}
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <h1 class="text-2xl font-semibold mb-1">Hive Wiki</h1>
          <p class="text-sm text-neutral-400">Browse the accumulated knowledge from your sessions.</p>
        </div>

        {#if indexContent}
          <div class="card">
            <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Index</div>
            <pre class="text-sm font-mono text-neutral-300 whitespace-pre-wrap">{indexContent}</pre>
          </div>
        {:else}
          <div class="card">
            <div class="text-sm text-neutral-500">No index available.</div>
          </div>
        {/if}

        <div class="card mt-6 border-red-900/60">
          <div class="text-xs uppercase tracking-wider text-red-400/80 mb-2">Danger zone</div>
          <p class="text-sm text-neutral-400 mb-3">
            Reset a single project from the sidebar (hover a project, click ✕). Resetting
            everything deletes all projects, concepts, clients, company, personal and people
            pages. This cannot be undone.
          </p>
          <button class="btn-secondary text-red-400 hover:text-red-300" onclick={() => askReset({ kind: "all" })}>
            Reset entire wiki
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if resetTarget}
  {@const isAll = resetTarget.kind === "all"}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reset-title"
  >
    <div class="card w-full max-w-md border-red-900">
      <h2 id="reset-title" class="text-lg font-semibold mb-2">
        {isAll ? "Reset the entire wiki?" : `Reset "${resetTarget.name}"?`}
      </h2>

      {#if isAll}
        <p class="text-sm text-neutral-400 mb-3">
          Every page in every category will be permanently deleted and the wiki rescaffolded
          empty. Your code and files are not touched. This cannot be undone.
        </p>
        <p class="text-sm text-neutral-400 mb-2">
          Type <span class="font-mono text-red-400">RESET</span> to confirm:
        </p>
        <input
          class="input mb-3"
          type="text"
          bind:value={resetConfirmText}
          placeholder="RESET"
          aria-label="Type RESET to confirm"
        />
      {:else if resetTarget.kind === "project"}
        <p class="text-sm text-neutral-400 mb-3">
          Deletes the pages under <span class="font-mono">projects/{resetTarget.name}/</span> and
          removes it from the index. Pages about this name in other categories (clients,
          people, concepts) are kept. This cannot be undone.
        </p>
      {:else}
        <p class="text-sm text-neutral-400 mb-3">
          Deletes
          <span class="font-mono">{resetTarget.category}/{resetTarget.name}.md</span>
          and removes it from the index. Other pages that link to it are left as-is —
          run a lint afterwards to clean up any dangling links. This cannot be undone.
        </p>
      {/if}

      {#if resetError}
        <div class="text-sm text-red-400 mb-3">{resetError}</div>
      {/if}

      <div class="flex justify-end gap-2">
        <button class="btn-secondary" onclick={() => (resetTarget = null)} disabled={resetting}>
          Cancel
        </button>
        <button
          class="btn-secondary text-red-400 hover:text-red-300"
          onclick={performReset}
          disabled={resetting || (isAll && resetConfirmText !== "RESET")}
        >
          {resetting ? "Resetting..." : isAll ? "Reset everything" : resetTarget.kind === "project" ? "Reset project" : "Reset page"}
        </button>
      </div>
    </div>
  </div>
{/if}
