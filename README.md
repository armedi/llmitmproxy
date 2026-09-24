# mitllmproxy

A live viewer for the LLM calls your agents make, captured through mitmproxy.

Agents resend the whole conversation on every turn, so mitllmproxy groups those requests into one **session** and shows only the **latest** request. That request already holds the full history plus the newest response. Older requests are still available from the "Request N of N" picker.

Supported APIs: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and Gemini `generateContent` (including Gemini CLI's `cloudcode-pa` wrapper). Both streaming (SSE) and non-streaming responses are supported.

```
client ──HTTPS_PROXY──▶ mitmproxy + addon/mitllmproxy_addon.py ──POST /ingest──▶ bun server (:4545) ──ws──▶ UI
```

## Why an addon (and not mitmweb's API)

The addon hook API (`-s script.py`) is mitmproxy's stable, documented extension point. It receives every complete flow as it happens, with no polling and no auth.

mitmweb's REST and WebSocket API is internal to its own frontend. It needs a token, changes between releases, and requires fetching each body separately.

The addon uses only the standard library, so nothing needs to be installed into mitmproxy's environment. It works under `mitmdump`, `mitmweb` or `mitmproxy`.

## Run

```sh
bun install
bun start            # UI + ingest server on http://127.0.0.1:4545
```

mitllmproxy doesn't run mitmproxy for you. To install and run it, follow mitmproxy's own docs:

- [Installation](https://docs.mitmproxy.org/stable/overview/installation/)
- [Getting started](https://docs.mitmproxy.org/stable/overview/getting-started/)
- [Installing the CA certificate](https://docs.mitmproxy.org/stable/concepts/certificates/)

### Load the addon

Load `addon/mitllmproxy_addon.py` into mitmproxy with its `scripts` option. Use the absolute path to the file:

- **Every start (recommended):** add it to `~/.mitmproxy/config.yaml`. See [mitmproxy's options docs](https://docs.mitmproxy.org/stable/concepts/options/).

  ```yaml
  scripts:
    - /path/to/mitllmproxy/addon/mitllmproxy_addon.py
  ```

- **One run:** pass `-s /path/to/mitllmproxy/addon/mitllmproxy_addon.py` to `mitmdump`, `mitmweb` or `mitmproxy`.
- **While it's running:** in mitmweb, go to Options → Edit Options → `scripts`. In the mitmproxy console, run `:set scripts=/path/...`. This replaces any scripts already set, so list those in the same command.

Only flows that arrive after the addon loads are captured. The addon reads `MITLLMPROXY_URL` and `MITLLMPROXY_CONFIG` from the environment of the mitmproxy process, not from your shell. The defaults (port 4545 and this repo's `mitllmproxy.config.json`) work without setting either one.

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

`NO_PROXY` keeps local traffic, such as the addon posting to the viewer, off the proxy. If mitmproxy stops, the tools that respect these variables lose network access until it's back or you `unset HTTP_PROXY HTTPS_PROXY`.

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
bun run dev       # server with hot reload on the dev port
bun run dev:replay
```

The dev server runs alongside `bun start` without touching it:

|          | `bun start`      | `bun run dev`        |
| -------- | ---------------- | -------------------- |
| UI       | :4545            | :4546                |
| Database | `mitllmproxy.db` | `mitllmproxy-dev.db` |

To send real traffic to the dev build, run a second mitmproxy on another port with the addon pointed at the dev server:

```sh
MITLLMPROXY_URL=http://127.0.0.1:4546/ingest mitmdump -p 9080 -s addon/mitllmproxy_addon.py
```

Both servers share `mitllmproxy.config.json`, so filter edits in either UI apply to both.

Layout:

- `addon/`: the mitmproxy addon.
- `server/parsers/`: one normalizer per API, all producing a common block model.
- `server/sessions.ts`: the grouping logic.
- `server/store.ts`: SQLite storage.
- `web/`: the React UI, bundled by Bun's HTML imports.
