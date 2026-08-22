<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import { currentRoute, navigate, openQuestionCount } from "./stores";

  interface NavItem {
    label: string;
    path: string;
    icon: string;
  }

  const nav: NavItem[] = [
    { label: "Dashboard", path: "/", icon: "▧" },
    { label: "Hive", path: "/hive", icon: "⬡" },
    { label: "Feed", path: "/hive/feed", icon: "↓" },
    { label: "Query", path: "/hive/query", icon: "?" },
    { label: "Questions", path: "/hive/questions", icon: "!" },
    { label: "Graph", path: "/hive/graph", icon: "⌘" },
    { label: "Profiles", path: "/profiles", icon: "⚙" },
    { label: "Stats", path: "/stats", icon: "▤" },
  ];

  function isActive(path: string, current: string): boolean {
    if (path === "/") return current === "/" || current === "";
    return current === path || current.startsWith(path + "/");
  }

  let { children } = $props();

  // The count is only read here, so the badge is right on first paint of any
  // page; the Questions view keeps the store current as answers are given.
  onMount(async () => {
    try {
      const state = await api.getHiveQuestions();
      openQuestionCount.set(state.open.length);
    } catch {
      /* a missing queue is not worth an error in the shell */
    }
  });
</script>

<div class="min-h-screen flex">
  <aside class="w-56 border-r border-neutral-800 bg-neutral-950 flex flex-col">
    <div class="px-4 py-4 border-b border-neutral-800">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-md bg-gradient-to-br from-green-300 via-sky-400 to-blue-400 flex items-center justify-center text-white font-bold text-sm">c</div>
        <div>
          <div class="text-sm font-semibold text-neutral-100">clauth</div>
          <div class="text-[10px] text-neutral-500 uppercase tracking-wider">hive mind</div>
        </div>
      </div>
    </div>
    <nav class="flex-1 px-2 py-3 space-y-0.5">
      {#each nav as item}
        <button
          class="nav-link w-full text-left {isActive(item.path, $currentRoute) ? 'active' : ''}"
          onclick={() => navigate(item.path)}
        >
          <span class="w-4 text-center text-neutral-500">{item.icon}</span>
          <span>{item.label}</span>
          {#if item.path === "/hive/questions" && $openQuestionCount > 0}
            <span class="badge bg-accent/15 text-accent ml-auto">{$openQuestionCount}</span>
          {/if}
        </button>
      {/each}
    </nav>
    <div class="px-4 py-3 border-t border-neutral-800">
      <div class="text-[10px] text-neutral-600 font-mono">v1.5.0 · local</div>
    </div>
  </aside>
  <main class="flex-1 overflow-auto">
    {@render children()}
  </main>
</div>
