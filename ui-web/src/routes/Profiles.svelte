<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profiles } from "../lib/stores";
  import type { Profile } from "../lib/types";

  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const p = await api.listProfiles();
      profiles.set(p.profiles);
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  });

  async function toggle(p: Profile, key: "skipPermissions" | "hiveMind") {
    const current =
      key === "skipPermissions"
        ? p.config.skipPermissions ?? false
        : p.config.hiveMind?.enabled ?? false;
    const next = !current;

    const updates =
      key === "skipPermissions"
        ? { skipPermissions: next }
        : { hiveMind: { enabled: next } };

    try {
      const res = await api.updateProfileConfig(p.name, updates);
      profiles.update(($p) =>
        $p.map((x) => (x.name === p.name ? { ...x, config: res.config } : x))
      );
    } catch (err) {
      alert(`Failed to update: ${err}`);
    }
  }
</script>

<div class="p-8 max-w-5xl">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold mb-1">Profiles</h1>
    <p class="text-sm text-neutral-400">
      Each profile is an isolated Claude configuration with its own auth and settings.
    </p>
  </div>

  {#if loading}
    <div class="text-sm text-neutral-500">Loading...</div>
  {:else if error}
    <div class="card border-red-900 bg-red-950/30 text-red-200 text-sm">{error}</div>
  {:else}
    <div class="grid grid-cols-2 gap-4">
      {#each $profiles as p}
        <div class="card">
          <div class="flex items-start justify-between mb-4">
            <div>
              <div class="font-mono text-lg text-neutral-100">{p.name}</div>
              <div class="text-xs text-neutral-500 mt-0.5">
                {p.authenticated ? "Authenticated" : "Not authenticated"}
              </div>
            </div>
            {#if p.authenticated}
              <span class="badge bg-green-500/20 text-green-400">●</span>
            {:else}
              <span class="badge bg-neutral-800 text-neutral-500">○</span>
            {/if}
          </div>

          <div class="space-y-2 mb-4">
            <label class="flex items-center justify-between py-1.5 cursor-pointer">
              <span class="text-sm text-neutral-300">Skip permissions</span>
              <button
                class="w-10 h-5 rounded-full transition-colors relative
                  {p.config.skipPermissions ? 'bg-accent' : 'bg-neutral-700'}"
                onclick={() => toggle(p, "skipPermissions")}
                aria-label="Toggle skip permissions"
                aria-pressed={p.config.skipPermissions}
              >
                <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all
                  {p.config.skipPermissions ? 'left-5' : 'left-0.5'}"></span>
              </button>
            </label>
            <label class="flex items-center justify-between py-1.5 cursor-pointer">
              <span class="text-sm text-neutral-300">Hive Mind</span>
              <button
                class="w-10 h-5 rounded-full transition-colors relative
                  {p.config.hiveMind?.enabled ? 'bg-accent' : 'bg-neutral-700'}"
                onclick={() => toggle(p, "hiveMind")}
                aria-label="Toggle hive mind"
                aria-pressed={p.config.hiveMind?.enabled}
              >
                <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all
                  {p.config.hiveMind?.enabled ? 'left-5' : 'left-0.5'}"></span>
              </button>
            </label>
          </div>

          <div class="pt-3 border-t border-neutral-800">
            <div class="text-xs text-neutral-500 font-mono">
              clauth launch {p.name}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
