<script lang="ts">
  import { onMount } from "svelte";
  import cytoscape from "cytoscape";
  import type { Core } from "cytoscape";
  import { api } from "../lib/api";
  import { navigate } from "../lib/stores";
  import type { WikiPage, Category } from "../lib/types";

  interface PageWithContent extends WikiPage {
    content: string;
  }

  interface Entity {
    id: string;
    category: Category;
    label: string;
    pages: string[];
  }

  let container: HTMLDivElement | undefined = $state();
  let loading = $state(true);
  let cy: Core | null = null;
  let error = $state<string | null>(null);
  let pages = $state<PageWithContent[]>([]);

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
      const { pages: list } = await api.listWikiPages();
      const contents = await Promise.all(
        list.map(async (p) => {
          try {
            const c = await api.getWikiPage(p.path);
            return { ...p, content: c.content };
          } catch {
            return { ...p, content: "" };
          }
        })
      );
      pages = contents;
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  });

  // Aggregate pages into entities.
  // - For "projects": one entity per project (grouping all files under it).
  // - For other categories: each page is its own entity (they're already flat).
  function pageToEntityId(p: WikiPage): string {
    if (p.category === "projects") {
      const first = p.name.split("/")[0];
      return `projects/${first}`;
    }
    return p.path;
  }

  function pageToEntityLabel(p: WikiPage): string {
    if (p.category === "projects") return p.name.split("/")[0];
    return p.name;
  }

  $effect(() => {
    if (!container || loading || error || pages.length === 0) return;
    if (cy) {
      cy.destroy();
      cy = null;
    }

    const entities = new Map<string, Entity>();
    for (const p of pages) {
      const id = pageToEntityId(p);
      if (!entities.has(id)) {
        entities.set(id, {
          id,
          category: p.category,
          label: pageToEntityLabel(p),
          pages: [],
        });
      }
      entities.get(id)!.pages.push(p.path);
    }

    const nodes = Array.from(entities.values()).map((e) => ({
      data: {
        id: e.id,
        label: e.pages.length > 1 ? `${e.label} (${e.pages.length})` : e.label,
        category: e.category,
        pageCount: e.pages.length,
      },
    }));

    // Build edges between entities based on wiki links within their pages.
    // A link from page A → page B becomes an edge entity(A) → entity(B).
    const edgeSet = new Map<string, { source: string; target: string }>();
    for (const page of pages) {
      const sourceEntity = pageToEntityId(page);
      const linkRegex = /\]\(([^)]+\.md)\)/g;
      let match;
      while ((match = linkRegex.exec(page.content)) !== null) {
        const clean = match[1].replace(/^\.\.\//, "").replace(/^\.\//, "");
        const targetPage = pages.find(
          (p) => p.path === clean || p.path.endsWith(clean)
        );
        if (!targetPage) continue;
        const targetEntity = pageToEntityId(targetPage);
        if (sourceEntity === targetEntity) continue;
        const key = `${sourceEntity}->${targetEntity}`;
        if (!edgeSet.has(key)) {
          edgeSet.set(key, { source: sourceEntity, target: targetEntity });
        }
      }
    }

    const edges = Array.from(edgeSet.entries()).map(([id, e]) => ({
      data: { id, source: e.source, target: e.target },
    }));

    cy = cytoscape({
      container,
      elements: [...nodes, ...edges],
      minZoom: 0.3,
      maxZoom: 1.5,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) =>
              categoryColors[ele.data("category")] ?? "#888",
            label: "data(label)",
            color: "#e5e5e5",
            "font-size": 12,
            "font-family": "Inter, sans-serif",
            "font-weight": 500,
            "text-outline-color": "#0a0a0a",
            "text-outline-width": 2,
            "text-margin-y": 4,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-wrap": "ellipsis",
            "text-max-width": 140,
            width: (ele: any) => 20 + Math.min(ele.data("pageCount") ?? 1, 8) * 3,
            height: (ele: any) => 20 + Math.min(ele.data("pageCount") ?? 1, 8) * 3,
            "border-width": 2,
            "border-color": "#0a0a0a",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#404040",
            "target-arrow-color": "#404040",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.8,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#ff8c42",
          },
        },
        {
          selector: "node:active",
          style: { "overlay-opacity": 0.1, "overlay-color": "#ff8c42" },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        padding: 60,
        fit: true,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 120,
        randomize: false,
      },
    });

    // Clamp initial zoom so labels stay readable on small graphs
    if (cy.zoom() > 1.2) cy.zoom(1.2);
    cy.center();

    cy.on("tap", "node", (evt) => {
      const entityId = evt.target.id();
      const entity = entities.get(entityId);
      if (!entity) return;
      // For project entities, prefer context.md, then first alphabetically.
      if (entity.category === "projects") {
        const context = entity.pages.find((p) => p.endsWith("/context.md"));
        const target = context ?? entity.pages.slice().sort()[0];
        if (target) navigate(`/hive/page/${target}`);
      } else {
        navigate(`/hive/page/${entity.pages[0]}`);
      }
    });
  });

  function fit() {
    if (cy) {
      cy.fit(undefined, 60);
      if (cy.zoom() > 1.2) cy.zoom(1.2);
    }
  }
</script>

<div class="h-screen flex flex-col">
  <div class="border-b border-neutral-800 p-4 flex items-center justify-between">
    <div>
      <h1 class="text-lg font-semibold">Graph</h1>
      <p class="text-xs text-neutral-500">
        {#if !loading && !error}
          {pages.length} pages · aggregated by entity · click a node to open
        {:else}
          Click a node to open the page.
        {/if}
      </p>
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

  <div class="flex-1 relative bg-neutral-950">
    <div bind:this={container} class="absolute inset-0"></div>
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-500 pointer-events-none">
        Loading graph...
      </div>
    {:else if error}
      <div class="absolute inset-0 flex items-center justify-center p-8">
        <div class="card border-red-900 bg-red-950/30 text-red-200 text-sm max-w-md">{error}</div>
      </div>
    {:else if pages.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
        No pages yet. Feed knowledge to populate the graph.
      </div>
    {/if}
  </div>
</div>
