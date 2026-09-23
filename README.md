# mitllmproxy

A live viewer for the LLM calls your agents make, captured through mitmproxy.

Agents resend the whole conversation on every turn, so mitllmproxy groups those requests into one **session** and shows only the **latest** request. That request already holds the full history plus the newest response. Older requests are still available from the "Request N of N" picker.

Supported APIs: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and Gemini `generateContent` (including Gemini CLI's `cloudcode-pa` wrapper). Both streaming (SSE) and non-streaming responses are supported.

```
client ──HTTPS_PROXY──▶ mitmdump -s addon/mitllmproxy_addon.py ──POST /ingest──▶ bun server (:4545) ──ws──▶ UI
```

## Why an addon (and not mitmweb's API)

The addon hook API (`-s script.py`) is mitmproxy's stable, documented extension point. It receives every complete flow as it happens, with no polling and no auth.

mitmweb's REST and WebSocket API is internal to its own frontend. It needs a token, changes between releases, and requires fetching each body separately.

The addon uses only the standard library, so nothing needs to be installed into mitmproxy's environment. It works under `mitmdump`, `mitmweb` or `mitmproxy`.

## Run

```sh
bun install
bun start            # server + proxy together: UI on http://127.0.0.1:4545, mitmdump on :8080
```

To run them separately, for example to use mitmweb instead of mitmdump:

```sh
bun run server       # UI + ingest server on http://127.0.0.1:4545
bun run proxy        # mitmdump on :8080 with the addon (or: bun run proxy:web for mitmweb)
```

Point a client at the proxy. The mitmproxy CA is at `~/.mitmproxy/mitmproxy-ca-cert.pem`, and is generated the first time mitmproxy runs.

```sh
# Claude Code / Node clients
HTTPS_PROXY=http://127.0.0.1:8080 NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem claude

# Python clients (openai, anthropic, httpx, requests)
HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem \
  REQUESTS_CA_BUNDLE=~/.mitmproxy/mitmproxy-ca-cert.pem python my_agent.py

# Codex CLI (Rust)
HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem codex
```

To use the addon with a mitmproxy you already run, add `-s /path/to/mitllmproxy/addon/mitllmproxy_addon.py`.

To try the UI without real traffic, run `bun run replay`. Add `--slow` to watch requests go from pending to done.

## Export

**Export** in the session header downloads a JSON file with the raw request and response, including headers and bodies:

- **Latest request + response:** the full conversation, as it was sent.
- **All N requests:** every request and response in the session.

JSON bodies are included as parsed objects. Streamed (SSE) responses stay as the raw event-stream text. Auth headers are already redacted. The same exports are available from `GET /api/sessions/:id/export?scope=latest|all`.

## Configure which URLs are captured

`mitllmproxy.config.json` (you can also edit it from **Filters** in the UI):

- `urls`: only POST requests matching one of these are captured.
  - A plain pattern is a glob matched against `host/path`, without the scheme or query. `*` matches anything, including `/`.
  - A pattern starting with `re:` is a regex searched in the full URL.
- `ignore`: patterns that are never captured, e.g. `count_tokens`.
- `port`, `db`: the server port and the SQLite file.

The addon reloads the file within a second of it changing, so you don't need to restart mitmproxy. To add a gateway such as LiteLLM, OpenRouter or an internal proxy, add its host and path. The provider is detected from the path, falling back to the shape of the request body.

## How sessions are grouped

1. **Scope:** requests are only compared with sessions that have the same provider, the same set of tool names, and the same explicit session id, if the request has one. Explicit ids come from Claude Code's `metadata.user_id`, and from `session_id` or `x-session-id` style headers.
2. **Prefix chain:** a request joins the most recent session whose latest request's messages are a prefix of its own messages.
   - Messages are canonicalized first. `cache_control` markers and thinking blocks are ignored, and tool calls are compared by id.
   - A rewritten last message is tolerated.
3. **OpenAI Responses `previous_response_id`:** these requests are linked to the request that produced that response, and its history is stitched in. The latest view still shows the whole conversation.
4. Anything else starts a new session. Compaction, rewinds, subagents and one-off calls (such as title generation) each get their own session. Use **Hide one-off calls** to hide single-request sessions.

`Authorization`, `x-api-key`, `x-goog-api-key` and cookies are redacted in the addon before anything leaves mitmproxy.

## Development

```sh
bun test          # parser + session-grouping tests
bun run typecheck
bun run dev       # server (hot reload) + proxy on dev ports
bun run dev:replay
```

The dev stack runs alongside `bun start` without touching it:

|          | `bun start`      | `bun run dev`        |
| -------- | ---------------- | -------------------- |
| UI       | :4545            | :4546                |
| Proxy    | :8080            | :9080                |
| Database | `mitllmproxy.db` | `mitllmproxy-dev.db` |

Point a client at `HTTPS_PROXY=http://127.0.0.1:9080` to send its traffic to the dev build. Both stacks share `mitllmproxy.config.json`, so filter edits in either UI apply to both.

Layout:

- `addon/`: the mitmproxy addon.
- `server/parsers/`: one normalizer per API, all producing a common block model.
- `server/sessions.ts`: the grouping logic.
- `server/store.ts`: SQLite storage.
- `web/`: the React UI, bundled by Bun's HTML imports.
