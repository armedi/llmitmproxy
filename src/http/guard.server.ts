import { isIP } from "node:net";

/**
 * Whether a request may use the server. A web page can point its own hostname at 127.0.0.1
 * (DNS rebinding), which makes its requests same-origin; so only accept the names this server is
 * really reached by. Browsers send Origin on cross-site requests; tools like the replay script send
 * none. Without this, any web page could read the captures over /api and /ws or inject them via /ingest.
 */
export function isTrusted(url: URL, origin: string | null | undefined, bindHost: string): boolean {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname !== "localhost" && hostname !== bindHost && isIP(hostname) === 0) return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}
