<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { openQuestionCount, navigate } from "../lib/stores";
  import type { Question } from "../lib/types";

  let open = $state<Question[]>([]);
  let answered = $state<Question[]>([]);
  let running = $state<{ pid: number; startedAt: string } | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  /** Draft answers, keyed by question id — kept out of `open` so a reload can't clobber typing. */
  let drafts = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);
  let applying = $state(false);
  let applied = $state<string | null>(null);

  async function load() {
    try {
      const state = await api.getHiveQuestions();
      open = state.open;
      answered = state.answered;
      running = state.running;
      openQuestionCount.set(state.open.length);
      error = null;
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function save(q: Question) {
    const answer = (drafts[q.id] ?? "").trim();
    if (!answer) return;
    busy = q.id;
    try {
      await api.answerHiveQuestion(q.id, answer);
      delete drafts[q.id];
      await load();
    } catch (err) {
      error = String(err);
    } finally {
      busy = null;
    }
  }

  async function dismiss(q: Question) {
    busy = q.id;
    try {
      await api.dismissHiveQuestion(q.id);
      delete drafts[q.id];
      await load();
    } catch (err) {
      error = String(err);
    } finally {
      busy = null;
    }
  }

  async function dismissAll() {
    if (!confirm(`Dismiss all ${open.length} open question(s)? They will not be asked again.`)) return;
    busy = "all";
    try {
      await api.dismissAllHiveQuestions();
      await load();
    } catch (err) {
      error = String(err);
    } finally {
      busy = null;
    }
  }

  async function apply() {
    applying = true;
    try {
      const res = await api.applyHiveAnswers();
      applied = res.running
        ? "An analysis is running; your answers go into the wiki once it finishes."
        : "Writing them into the wiki in the background.";
      await load();
    } catch (err) {
      error = String(err);
    } finally {
      applying = false;
    }
  }

  function onKeydown(e: KeyboardEvent, q: Question) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save(q);
    }
  }

  function when(ts: string): string {
    return ts.replace("T", " ").slice(0, 16);
  }
</script>

<div class="p-8 max-w-3xl mx-auto">
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold mb-1">Questions</h1>
      <p class="text-sm text-neutral-400">
        Things the wiki could not work out from your sessions — only you know them.
      </p>
    </div>
    {#if open.length > 0}
      <button class="btn-ghost" onclick={dismissAll} disabled={busy !== null}>Dismiss all</button>
    {/if}
  </div>

  {#if error}
    <div class="card border-red-900 bg-red-950/30 mb-6">
      <div class="text-xs uppercase tracking-wider text-red-500 mb-2">Error</div>
      <div class="text-sm text-red-200 font-mono whitespace-pre-wrap">{error}</div>
    </div>
  {/if}

  {#if loading}
    <div class="text-sm text-neutral-500">Loading…</div>
  {:else if open.length === 0 && answered.length === 0}
    <div class="card">
      <p class="text-sm text-neutral-400">
        No open questions — the wiki hasn't hit anything only you can answer.
      </p>
      <p class="text-xs text-neutral-600 mt-2">
        Questions appear here after an analysis run finds a gap it cannot close on its own.
      </p>
    </div>
  {/if}

  <div class="space-y-4">
    {#each open as q (q.id)}
      <div class="card">
        <div class="flex items-center justify-between gap-3 mb-2">
          <button
            class="text-xs font-mono text-neutral-500 hover:text-accent text-left"
            onclick={() => q.page && navigate(`/hive/page/${q.page}`)}
            disabled={!q.page}
          >
            {q.page ?? "(no page recorded)"}
          </button>
          <span class="text-[10px] text-neutral-600 font-mono shrink-0">
            {q.source} · {when(q.askedAt)}
          </span>
        </div>

        <p class="text-sm text-neutral-100">{q.question}</p>
        {#if q.why}
          <p class="text-xs text-neutral-500 mt-1">→ would change: {q.why}</p>
        {/if}

        <textarea
          class="input text-sm min-h-20 mt-3"
          placeholder="Your answer…"
          bind:value={drafts[q.id]}
          onkeydown={(e) => onKeydown(e, q)}
          disabled={busy === q.id}
        ></textarea>

        <div class="mt-3 flex justify-end gap-2">
          <button class="btn-ghost" onclick={() => dismiss(q)} disabled={busy !== null}>
            Dismiss
          </button>
          <button
            class="btn-primary"
            onclick={() => save(q)}
            disabled={busy !== null || !(drafts[q.id] ?? "").trim()}
          >
            {busy === q.id ? "Saving…" : "Save answer"}
          </button>
        </div>
        <div class="text-[10px] text-neutral-600 text-right mt-1">⌘/Ctrl + Enter to save</div>
      </div>
    {/each}
  </div>

  {#if answered.length > 0}
    <div class="card mt-6 border-green-900 bg-green-950/20">
      <div class="text-xs uppercase tracking-wider text-green-600 mb-2">
        Answered · not in the wiki yet ({answered.length})
      </div>
      <ul class="space-y-2 mb-3">
        {#each answered as q (q.id)}
          <li class="text-xs">
            <div class="text-neutral-300">{q.question}</div>
            <div class="text-neutral-500 mt-0.5">{q.answer}</div>
          </li>
        {/each}
      </ul>
      {#if applied}
        <p class="text-xs text-green-300">{applied}</p>
      {:else}
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-neutral-500">
            One background pass writes every answer, rather than one run each.
          </p>
          <button class="btn-secondary shrink-0" onclick={apply} disabled={applying}>
            {applying ? "Starting…" : "Write into wiki"}
          </button>
        </div>
      {/if}
      {#if running}
        <p class="text-xs text-neutral-500 mt-2">
          An analysis is running (started {when(running.startedAt)}).
        </p>
      {/if}
    </div>
  {/if}
</div>
