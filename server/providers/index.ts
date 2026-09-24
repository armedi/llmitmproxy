import { anthropic } from "./anthropic";
import { ark } from "./ark";
import { cline } from "./cline";
import { codebuddy } from "./codebuddy";
import { dashscope } from "./dashscope";
import { generic } from "./generic";
import { google } from "./google";
import { helicone } from "./helicone";
import { kilo } from "./kilo";
import { kimi } from "./kimi";
import { litellm } from "./litellm";
import { mimo } from "./mimo";
import { minimax } from "./minimax";
import { openai } from "./openai";
import { opencode } from "./opencode";
import { openrouter } from "./openrouter";
import { portkey } from "./portkey";
import { xai } from "./xai";
import type { Headers, Identity, ProviderDef } from "./types";

export type { Identity, ProviderDef } from "./types";

/**
 * Every known provider. The one serving the URL goes first; the rest keep this order,
 * with the most specific header names first and the generic conventions last.
 */
export const PROVIDERS: ProviderDef[] = [
  anthropic,
  openai,
  google,
  opencode,
  kilo,
  cline,
  openrouter,
  helicone,
  litellm,
  portkey,
  xai,
  dashscope,
  kimi,
  minimax,
  codebuddy,
  mimo,
  ark,
  generic,
];

function parseURL(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * Read the client's declared session. The provider serving the URL is asked first. Gateways
 * forward the client's headers, so the other providers' conventions are tried next. The first
 * provider that finds a session id supplies the whole identity. Approximate keys are only used
 * when no provider finds a declared one.
 */
export function identify(url: string, headers: Headers, body: unknown): Identity {
  const u = parseURL(url);
  const own = u ? PROVIDERS.find((p) => p.match(u)) : undefined;
  const order = own ? [own, ...PROVIDERS.filter((p) => p !== own)] : PROVIDERS;
  for (const read of [(p: ProviderDef) => p.identify, (p: ProviderDef) => p.fallback]) {
    for (const p of order) {
      const id = read(p)?.(headers, body, p === own);
      if (id?.sessionId) return id;
    }
  }
  return {};
}
