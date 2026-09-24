import { resolve } from "node:path";
import index from "../web/index.html";

const PAGES = ["/", "/session/:id", "/session/:id/request/:rid"];

/**
 * Routes that serve the web UI. Dev mode serves the HTML import so HMR works; otherwise the UI
 * is bundled with the React Compiler, which Bun only runs in `Bun.build`, not for HTML imports.
 */
export async function uiRoutes(dev: boolean) {
  if (dev) return Object.fromEntries(PAGES.map((p) => [p, index]));

  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../web/index.html")],
    target: "browser",
    minify: true,
    reactCompiler: true,
    // Pages are nested (/session/:id/...), so asset URLs must be absolute.
    publicPath: "/",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!build.success) throw new AggregateError(build.logs, "building the UI failed");

  const routes: Record<string, Response> = {};
  for (const out of build.outputs) {
    const body = await out.arrayBuffer();
    const headers = { "content-type": out.type };
    if (out.path.endsWith(".html")) for (const p of PAGES) routes[p] = new Response(body, { headers });
    else routes[out.path.replace(/^\.\//, "/")] = new Response(body, { headers });
  }
  return routes;
}
