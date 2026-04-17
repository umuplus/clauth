<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import type { StatsCache } from "../lib/types";
  import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    Filler,
  } from "chart.js";

  Chart.register(
    LineController,
    LineElement,
    PointElement,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    Filler
  );

  let profiles = $state<{ name: string; stats: StatsCache | null }[]>([]);
  let loading = $state(true);

  let activityCanvas: HTMLCanvasElement | undefined = $state();
  let modelCanvas: HTMLCanvasElement | undefined = $state();
  let activityChart: Chart | null = null;
  let modelChart: Chart | null = null;

  onMount(async () => {
    try {
      const res = await api.getStats();
      profiles = res.profiles;
      renderCharts();
    } finally {
      loading = false;
    }
  });

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function renderCharts() {
    if (activityChart) activityChart.destroy();
    if (modelChart) modelChart.destroy();

    if (activityCanvas) {
      const allDays = new Map<string, Map<string, number>>();
      for (const p of profiles) {
        if (!p.stats) continue;
        for (const d of p.stats.dailyActivity) {
          if (!allDays.has(d.date)) allDays.set(d.date, new Map());
          allDays.get(d.date)!.set(p.name, d.messageCount);
        }
      }
      const sortedDates = Array.from(allDays.keys()).sort().slice(-30);

      const datasets = profiles.map((p, i) => ({
        label: p.name,
        data: sortedDates.map((d) => allDays.get(d)?.get(p.name) ?? 0),
        borderColor: ["#ff8c42", "#42a5ff", "#c44dff", "#4dff88"][i % 4],
        backgroundColor: ["rgba(255,140,66,0.15)", "rgba(66,165,255,0.15)", "rgba(196,77,255,0.15)", "rgba(77,255,136,0.15)"][i % 4],
        fill: true,
        tension: 0.3,
      }));

      activityChart = new Chart(activityCanvas, {
        type: "line",
        data: { labels: sortedDates, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#a3a3a3" } },
          },
          scales: {
            x: { ticks: { color: "#737373" }, grid: { color: "#262626" } },
            y: { ticks: { color: "#737373" }, grid: { color: "#262626" } },
          },
        },
      });
    }

    if (modelCanvas) {
      const allModels = new Set<string>();
      for (const p of profiles) {
        if (p.stats) Object.keys(p.stats.modelUsage).forEach((m) => allModels.add(m));
      }
      const models = Array.from(allModels);

      const datasets = profiles.map((p, i) => ({
        label: p.name,
        data: models.map((m) => {
          const u = p.stats?.modelUsage[m];
          return u ? u.outputTokens : 0;
        }),
        backgroundColor: ["#ff8c42", "#42a5ff", "#c44dff", "#4dff88"][i % 4],
      }));

      modelChart = new Chart(modelCanvas, {
        type: "bar",
        data: { labels: models.map((m) => m.replace("claude-", "")), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#a3a3a3" } },
          },
          scales: {
            x: { ticks: { color: "#737373" }, grid: { color: "#262626" } },
            y: { ticks: { color: "#737373", callback: (v) => formatTokens(+v) }, grid: { color: "#262626" } },
          },
        },
      });
    }
  }

  $effect(() => {
    if (!loading) renderCharts();
  });
</script>

<div class="p-8 max-w-6xl">
  <div class="mb-6">
    <h1 class="text-2xl font-semibold mb-1">Stats</h1>
    <p class="text-sm text-neutral-400">Usage across all profiles.</p>
  </div>

  {#if loading}
    <div class="text-sm text-neutral-500">Loading...</div>
  {:else}
    <div class="grid grid-cols-4 gap-4 mb-6">
      {#each profiles as p}
        <div class="card">
          <div class="font-mono text-sm text-neutral-300 mb-2">{p.name}</div>
          {#if p.stats}
            <div class="text-2xl font-semibold mb-1">{p.stats.totalSessions}</div>
            <div class="text-xs text-neutral-500">sessions</div>
            <div class="mt-3 pt-3 border-t border-neutral-800">
              <div class="text-xs text-neutral-500">
                {p.stats.totalMessages.toLocaleString()} msgs
              </div>
            </div>
          {:else}
            <div class="text-xs text-neutral-500">No data yet</div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="card mb-4">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Activity (30 days)</div>
      <div class="h-64">
        <canvas bind:this={activityCanvas}></canvas>
      </div>
    </div>

    <div class="card">
      <div class="text-xs uppercase tracking-wider text-neutral-500 mb-3">Output tokens by model</div>
      <div class="h-64">
        <canvas bind:this={modelCanvas}></canvas>
      </div>
    </div>
  {/if}
</div>
