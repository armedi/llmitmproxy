import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, isRunnableDevEnvironment, type Plugin } from "vite";
import { attachUpdates } from "./src/http/ws.server.ts";

/**
 * Development only: serve live updates on `/ws` next to Vite's HMR socket, and start the backend
 * (spool import, pruning) right away instead of on the first request. `mitllmproxy --dev` passes its
 * --db, --host and --retention flags in MITLLMPROXY_* variables; the production server gets them directly.
 */
function devBackend(): Plugin {
  return {
    name: "mitllmproxy:dev-backend",
    apply: "serve",
    configureServer(server) {
      const host = typeof server.config.server.host === "string" ? server.config.server.host : "127.0.0.1";
      process.env.MITLLMPROXY_HOST ??= host;
      if (!server.httpServer) return;
      attachUpdates(server.httpServer as import("node:http").Server, host, false);
      server.httpServer.once("listening", async () => {
        const ssr = server.environments.ssr;
        if (!isRunnableDevEnvironment(ssr)) return;
        const { describeBackend, getBackend } = await ssr.runner.import<typeof import("./src/backend.server")>("/src/backend.server.ts");
        console.log(describeBackend(getBackend()).replace(/^/gm, "  "));
      });
    },
  };
}

export default defineConfig({
  // Like the production server: --port, else $PORT, else TanStack Start's usual 3000; on localhost only.
  server: { port: Number(process.env.PORT) || 3000, host: "127.0.0.1" },
  plugins: [tanstackStart(), react(), babel({ presets: [reactCompilerPreset()] }), devBackend()],
  // One app bundle, served from localhost.
  build: { chunkSizeWarningLimit: 2000 },
});
