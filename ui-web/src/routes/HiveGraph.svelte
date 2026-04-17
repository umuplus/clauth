<script lang="ts">
  import { onMount } from "svelte";
  import cytoscape from "cytoscape";
  import type { Core } from "cytoscape";
  import { api } from "../lib/api";
  import { navigate } from "../lib/stores";

  let container: HTMLDivElement | undefined = $state();
  let loading = $state(true);
  let cy: Core | null = null;
  let error = $state<string | null>(null);

  const categoryColors: Record<string, string> = {
    projects: "#ff8c42",
    concepts: "#42a5ff",
    clients: "#c44dff",
    company: "#4dff88",
    personal: "#ffeb42",
    people: "#ff4d88",
  };

  onMount(async () => {
    try {
      const { pages } = await api.listWikiPages();

      // Load all page contents to extract links
      const contents = await Promise.all(
        pages.map(async (p) => {
          try {
            const c = await api.getWikiPage(p.path);
            return { ...p, content: c.content };
          } catch {
            return { ...p, content: "" };
          }
        })
      );

      const nodes = contents.map((p) => ({
        data: {
          id: p.path,
          label: p.name,
          category: p.category,
        },
      }));

      // Extract wiki links: [text](../category/name.md) or [text](path.md)
      const edges: { data: { id: string; source: string; target: string } }[] = [];
      const pagesByPath = new Map(contents.map((p) => [p.path, p]));

      for (const page of contents) {
        const linkRegex = /\]\(([^)]+\.md)\)/g;
        let match;
        while ((match = linkRegex.exec(page.content)) !== null) {
          // Resolve the link relative to the page
          const rawLink = match[1];
          // Strip ../ prefixes and try to resolve
          const cleanLink = rawLink.replace(/^\.\.\//, "").replace(/^\.\//, "");
          // Try to find a matching page
          const target = contents.find(
            (p) => p.path === cleanLink || p.path.endsWith(cleanLink)
          );
          if (target && target.path !== page.path) {
            const edgeId = `${page.path}->${target.path}`;
            if (!edges.find((e) => e.data.id === edgeId)) {
              edges.push({
                data: { id: edgeId, source: page.path, target: target.path },
              });
            }
          }
        }
      }

      if (!container) return;
      cy = cytoscape({
        container,
        elements: [...nodes, ...edges],
        style: [
          {
            selector: "node",
            style: {
              "background-color": (ele: any) =>
                categoryColors[ele.data("category")] ?? "#888",
              label: "data(label)",
              color: "#e5e5e5",
              "font-size": "11px",
              "font-family": "Inter, sans-serif",
              "text-outline-color": "#0a0a0a",
              "text-outline-width": 2,
              width: 14,
              height: 14,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "#525252",
              "target-arrow-color": "#525252",
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              "arrow-scale": 0.6,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 3,
              "border-color": "#ff8c42",
            },
          },
        ],
        layout: {
          name: "cose",
          animate: false,
          fit: true,
          padding: 40,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 80,
        },
      });

      cy.on("tap", "node", (evt) => {
        const path = evt.target.id();
        navigate(`/hive/page/${path}`);
      });
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  });

  function fit() {
    if (cy) cy.fit(undefined, 40);
  }
</script>

<div class="h-screen flex flex-col">
  <div class="border-b border-neutral-800 p-4 flex items-center justify-between">
    <div>
      <h1 class="text-lg font-semibold">Graph</h1>
      <p class="text-xs text-neutral-500">Click a node to open the page.</p>
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-3 text-xs text-neutral-400">
        {#each Object.entries(categoryColors) as [cat, color]}
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: {color}"></span>
            <span class="capitalize">{cat}</span>
          </div>
        {/each}
      </div>
      <button class="btn-secondary text-xs" onclick={fit}>Fit</button>
    </div>
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center text-sm text-neutral-500">Loading graph...</div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center">
      <div class="card border-red-900 bg-red-950/30 text-red-200 text-sm max-w-md">{error}</div>
    </div>
  {:else}
    <div bind:this={container} class="flex-1 bg-neutral-950"></div>
  {/if}
</div>
