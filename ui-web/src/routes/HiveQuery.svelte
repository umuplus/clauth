<script lang="ts">
  import { api } from "../lib/api";

  interface Message {
    role: "user" | "assistant";
    content: string;
    error?: boolean;
  }

  let messages = $state<Message[]>([]);
  let input = $state("");
  let submitting = $state(false);
  let linting = $state(false);

  async function submit() {
    const prompt = input.trim();
    if (!prompt) return;
    messages = [...messages, { role: "user", content: prompt }];
    input = "";
    submitting = true;
    try {
      const res = await api.queryHive(prompt);
      if (res.summary) {
        messages = [...messages, { role: "assistant", content: res.summary }];
      } else if (res.error) {
        messages = [...messages, { role: "assistant", content: res.error, error: true }];
      } else {
        messages = [...messages, { role: "assistant", content: "(no response)" }];
      }
    } catch (err) {
      messages = [
        ...messages,
        { role: "assistant", content: String(err), error: true },
      ];
    } finally {
      submitting = false;
    }
  }

  async function runLint() {
    linting = true;
    try {
      const res = await api.lintHive();
      messages = [
        ...messages,
        { role: "user", content: "(lint)" },
        res.summary
          ? { role: "assistant" as const, content: res.summary }
          : { role: "assistant" as const, content: res.error ?? "(no response)", error: !!res.error },
      ];
    } catch (err) {
      messages = [...messages, { role: "assistant", content: String(err), error: true }];
    } finally {
      linting = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submit();
    }
  }
</script>

<div class="flex flex-col h-screen">
  <div class="border-b border-neutral-800 p-4 flex items-center justify-between">
    <div>
      <h1 class="text-lg font-semibold">Query Hive</h1>
      <p class="text-xs text-neutral-500">Read-only questions against your wiki.</p>
    </div>
    <button class="btn-secondary text-sm" onclick={runLint} disabled={linting}>
      {linting ? "Linting..." : "Run Lint"}
    </button>
  </div>

  <div class="flex-1 overflow-auto p-6">
    <div class="max-w-3xl mx-auto space-y-4">
      {#if messages.length === 0}
        <div class="text-center py-16">
          <div class="text-sm text-neutral-500 mb-4">Ask anything about your accumulated knowledge.</div>
          <div class="grid grid-cols-1 gap-2 max-w-md mx-auto">
            {#each ["What decisions have I made across projects?", "What databases am I using?", "What patterns keep recurring?", "Who owns which projects?"] as example}
              <button
                class="btn-ghost text-sm text-left justify-start"
                onclick={() => (input = example)}
              >
                <span class="text-neutral-400">→</span>
                <span class="text-neutral-300">{example}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#each messages as msg}
        <div class="flex gap-3 {msg.role === 'user' ? 'justify-end' : ''}">
          <div class="max-w-[80%] rounded-lg px-4 py-3 text-sm
            {msg.role === 'user' ? 'bg-neutral-800 text-neutral-100' :
             msg.error ? 'bg-red-950/40 border border-red-900 text-red-200' :
             'bg-neutral-900 border border-neutral-800 text-neutral-100'}">
            {#if msg.error}
              <pre class="font-mono whitespace-pre-wrap text-xs">{msg.content}</pre>
            {:else}
              <div class="whitespace-pre-wrap">{msg.content}</div>
            {/if}
          </div>
        </div>
      {/each}
      {#if submitting}
        <div class="flex gap-3">
          <div class="max-w-[80%] rounded-lg px-4 py-3 text-sm bg-neutral-900 border border-neutral-800">
            <div class="flex items-center gap-2 text-neutral-400">
              <div class="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
              <span>Thinking...</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="border-t border-neutral-800 p-4">
    <div class="max-w-3xl mx-auto flex gap-2">
      <textarea
        class="input font-sans flex-1 resize-none min-h-[44px]"
        placeholder="Ask your hive anything... (Cmd+Enter to send)"
        bind:value={input}
        onkeydown={onKeydown}
        disabled={submitting}
        rows="1"
      ></textarea>
      <button
        class="btn-primary"
        onclick={submit}
        disabled={submitting || !input.trim()}
      >
        Send
      </button>
    </div>
  </div>
</div>
