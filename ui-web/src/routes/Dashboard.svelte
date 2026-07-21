<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profiles } from "../lib/stores";
  import type { LogEntry, WikiPage, QueueState } from "../lib/types";
  import { navigate } from "../lib/stores";

  let pages = $state<WikiPage[]>([]);
  let log = $state<LogEntry[]>([]);
  let queue = $state<QueueState | null>(null);
  let queueBusy = $state(false);
  let loading = $state(true);

  onMount(async () => {
    try {
      const [p, pg, l, q] = await Promise.all([
        api.listProfiles(),
        api.listWikiPages(),
        api.getHiveLog(10),
        api.getHiveQueue(),
      ]);
      profiles.set(p.profiles);
      pages = pg.pages;
      log = l.entries;
      queue = q;
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

  async function retryFailed() {
    queueBusy = true;
    try {
      await api.retryFailedQueue();
      queue = await api.getHiveQueue();
    } finally {
      queueBusy = false;
    }
  }

  async function clearFailed() {
    queueBusy = true;
    try {
      await api.clearFailedQueue();
      queue = await api.getHiveQueue();
    } finally {
      queueBusy = false;
    }
  }

  function when(ts: string): string {
    return ts.replace("T", " ").slice(0, 16);
  }

  function elapsed(startedAt: string): string {
    const secs = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  // While an analysis is running the queue changes on its own, so poll to keep
  // the card honest — a stale "analysing" that already finished is worse than none.
  $effect(() => {
    if (!queue?.running) return;
    const id = setInterval(async () => {
      try { queue = await api.getHiveQueue(); } catch { /* keep last known */ }
    }, 5000);
    return () => clearInterval(id);
  });
</script>

<div class="p-8 max-w-6xl">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold mb-1">Dashboard</h1>
    <p class="text-sm text-neutral-400">Overview of your Hive Mind wiki and profiles.</p>
  </div>

  {#if queue && (queue.pending.length > 0 || queue.failed.length > 0)}
    <div class="card mb-6 {queue.failed.length > 0 ? 'border-yellow-800' : ''}">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-2">Analysis queue</div>

      {#if queue.pending.length > 0}
        {@const running = queue.running}
        <p class="text-sm text-neutral-300 mb-1">
          {#if running}
            Analysing 1 of {queue.pending.length} · {queue.pending.length - 1} waiting
          {:else}
            {queue.pending.length} session{queue.pending.length > 1 ? "s" : ""} waiting to be analysed
          {/if}
        </p>
        <ul class="text-xs mb-3">
          {#each queue.pending.slice(0, 5) as item, i}
            {#if running && i === 0}
              <li class="text-accent">
                <span class="inline-block animate-pulse">●</span>
                {item.project} — analysing now, {elapsed(running.startedAt)} elapsed
              </li>
            {:else}
              <li class="text-neutral-500">
                {item.project} — queued {when(item.enqueuedAt)}{item.attempts > 0 ? ` (${item.attempts} failed attempt${item.attempts > 1 ? "s" : ""})` : ""}
              </li>
            {/if}
          {/each}
          {#if queue.pending.length > 5}<li class="text-neutral-500">… and {queue.pending.length - 5} more</li>{/if}
        </ul>
        {#if !running}
          <p class="text-xs text-neutral-500 mb-3">
            Nothing is running right now. These start in the background after a session, or force a pass:
            <span class="font-mono">clauth hive --catchup</span>
          </p>
        {/if}
      {/if}

      {#if queue.failed.length > 0}
        <p class="text-sm text-yellow-400 mb-1">
          {queue.failed.length} session{queue.failed.length > 1 ? "s" : ""} gave up after repeated failures
        </p>
        <ul class="text-xs text-neutral-500 mb-3">
          {#each queue.failed.slice(0, 5) as item}
            <li>{item.project}{item.lastError ? ` — ${item.lastError.split("\n")[0].slice(0, 80)}` : ""}</li>
          {/each}
        </ul>
        <div class="flex gap-2">
          <button class="btn-secondary text-sm" onclick={retryFailed} disabled={queueBusy}>Retry</button>
          <button class="btn-secondary text-sm" onclick={clearFailed} disabled={queueBusy}>Drop</button>
        </div>
      {/if}
    </div>
  {:else if queue?.lastProcessed}
    <div class="card mb-6">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-1">Analysis queue</div>
      <p class="text-sm text-neutral-400">
        Up to date — last analysed <span class="text-neutral-300">{queue.lastProcessed.project}</span>
        at {when(queue.lastProcessed.at)}
      </p>
      {#if queue.lastProcessed.summary}
        <p class="text-xs text-neutral-500 mt-1">{queue.lastProcessed.summary}</p>
      {/if}
    </div>
  {/if}

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
