<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { renderMarkdown, parseFrontmatter } from "../lib/markdown";
  import { navigate } from "../lib/stores";
  import type { WikiPageContent } from "../lib/types";

  let { path }: { path: string } = $props();

  let page = $state<WikiPageContent | null>(null);
  let html = $state("");
  let frontmatter = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const p = await api.getWikiPage(path);
      page = p;
      frontmatter = parseFrontmatter(p.content);
      html = renderMarkdown(p.content);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // reload when path changes
    path;
    load();
  });
</script>

<div class="p-8 max-w-4xl mx-auto">
  <div class="mb-4">
    <button class="btn-ghost text-sm" onclick={() => navigate("/hive")}>← Back to wiki</button>
  </div>

  {#if loading}
    <div class="text-sm text-neutral-500">Loading...</div>
  {:else if error}
    <div class="card border-red-900 bg-red-950/30">
      <div class="text-sm text-red-400">{error}</div>
    </div>
  {:else if page}
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <span class="badge bg-neutral-800 text-neutral-400 font-mono">{path}</span>
      {#if frontmatter.category}
        <span class="badge bg-accent/20 text-accent">{frontmatter.category}</span>
      {/if}
      {#if frontmatter.project}
        <span class="badge bg-blue-500/20 text-blue-400">{frontmatter.project}</span>
      {/if}
      {#if frontmatter.updated}
        <span class="text-xs text-neutral-500 font-mono">updated {frontmatter.updated}</span>
      {/if}
    </div>

    <article class="prose prose-invert prose-neutral max-w-none prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800 prose-code:text-accent prose-a:text-accent hover:prose-a:text-orange-400">
      {@html html}
    </article>
  {/if}
</div>
