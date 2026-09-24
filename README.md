# mitllmproxy

A live viewer for the LLM calls your agents make, captured through mitmproxy.

Agents resend the whole conversation on every turn, so mitllmproxy groups those requests into one **session** and shows only the **latest** request. That request already holds the full history plus the newest response. Any single request can still be inspected in the **Raw** tab, which has a request picker.

Supported APIs: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and Gemini `generateContent` (including Gemini CLI's `cloudcode-pa` wrapper). Claude on Vertex AI (`:rawPredict` / `:streamRawPredict`) is also supported. Both streaming (SSE) and non-streaming responses are supported.

```
client ──HTTPS_PROXY──▶ mitmproxy + addon/mitllmproxy_addon.py ──JSON files──▶ ~/.mitllmproxy/mitllmproxy.db-spool/ ──import──▶ bun server (:4545) ──ws──▶ UI
```

The addon doesn't talk to the server. It queues each captured request as a JSON file in the spool directory next to the database (`<db>-spool/`). The server imports and deletes those files when it starts and every 300 ms while it runs. So capturing works whether or not the server is up: keep mitmproxy running and start the server only when you want the UI, and everything captured in the meantime shows up. The spool is plain files rather than SQLite because mitmproxy's binary builds don't ship Python's `sqlite3` module. Files that fail to import are renamed to `*.failed` and left in place for inspection.

## Why an addon (and not mitmweb's API)

The addon hook API (`-s script.py`) is mitmproxy's stable, documented extension point. It receives every complete flow as it happens, with no polling and no auth.

mitmweb's REST and WebSocket API is internal to its own frontend. It needs a token, changes between releases, and requires fetching each body separately.

The addon uses only the standard library, so nothing needs to be installed into mitmproxy's environment. It works under `mitmdump`, `mitmweb` or `mitmproxy`.

## Run

```sh
npm i -g mitllmproxy
mitllmproxy                 # UI server on http://127.0.0.1:4545
```

Or without installing globally: `bunx mitllmproxy` / `npx mitllmproxy`.

The server's port, bind address and database are set with flags. Run `mitllmproxy --help` for the full list:

```sh
mitllmproxy --port 5000 --db ./my.db
```

mitllmproxy doesn't run mitmproxy for you. To install and run it, follow mitmproxy's own docs:

- [Installation](https://docs.mitmproxy.org/stable/overview/installation/)
- [Getting started](https://docs.mitmproxy.org/stable/overview/getting-started/)
- [Installing the CA certificate](https://docs.mitmproxy.org/stable/concepts/certificates/)

### Load the addon

`mitllmproxy addon-path` prints the absolute path to the bundled `mitllmproxy_addon.py`, wherever npm installed it. Load it into mitmproxy with its `scripts` option:

- **Every start (recommended):** add it to `~/.mitmproxy/config.yaml`. See [mitmproxy's options docs](https://docs.mitmproxy.org/stable/concepts/options/).

  ```yaml
  scripts:
    - /path/to/mitllmproxy_addon.py   # output of `mitllmproxy addon-path`
  ```

- **One run:** `mitmdump -s "$(mitllmproxy addon-path)"` (also works with `mitmweb`/`mitmproxy`).
- **While it's running:** in mitmweb, go to Options → Edit Options → `scripts`. In the mitmproxy console, run `:set scripts=/path/...`. This replaces any scripts already set, so list those in the same command.

Captures are kept for 7 days, counted from when each request was made, not when it was imported. Older requests are deleted when the server starts and every 10 minutes after that. Spooled captures that are already too old are deleted without being imported. To change the retention, use `--retention 12h`, `--retention 2w` and so on, or `--retention off` to keep everything.

Only flows that arrive after the addon loads are captured. Captured data lives in `~/.mitllmproxy/`: the database `mitllmproxy.db` and the addon's spool `mitllmproxy.db-spool/`. If you start the server with `--db`, start mitmproxy with `MITLLMPROXY_DB` set to the same absolute path, since the spool directory is derived from the database path. The addon reads `MITLLMPROXY_DB` from the environment of the mitmproxy process, not from your shell, because mitmproxy loads the addon in its own Python process rather than through the `mitllmproxy` CLI.

### Point clients at the proxy

The examples below use mitmproxy's default port, 8080. Replace it with the port you run mitmproxy on. The CA certificate is at `~/.mitmproxy/mitmproxy-ca-cert.pem`, and mitmproxy generates it the first time it runs.

To route everything from your shell, add these to `~/.zshrc`:

```sh
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NO_PROXY=localhost,127.0.0.1,::1
export SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
```

`NO_PROXY` keeps local traffic, such as your browser opening the viewer, off the proxy. If mitmproxy stops, the tools that respect these variables lose network access until it's back or you `unset HTTP_PROXY HTTPS_PROXY`.

To route a single client instead:

```sh
# Claude Code / Node clients
HTTPS_PROXY=http://127.0.0.1:8080 NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem claude

# Python clients (openai, anthropic, httpx, requests)
HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem \
  REQUESTS_CA_BUNDLE=~/.mitmproxy/mitmproxy-ca-cert.pem python my_agent.py

# Codex CLI (Rust)
HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem codex
```

To try the UI without real traffic, run `bun run replay`. Add `--slow` to watch requests go from pending to done.


## The viewer

- **Sidebar:** each session shows a status dot, its client (Claude Code, Codex, Gemini CLI, …, detected from the user agent), model, request count, context tokens, estimated cost and last activity. The dot means:
  - pulsing green: working (a request is in flight or a tool is running)
  - tan: answered, waiting for you
  - amber: stopped after a tool call with nothing following
  - red: the last request failed

  Subagents and side calls expand under their main session. Group by client, model or API, and filter by API, client, errors or activity in the last 24 hours. Filters are kept in the URL. Drag the edge to resize.
- **Transcript:**
  - Each tool call shows a one-line summary (`$ bun test`, `src/app.ts (+12 −3)`, `3/5 done → next step`) with its result underneath.
  - Edit, MultiEdit, Write and `apply_patch` inputs are shown as diffs, with an **Args** toggle for the raw arguments.
  - Runs of tool-only turns collapse into one "N tool calls" block, and calls made together are bracketed as parallel.
  - Injected context (`<system-reminder>`, slash-command echoes, hook output) becomes a small collapsible card.
  - Each assistant message shows the request that produced it: duration, context and output tokens, cost, the model when it differs from the session's, and a link that opens that request in the Raw tab.
  - **Focused** shows only your prompts and the final answers.
  - The System prompt, Tools, Parameters and the **Raw** tab (headers, bodies, the normalized model) are all still there.
- **Stats** (right panel):
  - Duration, requests, errors, API and the agent's session ID.
  - Tokens split into input, cache read and cache write, the cache hit rate, and peak and current context with a per-request sparkline.
  - Estimated cost, including subagents and broken down by model.
  - Latency: p50, p90, average wait until the response starts, and the slowest request (click to open it in Raw).
  - Tool call counts.
- **Deleting** a session or all sessions always asks first, in a dialog that names what will be removed. Cancel has focus, so Enter or Esc backs out.
- **Themes:** light, dark, or follow the system (button in the sidebar header).

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous message |
| `J` / `K` | Next / previous user prompt |
| `]` / `[` | Next / previous session |
| `⌘F` / `Ctrl+F` | Find in the session, including collapsed tool input and output (Enter / Shift+Enter to step) |
| `t` | Conversation / Raw |
| `f` | Focused mode |
| `m` | Markdown / plain text |
| `v` | Stats panel |
| `b` | Sidebar |
| `Esc` | Close find, or in Raw go back to the latest request |
| `?` | All shortcuts |

### Cost estimates

Costs are estimates from list prices. They are computed from each response's token usage and the model it reports.

- **Prices:** the snapshot in `config/pricing.json`, generated from [LiteLLM's price catalog](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) with `bun run update-pricing`.
- **Long prompts:** for models whose price rises above a prompt size (e.g. 200k tokens), the higher rate is used.
- **Unknown models:** they are counted as "unpriced" instead of guessed.
- **Your own prices:** put a `pricing.json` next to the database (`~/.mitllmproxy/pricing.json`) in the same format, for example `{"models": {"my-model": {"input": 1, "output": 4, "cacheRead": 0.1}}}`. Prices are dollars per million tokens.
- **Updating:** stored costs are recomputed whenever the prices change.

Token counts are normalized so `input` never includes cached tokens. OpenAI and Gemini report cached tokens inside the prompt count; mitllmproxy subtracts them. Gemini's thinking tokens are counted as output, as they are billed.

## Export

**Export** in the session header downloads a JSON file with the raw request and response, including headers and bodies:

- **Latest request + response:** the full conversation, as it was sent.
- **All N requests:** every request and response in the session.

JSON bodies are included as parsed objects. Streamed (SSE) responses stay as the raw event-stream text. Auth headers are already redacted. The same exports are available from `GET /api/sessions/:id/export?scope=latest|all`.

## Which URLs are captured

The capture patterns ship with mitllmproxy in `config/capture-urls.json` and aren't user-configurable. The addon reads them once when it loads.

- `urls`: only POST requests matching one of these are captured.
  - A plain pattern is a glob matched against `host/path`, without the scheme or query. `*` matches anything, including `/`.
  - A pattern starting with `re:` is a regex searched in the full URL.
- `ignore`: patterns that are never captured, e.g. `count_tokens`.

Every provider in the table below has its hosts listed with the API endpoints it serves. Other hosts, such as a self-hosted LiteLLM or an internal gateway, are matched by endpoint path:

- `…/chat/completions`
- `…/v<N>/responses` and `…/v<N>/messages`. These need a version segment because the bare words are common in other APIs.
- `…/openai/deployments/<name>/chat/completions|responses` (Azure-style)
- `…:generateContent` and `…:streamGenerateContent`

Amazon Bedrock's OpenAI-compatible endpoints are captured. Its native endpoints (`invoke`, `converse` and their streaming variants) aren't, because they stream in AWS's binary event-stream format rather than SSE.

To support a new gateway such as LiteLLM, OpenRouter or an internal proxy, add its host and path to that file and release a new version. The provider is detected from the path, falling back to the shape of the request body.

## How sessions are grouped

1. **Agent session id:** when the client declares its own session id, it is stored as the session's `session_id`. All sessions with that id form one group. Each provider module in `server/providers/` knows its clients' conventions. The module for the request's host is asked first, then all the others, because gateways forward client headers:

   | Provider | Session | Subagent |
   |---|---|---|
   | Anthropic (Claude Code) | `x-claude-code-session-id`, then `metadata.user_id` | `x-claude-code-agent-id`, `x-claude-code-agent-type` |
   | OpenAI / ChatGPT (Codex, Cline, Roo, Pi) | `session-id`, `session_id`, `conversation_id` | Codex `thread-id`, `x-openai-subagent` |
   | Google (Gemini CLI) | body `request.session_id`, `user_prompt_id` prefix | |
   | OpenCode Zen / Go | `x-opencode-session` | `x-parent-session-id` |
   | Kilo gateway | `x-kilocode-taskid` | `x-kilocode-parent-taskid` |
   | Cline | `x-task-id` | |
   | OpenRouter | body `session_id` | |
   | Helicone | `helicone-session-id` | `helicone-session-path` |
   | LiteLLM | `x-litellm-session-id`, body `litellm_session_id`, `metadata.session_id` | |
   | Portkey | `x-portkey-trace-id` | |
   | xAI | `x-grok-conv-id` | |
   | DashScope / Model Studio (Qwen Code) | body `metadata.sessionId`, apps API `input.session_id` | |
   | Moonshot / Kimi (Kimi CLI) | body `prompt_cache_key`, on Kimi hosts only | |
   | MiniMax (MiniMax Code) | `x-mavis-session-id` | |
   | Tencent CodeBuddy | `x-conversation-id` | `x-parent-conversation-id`, `x-agent-type` |
   | Xiaomi MiMo (MiMo Code) | `x-session-affinity` from MiMo Code | `x-parent-session-id` |
   | Any host (opencode, Crush, Pi, Goose) | `x-session-id`, `agent-session-id` | `x-parent-session-id` |

   Only if none of these is found are approximate keys used:
   - body `prompt_cache_key` (OpenAI-compatible APIs)
   - the `x-session-affinity` header
   - a bare UUID in Anthropic `metadata.user_id` (Kimi CLI)
   - Volcengine Ark `session.id` / `context_id`

   Some providers have no session field of their own: Vercel AI Gateway, Cloudflare AI Gateway, Groq, Together, Bedrock, DeepSeek, Z.ai/GLM, Baidu Qianfan, Hunyuan, StepFun and SiliconFlow. Their `user` / `user_id` fields identify end users, not sessions. Requests to them are still grouped by whatever the client sends. For example, Z.ai's ZCode and iFlow CLI send `x-session-id` and `session-id`. ZCode subagents get their own session id with no parent pointer, so they show up as separate groups.
2. **Subagents:** requests with a subagent id join that subagent's own session, linked to the group.
3. **Prefix chain:** any other request joins the most recent session whose latest request's messages are a prefix of its own messages. With an agent session id, only that group's sessions are candidates. Without one, candidates must also have the same provider and set of tool names, and have been active in the last 24 hours.
   - Messages are canonicalized first. `cache_control` markers and thinking blocks are ignored, and tool calls are compared by id.
   - A rewritten last message is tolerated.
4. **OpenAI Responses `previous_response_id`:** these requests are linked to the request that produced that response, and its history is stitched in. The latest view still shows the whole conversation.
5. Anything else starts a new session. Compaction, rewinds, subagents and one-off calls (such as title generation) each get their own session.

In a group, the longest non-subagent conversation is the main session and the only one listed in the sidebar. Its subagents, side calls and other threads (such as the one started after `/clear`) expand under it in the sidebar and are linked from its header, and each links back. Deleting the main session deletes the whole group. Use **Hide one-off calls** to hide single-request sessions.

`Authorization`, `x-api-key`, `x-goog-api-key` and cookies are redacted in the addon before anything leaves mitmproxy.

## Development

```sh
bun test          # parser, session-grouping, pricing and transcript tests
bun run typecheck
bun run dev       # server with hot reload on the dev port
bun run dev:replay
bun run update-pricing   # refresh config/pricing.json from LiteLLM
```

The dev server runs alongside `bun start` without touching it:

|          | `bun start`      | `bun run dev`        |
| -------- | ---------------- | -------------------- |
| UI       | :4545            | :4546                |
| Database | `~/.mitllmproxy/mitllmproxy.db` | `mitllmproxy-dev.db` |

Both are just `bin/mitllmproxy` with different flags. See the `start` and `dev` scripts in `package.json`.

To send real traffic to the dev build, run a second mitmproxy on another port with the addon pointed at the dev server:

```sh
MITLLMPROXY_DB="$PWD/mitllmproxy-dev.db" mitmdump -p 9080 -s "$(bun bin/mitllmproxy addon-path)"
```

Layout:

- `addon/`: the mitmproxy addon.
- `config/`: the built-in capture patterns, read by the addon.
- `server/parsers/`: one normalizer per API, all producing a common block model.
- `server/providers/`: one module per provider or router, reading the session id its clients declare.
- `server/sessions.ts`: the grouping logic.
- `server/store.ts`: SQLite storage, with migrations that re-parse old captures and recompute costs.
- `server/pricing.ts`, `config/pricing.json`: cost estimates.
- `server/clients.ts`: detects the agent app from its headers.
- `web/`: the React UI, bundled by Bun's HTML imports. `web/transcript/` holds the pure display logic: pairing tool results, grouping, tool summaries, diffs and stats.
