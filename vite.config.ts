import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, isRunnableDevEnvironment, type Plugin } from "vite";
import { attachUpdates } from "./src/http/ws.server.ts";

/**
 * Development only: serve live updates on `/ws` next to Vite's HMR socket, and start the backend
 * (spool import, pruning) right away instead of on the first request.
 * `bin/mitllmproxy` does the same for the production build.
 */
function devBackend(): Plugin {
  return {
    name: "mitllmproxy:dev-backend",
    apply: "serve",
    configureServer(server) {
      // Its own database, so the dev server can run next to `npm start`.
      process.env.MITLLMPROXY_DB ??= resolve("mitllmproxy-dev.db");
      const host = typeof server.config.server.host === "string" ? server.config.server.host : "127.0.0.1";
      process.env.MITLLMPROXY_HOST ??= host;
      if (!server.httpServer) return;
      attachUpdates(server.httpServer as import("node:http").Server, host, false);
      server.httpServer.once("listening", async () => {
        const ssr = server.environments.ssr;
        if (!isRunnableDevEnvironment(ssr)) return;
        const { getBackend } = await ssr.runner.import<typeof import("./src/backend.server")>("/src/backend.server.ts");
        const backend = getBackend();
        console.log(`  database:  ${backend.store.db.filename}`);
      });
    },
  };
}

export default defineConfig({
  server: { port: 4546, host: "127.0.0.1", strictPort: true },
  plugins: [tanstackStart(), react(), babel({ presets: [reactCompilerPreset()] }), devBackend()],
  // One app bundle, served from localhost.
  build: { chunkSizeWarningLimit: 2000 },
});
