<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { wikiPages, navigate } from "../lib/stores";
  import type { Category, WikiPage } from "../lib/types";

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

  onMount(async () => {
    try {
      const [p, idx] = await Promise.all([api.listWikiPages(), api.getHiveIndex()]);
      wikiPages.set(p.pages);
      indexContent = idx.content;
    } finally {
      loading = false;
    }
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
              {@const expanded = (expandedProjects[projectName] ?? false) || search.trim().length > 0}
              <button
                class="nav-link w-full text-left"
                onclick={() => toggleProject(projectName)}
                aria-expanded={expanded}
              >
                <span class="w-3 text-center text-neutral-500 text-xs">
                  {expanded ? "▾" : "▸"}
                </span>
                <span class="font-medium text-neutral-200 truncate">{projectName}</span>
                <span class="ml-auto text-[10px] text-neutral-600 font-mono">{pages.length}</span>
              </button>
              {#if expanded}
                <div class="ml-3 border-l border-neutral-800">
                  {#each pages.sort((a, b) => a.name.localeCompare(b.name)) as page}
                    <button
                      class="nav-link w-full text-left pl-4"
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
                <button
                  class="nav-link w-full text-left"
                  onclick={() => navigate(`/hive/page/${page.path}`)}
                >
                  <span class="truncate">{pageLabel(page)}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-auto p-8">
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
    </div>
  </div>
</div>
