import { anthropic } from "./anthropic.server";
import { ark } from "./ark.server";
import { cline } from "./cline.server";
import { codebuddy } from "./codebuddy.server";
import { dashscope } from "./dashscope.server";
import { generic } from "./generic.server";
import { google } from "./google.server";
import { helicone } from "./helicone.server";
import { kilo } from "./kilo.server";
import { kimi } from "./kimi.server";
import { litellm } from "./litellm.server";
import { mimo } from "./mimo.server";
import { minimax } from "./minimax.server";
import { openai } from "./openai.server";
import { opencode } from "./opencode.server";
import { openrouter } from "./openrouter.server";
import { portkey } from "./portkey.server";
import { xai } from "./xai.server";
import { zed } from "./zed.server";
import type { Headers, Identity, ProviderDef } from "./types.server";

export type { Identity, ProviderDef } from "./types.server";

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
  zed,
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
