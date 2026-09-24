# mitllmproxy

A live viewer for the LLM calls your agents make, captured through mitmproxy.

Agents resend the whole conversation on every turn, so mitllmproxy groups those requests into one **session** and shows only the **latest** request. That request already holds the full history plus the newest response. Older requests are still available from the "Request N of N" picker.

Supported APIs: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and Gemini `generateContent` (including Gemini CLI's `cloudcode-pa` wrapper). Both streaming (SSE) and non-streaming responses are supported.

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

In a group, the longest non-subagent conversation is the main session and the only one listed in the sidebar. Its subagents, side calls and other threads (such as the one started after `/clear`) are linked from its header, and each links back. Deleting the main session deletes the whole group. Use **Hide one-off calls** to hide single-request sessions.

`Authorization`, `x-api-key`, `x-goog-api-key` and cookies are redacted in the addon before anything leaves mitmproxy.

## Development

```sh
bun test          # parser + session-grouping tests
bun run typecheck
bun run dev       # server with hot reload on the dev port
bun run dev:replay
```

The dev server runs alongside `bun start` without touching it:

|          | `bun start`      | `bun run dev`        |
| -------- | ---------------- | -------------------- |
| UI       | :4545            | :4546                |
| Database | `~/.mitllmproxy/mitllmproxy.db` | `mitllmproxy-dev.db` |

Both are just `bin/mitllmproxy.ts` with different flags — see `package.json`'s `start`/`dev` scripts.

To send real traffic to the dev build, run a second mitmproxy on another port with the addon pointed at the dev server:

```sh
MITLLMPROXY_DB="$PWD/mitllmproxy-dev.db" mitmdump -p 9080 -s "$(bun bin/mitllmproxy.ts addon-path)"
```

Layout:

- `addon/`: the mitmproxy addon.
- `config/`: the built-in capture patterns, read by the addon.
- `server/parsers/`: one normalizer per API, all producing a common block model.
- `server/providers/`: one module per provider or router, reading the session id its clients declare.
- `server/sessions.ts`: the grouping logic.
- `server/store.ts`: SQLite storage.
- `web/`: the React UI, bundled by Bun's HTML imports.
