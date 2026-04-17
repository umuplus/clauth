<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profiles } from "../lib/stores";
  import type { LogEntry, WikiPage } from "../lib/types";
  import { navigate } from "../lib/stores";

  let pages = $state<WikiPage[]>([]);
  let log = $state<LogEntry[]>([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      const [p, pg, l] = await Promise.all([
        api.listProfiles(),
        api.listWikiPages(),
        api.getHiveLog(10),
      ]);
      profiles.set(p.profiles);
      pages = pg.pages;
      log = l.entries;
    } finally {
      loading = false;
    }
  });

  let pageCountByCategory = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const page of pages) {
      counts[page.category] = (counts[page.category] ?? 0) + 1;
    }
    return counts;
  });
</script>

<div class="p-8 max-w-6xl">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold mb-1">Dashboard</h1>
    <p class="text-sm text-neutral-400">Overview of your Hive Mind wiki and profiles.</p>
  </div>

  {#if loading}
    <div class="text-sm text-neutral-500">Loading...</div>
  {:else}
    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="card">
        <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Wiki</div>
        <div class="flex items-baseline gap-2 mb-4">
          <div class="text-3xl font-semibold">{pages.length}</div>
          <div class="text-sm text-neutral-400">pages</div>
        </div>
        <div class="space-y-1.5">
          {#each Object.entries(pageCountByCategory) as [cat, count]}
            <div class="flex justify-between text-sm">
              <span class="text-neutral-400 capitalize">{cat}</span>
              <span class="text-neutral-200 font-mono">{count}</span>
            </div>
          {/each}
          {#if pages.length === 0}
            <div class="text-sm text-neutral-500">No pages yet. Feed knowledge to get started.</div>
          {/if}
        </div>
        <button class="btn-primary mt-4" onclick={() => navigate("/hive")}>Browse Wiki</button>
      </div>

      <div class="card">
        <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Profiles</div>
        <div class="flex items-baseline gap-2 mb-4">
          <div class="text-3xl font-semibold">{$profiles.length}</div>
          <div class="text-sm text-neutral-400">configured</div>
        </div>
        <div class="space-y-2">
          {#each $profiles as p}
            <div class="flex items-center justify-between text-sm">
              <span class="font-mono text-neutral-200">{p.name}</span>
              <div class="flex items-center gap-1.5">
                {#if p.config.hiveMind?.enabled}
                  <span class="badge bg-accent/20 text-accent">hive</span>
                {/if}
                {#if p.authenticated}
                  <span class="badge bg-green-500/20 text-green-400">auth</span>
                {:else}
                  <span class="badge bg-neutral-800 text-neutral-500">no auth</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
        <button class="btn-secondary mt-4" onclick={() => navigate("/profiles")}>Manage</button>
      </div>
    </div>

    <div class="card">
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs uppercase tracking-wider text-neutral-500">Recent Activity</div>
        <button class="btn-ghost text-xs" onclick={() => navigate("/hive")}>All</button>
      </div>
      {#if log.length === 0}
        <div class="text-sm text-neutral-500">No activity yet.</div>
      {:else}
        <div class="space-y-2">
          {#each log as entry}
            <div class="flex gap-3 text-sm">
              <span class="text-neutral-500 font-mono shrink-0">{entry.date}</span>
              <span class="text-neutral-300">{entry.details}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
