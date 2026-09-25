export interface SSEEvent {
  event?: string;
  data: string;
}

/** Parse a complete text/event-stream body into events. */
export function parseSSE(body: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let event: string | undefined;
  let data: string[] = [];
  const flush = () => {
    if (data.length) events.push({ event, data: data.join("\n") });
    event = undefined;
    data = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    if (raw === "") {
      flush();
      continue;
    }
    if (raw.startsWith(":")) continue;
    const idx = raw.indexOf(":");
    const field = idx === -1 ? raw : raw.slice(0, idx);
    let value = idx === -1 ? "" : raw.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  flush();
  return events;
}

/** Parse SSE data payloads as JSON, skipping `[DONE]` and junk. */
export function sseJSON(body: string): { event?: string; json: any }[] {
  const out: { event?: string; json: any }[] = [];
  for (const e of parseSSE(body)) {
    if (e.data === "[DONE]") continue;
    try {
      out.push({ event: e.event, json: JSON.parse(e.data) });
    } catch {
      // ignore non-JSON payloads
    }
  }
  return out;
}

/**
 * Zed's cloud streams newline-delimited JSON: `{"event": <upstream event>}` lines plus
 * `{"status": …}` lines of its own. Re-encode the upstream events as SSE so the provider
 * parsers can read them. Returns undefined for anything else.
 */
export function zedStreamToSSE(body: string): string | undefined {
  if (!/^\s*\{"(event|status)":/.test(body)) return undefined;
  let out = "";
  for (const line of body.split(/\r?\n/)) {
    const json = tryJSON(line.trim());
    if (json?.event !== undefined) out += `data: ${JSON.stringify(json.event)}\n\n`;
  }
  return out;
}

export function looksLikeSSE(body: string, contentType?: string): boolean {
  if (contentType?.includes("text/event-stream")) return true;
  return /^(event|data):/m.test(body.slice(0, 200));
}

export function tryJSON(text: string | undefined): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
