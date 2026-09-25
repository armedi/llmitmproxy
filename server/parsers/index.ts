import { identify } from "../providers";
import type { IngestEvent, Normalized, NormalizedResponse, Provider } from "../types";
import * as anthropic from "./anthropic";
import * as gemini from "./gemini";
import * as openaiChat from "./openai-chat";
import * as openaiResponses from "./openai-responses";
import { looksLikeSSE, tryJSON, zedStreamToSSE } from "./sse";

export function bodyText(body: IngestEvent["request_body"]): string | undefined {
  if (!body) return undefined;
  if (body.text != null) return body.text;
  if (body.base64 != null) return Buffer.from(body.base64, "base64").toString("utf8");
  return undefined;
}

export function detectProvider(url: string, req: any, headers: Record<string, string> = {}): Provider {
  const path = url.split("?")[0] ?? "";
  if (/:(stream)?generateContent$/i.test(path)) return "gemini";
  if (/\/chat\/completions$/.test(path)) return "openai-chat";
  if (/\/responses$/.test(path)) return "openai-responses";
  if (/\/messages$/.test(path)) return "anthropic";
  // Body-shape fallback for gateways with custom paths.
  if (req?.contents || req?.request?.contents) return "gemini";
  if (req?.input !== undefined && req?.messages === undefined) return "openai-responses";
  if (Array.isArray(req?.messages)) {
    if (headers["anthropic-version"] || req.system !== undefined || req.anthropic_version) return "anthropic";
    return "openai-chat";
  }
  return "unknown";
}

type Parser = {
  parseRequest: (req: any, ctx: { url: string; headers: Record<string, string> }) => Omit<Normalized, "response">;
  parseResponseJSON: (res: any) => NormalizedResponse;
  parseResponseSSE: (body: string) => NormalizedResponse;
};

const parsers: Record<Exclude<Provider, "unknown">, Parser> = {
  anthropic: { ...anthropic, parseRequest: (r) => anthropic.parseRequest(r) },
  "openai-chat": { ...openaiChat, parseRequest: (r) => openaiChat.parseRequest(r) },
  "openai-responses": { ...openaiResponses, parseRequest: (r) => openaiResponses.parseRequest(r) },
  gemini: { ...gemini, parseRequest: (r, c) => gemini.parseRequest(r, c.url) },
};

function modelFromURL(url: string): string | undefined {
  const m = /\/models\/([^/:?]+):/.exec(url);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1];
  }
}

/** Zed's cloud wraps the upstream API request: `{ thread_id, provider, model, provider_request }`. */
function unwrapZed(req: any): any {
  return req && typeof req.provider === "string" && req.provider_request && typeof req.provider_request === "object"
    ? req.provider_request
    : req;
}

export function normalizeRequest(ev: IngestEvent): Normalized {
  const reqText = bodyText(ev.request_body);
  const envelope = tryJSON(reqText);
  const req = unwrapZed(envelope);
  const headers = ev.request_headers ?? {};
  const provider = detectProvider(ev.url, req, headers);
  let n: Normalized;
  if (provider === "unknown" || !req) {
    n = {
      provider: "unknown",
      params: {},
      system: [],
      tools: [],
      messages: reqText ? [{ role: "user", content: [{ type: "raw", label: "request", data: req ?? reqText }] }] : [],
    };
  } else {
    n = parsers[provider].parseRequest(req, { url: ev.url, headers });
  }
  // Vertex AI's Claude endpoints name the model only in the path: …/models/<id>:rawPredict.
  n.model ??= modelFromURL(ev.url);
  Object.assign(n, identify(ev.url, headers, envelope));
  return n;
}

export function normalizeResponse(provider: Provider, ev: IngestEvent): NormalizedResponse | undefined {
  let text = bodyText(ev.response_body);
  if (text == null) return ev.error ? { blocks: [], error: ev.error } : undefined;
  text = zedStreamToSSE(text) ?? text;
  const ct = ev.response_headers?.["content-type"];
  let out: NormalizedResponse;
  if (provider === "unknown") {
    out = { blocks: [{ type: "raw", label: "response", data: tryJSON(text) ?? text }] };
  } else if (looksLikeSSE(text, ct)) {
    out = parsers[provider].parseResponseSSE(text);
  } else {
    const json = tryJSON(text);
    out = json !== undefined ? parsers[provider].parseResponseJSON(json) : { blocks: [{ type: "text", text }] };
  }
  if (ev.status && ev.status >= 400 && !out.error) out.error = `HTTP ${ev.status}`;
  if (ev.error && !out.error) out.error = ev.error;
  return out;
}
