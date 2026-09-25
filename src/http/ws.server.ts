import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isTrusted } from "./guard.server.ts";
import { subscribe } from "./hub.server.ts";

/**
 * Serve live updates on `/ws` of an HTTP server. With `exclusive`, other upgrade requests are refused;
 * without it they are left alone, for Vite's HMR socket in development.
 */
export function attachUpdates(server: Server, bindHost: string, exclusive: boolean) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws") {
      if (exclusive) socket.destroy();
      return;
    }
    if (!isTrusted(url, req.headers.origin, bindHost)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const off = subscribe((data) => ws.readyState === WebSocket.OPEN && ws.send(data));
      ws.on("close", off);
      ws.on("error", off);
    });
  });
}
