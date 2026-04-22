<script lang="ts">
  import Layout from "./lib/Layout.svelte";
  import Dashboard from "./routes/Dashboard.svelte";
  import Profiles from "./routes/Profiles.svelte";
  import HiveBrowser from "./routes/HiveBrowser.svelte";
  import HiveFeed from "./routes/HiveFeed.svelte";
  import HiveQuery from "./routes/HiveQuery.svelte";
  import HiveGraph from "./routes/HiveGraph.svelte";
  import Stats from "./routes/Stats.svelte";
  import { currentRoute } from "./lib/stores";

  function matchRoute(route: string): {
    component: any;
    params: Record<string, string>;
  } {
    if (route === "/" || route === "") return { component: Dashboard, params: {} };
    if (route === "/profiles") return { component: Profiles, params: {} };
    if (route === "/hive") return { component: HiveBrowser, params: {} };
    if (route === "/hive/feed") return { component: HiveFeed, params: {} };
    if (route === "/hive/query") return { component: HiveQuery, params: {} };
    if (route === "/hive/graph") return { component: HiveGraph, params: {} };
    if (route === "/stats") return { component: Stats, params: {} };
    if (route.startsWith("/hive/page/")) {
      return { component: HiveBrowser, params: { path: route.slice("/hive/page/".length) } };
    }
    return { component: Dashboard, params: {} };
  }

  let matched = $derived(matchRoute($currentRoute));
  let Component = $derived(matched.component);
  let params = $derived(matched.params);
</script>

<Layout>
  <Component {...params} />
</Layout>
