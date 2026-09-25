type Listener = (data: string) => void;

/**
 * Live-update listeners, one per open `/ws` socket. Kept on globalThis because in development the
 * websocket server lives in Vite's own module graph while the API runs in its SSR module runner,
 * and both have to see the same set.
 */
const listeners: Set<Listener> = ((globalThis as { [k: symbol]: Set<Listener> })[Symbol.for("mitllmproxy.listeners")] ??= new Set());

export function publish(message: unknown) {
  const data = JSON.stringify(message);
  for (const send of listeners) send(data);
}

export function subscribe(send: Listener): () => void {
  listeners.add(send);
  return () => listeners.delete(send);
}
