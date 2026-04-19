<script lang="ts">
  import { api } from "../lib/api";
  import type { HiveResult, HiveStreamEvent } from "../lib/types";

  let prompt = $state("");
  let focusPrompt = $state("");
  let file = $state<File | null>(null);
  let submitting = $state(false);
  let result = $state<HiveResult | null>(null);
  let dragOver = $state(false);
  let progress = $state<string[]>([]);

  function onProgress(ev: HiveStreamEvent) {
    if (ev.kind === "text") {
      progress = [...progress, ev.text];
    } else if (ev.kind === "tool") {
      progress = [...progress, `→ ${ev.name}`];
    } else if (ev.kind === "system") {
      progress = [...progress, `· ${ev.message}`];
    }
  }

  async function submitText() {
    if (!prompt.trim()) return;
    submitting = true;
    result = null;
    progress = [];
    try {
      result = await api.feedHive(prompt, onProgress);
      if (result.summary && !result.error) prompt = "";
    } catch (err) {
      result = { summary: null, error: String(err) };
    } finally {
      submitting = false;
    }
  }

  async function submitFile() {
    if (!file) return;
    submitting = true;
    result = null;
    progress = [];
    try {
      result = await api.uploadFile(file, focusPrompt.trim() || undefined, onProgress);
      if (result.summary && !result.error) {
        file = null;
        focusPrompt = "";
      }
    } catch (err) {
      result = { summary: null, error: String(err) };
    } finally {
      submitting = false;
    }
  }

  function onFilePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) file = input.files[0];
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) file = f;
  }
</script>

<div class="p-8 max-w-3xl mx-auto">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold mb-1">Feed Hive</h1>
    <p class="text-sm text-neutral-400">Ingest knowledge directly or drop a file.</p>
  </div>

  <div class="space-y-6">
    <div class="card">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Text input</div>
      <textarea
        class="input font-mono text-sm min-h-32"
        placeholder="E.g. decided to use Postgres for project X because we need transactions..."
        bind:value={prompt}
        disabled={submitting}
      ></textarea>
      <div class="mt-3 flex justify-end">
        <button
          class="btn-primary"
          onclick={submitText}
          disabled={submitting || !prompt.trim()}
        >
          {submitting ? "Processing..." : "Feed"}
        </button>
      </div>
    </div>

    <div class="card">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">File upload</div>
      <div
        class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
          {dragOver ? 'border-accent bg-accent/5' : 'border-neutral-800 hover:border-neutral-700'}"
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
        onclick={() => document.getElementById("fileInput")?.click()}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            document.getElementById("fileInput")?.click();
          }
        }}
        role="button"
        tabindex="0"
      >
        {#if file}
          <div class="text-sm">
            <div class="font-mono text-neutral-200">{file.name}</div>
            <div class="text-xs text-neutral-500 mt-1">{(file.size / 1024).toFixed(1)} KB</div>
          </div>
        {:else}
          <div class="text-sm text-neutral-400">Drop a file or click to browse</div>
          <div class="text-xs text-neutral-600 mt-1">markdown, text, PDF</div>
        {/if}
        <input id="fileInput" type="file" class="hidden" onchange={onFilePicked} />
      </div>
      {#if file}
        <div class="mt-3">
          <input
            class="input"
            type="text"
            placeholder="Optional: focus or context for this file..."
            bind:value={focusPrompt}
            disabled={submitting}
          />
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button class="btn-ghost" onclick={() => (file = null)} disabled={submitting}>Clear</button>
          <button class="btn-primary" onclick={submitFile} disabled={submitting}>
            {submitting ? "Ingesting..." : "Ingest File"}
          </button>
        </div>
      {/if}
    </div>

    {#if submitting && progress.length > 0}
      <div class="card">
        <div class="text-xs uppercase tracking-wider text-neutral-500 mb-2">Live</div>
        <div class="text-xs text-neutral-300 font-mono whitespace-pre-wrap max-h-64 overflow-auto">{progress.join("\n")}</div>
      </div>
    {/if}

    {#if result}
      {#if result.summary}
        <div class="card border-green-900 bg-green-950/30">
          <div class="text-xs uppercase tracking-wider text-green-500 mb-2">Success</div>
          <div class="text-sm text-green-200">{result.summary}</div>
        </div>
      {:else if result.error}
        <div class="card border-red-900 bg-red-950/30">
          <div class="text-xs uppercase tracking-wider text-red-500 mb-2">Error</div>
          <div class="text-sm text-red-200 font-mono whitespace-pre-wrap">{result.error}</div>
        </div>
      {/if}
    {/if}
  </div>
</div>
