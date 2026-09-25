"""
mitllmproxy mitmproxy addon.

Filters flows by the URL patterns in config/capture-urls.json (fixed, shipped
with the package) and queues matching
ones as JSON files in a spool directory next to the database (`<db>-spool/`). The
server imports and deletes them whenever it runs, so capturing works without it.
Stdlib only (mitmproxy's binary builds don't even ship sqlite3), so it runs inside
mitmproxy's own environment without installing anything.

OpenAI Responses over WebSocket (Codex's `wss://chatgpt.com/backend-api/codex/responses`)
is captured too: each `response.create` frame and the server events answering it become one
request, with the events re-encoded as SSE.

The addon never holds traffic back. Captured bodies are streamed through as they arrive
(mitmproxy would otherwise read each one in full before forwarding it, so a streamed LLM
response would reach the client all at once), with a copy kept on the side. Hooks only take
references; decoding and encoding happen on the writer thread. The copies and the write
queue are both capped, so a huge body or a stalled disk drops captures instead of growing
memory.

    mitmdump -s addon/mitllmproxy_addon.py
    mitmweb  -s addon/mitllmproxy_addon.py

Environment overrides:
    MITLLMPROXY_DB  path to the SQLite database; events go to "<db>-spool/"
                    (default: ~/.mitllmproxy/mitllmproxy.db)
"""

from __future__ import annotations

import base64
import fnmatch
import json
import logging
import os
import queue
import re
import threading
import time
from pathlib import Path

from mitmproxy import http
from mitmproxy.net import encoding

WS_FINAL = {"response.completed", "response.failed", "response.incomplete", "error"}
# A frame's "type" when it's the first key (as OpenAI and Codex send it), read without parsing
# the whole frame; anything else falls back to json.loads.
WS_TYPE = re.compile(r'\s*\{\s*"type"\s*:\s*"([\w.\-]*)"\s*[,}]')

log = logging.getLogger("mitllmproxy")

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "capture-urls.json"
DEFAULT_DB = Path.home() / ".mitllmproxy" / "mitllmproxy.db"
# Largest body copied per request or response; bigger ones still pass through, but uncaptured.
MAX_BODY_COPY = 64 * 1024 * 1024
# Bytes of bodies waiting in the write queue; events past this are dropped.
MAX_QUEUED_BYTES = 256 * 1024 * 1024
REDACT_HEADERS = {
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "x-goog-api-key",
    "api-key",
    "cookie",
    "set-cookie",
}


def _compile(pattern: str):
    if pattern.startswith("re:"):
        rx = re.compile(pattern[3:])
        return lambda full, short: bool(rx.search(full))
    glob = re.compile(fnmatch.translate(pattern.split("://", 1)[-1]))
    return lambda full, short: glob.match(short) is not None


class Config:
    def __init__(self, path: Path):
        self.include: list = []
        self.exclude: list = []
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError) as e:
            log.warning("mitllmproxy: failed to read config at %s: %s", path, e)
            return
        self.include = [_compile(p) for p in data.get("urls", [])]
        self.exclude = [_compile(p) for p in data.get("ignore", [])]
        log.info("mitllmproxy: loaded %d url patterns from %s", len(self.include), path)

    def matches(self, url: str) -> bool:
        full = url
        short = url.split("://", 1)[-1].split("?", 1)[0]
        if any(m(full, short) for m in self.exclude):
            return False
        return any(m(full, short) for m in self.include)


def _headers(h) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in h.items(multi=True):
        lk = k.lower()
        if lk in REDACT_HEADERS:
            v = "[redacted]"
        out[lk] = f"{out[lk]}, {v}" if lk in out else v
    return out


class _Body:
    """A body as the hook saw it: the raw bytes (immutable, not copied) and their content-encoding.
    Decoded into the event on the writer thread."""

    __slots__ = ("raw", "enc", "size")

    def __init__(self, raw: bytes, enc: str) -> None:
        self.raw = raw
        self.enc = enc
        self.size = len(raw)

    def encode(self) -> dict:
        content = self.raw
        if self.enc and self.enc != "identity":
            try:
                content = encoding.decode(self.raw, self.enc)
            except Exception:
                pass
        try:
            return {"text": content.decode("utf-8")}
        except UnicodeDecodeError:
            return {"base64": base64.b64encode(content).decode("ascii")}


class _SSE:
    """A WebSocket turn's server events, re-encoded as SSE on the writer thread."""

    __slots__ = ("events", "size")

    def __init__(self, events: list, size: int) -> None:
        self.events = events
        self.size = size

    def encode(self) -> dict:
        out = []
        for t, text in self.events:
            if t:
                out.append(f"event: {t}\n")
            out.append("data: " + text.replace("\n", " ") + "\n\n")
        return {"text": "".join(out)}


class _WSRequest:
    """A `response.create` frame, turned into a request body (the frame minus "type") on the writer thread."""

    __slots__ = ("text", "data", "size")

    def __init__(self, text: str, data: dict | None) -> None:
        self.text = text
        self.data = data  # already parsed if the hook had to
        self.size = len(text)

    def encode(self) -> dict:
        data = self.data
        if data is None:
            try:
                data = json.loads(self.text)
            except ValueError:
                return {"text": self.text}
        data.pop("type", None)
        return {"text": json.dumps(data)}


_LAZY = (_Body, _SSE, _WSRequest)


def _body(msg: http.Message | None) -> _Body | None:
    if msg is None or msg.raw_content is None:
        return None
    return _Body(msg.raw_content, msg.headers.get("content-encoding", "").strip().lower())


def _size(event: dict) -> int:
    n = 0
    for k in ("request_body", "response_body"):
        v = event.get(k)
        if isinstance(v, _LAZY):
            n += v.size
    return n


def _copier(flow: http.HTTPFlow, side: str):
    """A stream callback: forwards every chunk unchanged, and keeps a copy of up to MAX_BODY_COPY
    bytes in the flow's metadata. Past that the copy is dropped and the body isn't captured.
    Chunks are kept by reference and joined once at the end."""
    key = f"mitllmproxy_{side}"
    chunks = flow.metadata[key] = []
    size = 0

    def copy(chunk: bytes) -> bytes:
        nonlocal chunks, size
        if chunks is not None and chunk:
            size += len(chunk)
            if size > MAX_BODY_COPY:
                log.warning("mitllmproxy: %s body over %d bytes, not capturing it", side, MAX_BODY_COPY)
                chunks = flow.metadata[key] = None
            else:
                chunks.append(chunk)
        return chunk

    return copy


def _restore(flow: http.HTTPFlow, side: str) -> None:
    """Put the copied body back on the message once it has passed (a streamed message is otherwise
    empty), so mitmweb shows it and the hooks can read it. The copy is released."""
    key = f"mitllmproxy_{side}"
    if key not in flow.metadata:
        return
    chunks = flow.metadata.pop(key)
    msg = flow.request if side == "req" else flow.response
    if msg is not None and chunks is not None:
        msg.raw_content = b"".join(chunks)


class MitLlmProxy:
    def __init__(self) -> None:
        self.config = Config(CONFIG_PATH)
        self.q: queue.Queue[tuple[dict, int]] = queue.Queue()
        self.queued_bytes = 0
        self.lock = threading.Lock()
        self.failing = False
        self.spool = self._spool_dir()
        threading.Thread(target=self._worker, name="mitllmproxy-writer", daemon=True).start()

    # ---- writing -------------------------------------------------------

    @staticmethod
    def _spool_dir() -> Path:
        env = os.environ.get("MITLLMPROXY_DB")
        db = Path(env).expanduser() if env else DEFAULT_DB
        return db.with_name(db.name + "-spool")

    def _worker(self) -> None:
        seq = 0
        pid = os.getpid()
        spool = self.spool
        while True:
            event, size = self.q.get()
            try:
                for k in ("request_body", "response_body"):
                    if isinstance(event.get(k), _LAZY):
                        event[k] = event[k].encode()
                data = json.dumps(event)
                # Names sort in write order; write to a dotfile then rename so the server never sees partial files.
                seq += 1
                name = f"{time.time_ns():020d}-{pid}-{seq:08d}.json"
                tmp = spool / f".{name}.tmp"
                try:
                    tmp.write_text(data, encoding="utf-8")
                except FileNotFoundError:  # first write, or the directory was removed
                    spool.mkdir(parents=True, exist_ok=True)
                    tmp.write_text(data, encoding="utf-8")
                os.replace(tmp, spool / name)
                if self.failing:
                    log.info("mitllmproxy: writing to %s again", spool)
                    self.failing = False
            except Exception as e:  # never let the writer thread die
                if not self.failing:
                    log.warning("mitllmproxy: cannot write to %s (%s); dropping events until it works", spool, e)
                    self.failing = True
            finally:
                # Release the references; `data` may be unset if encoding failed.
                event = data = None
                with self.lock:
                    self.queued_bytes -= size

    def _send(self, event: dict) -> None:
        size = _size(event)
        with self.lock:
            if self.queued_bytes + size > MAX_QUEUED_BYTES:
                log.warning("mitllmproxy: write queue over %d bytes, dropping event", MAX_QUEUED_BYTES)
                return
            self.queued_bytes += size
        self.q.put_nowait((event, size))

    # ---- helpers -------------------------------------------------------

    def _base(self, flow: http.HTTPFlow, state: str) -> dict:
        req = flow.request
        return {
            "flow_id": flow.id,
            "state": state,
            "method": req.method,
            "url": req.pretty_url,
            "started_at": req.timestamp_start,
            "request_headers": _headers(req.headers),
            "request_body": _body(req),
        }

    def _want(self, flow: http.HTTPFlow) -> bool:
        if flow.metadata.get("mitllmproxy") is not None:
            return flow.metadata["mitllmproxy"]
        req = flow.request
        ws = req.method == "GET" and req.headers.get("upgrade", "").lower() == "websocket"
        ok = (req.method == "POST" or ws) and self.config.matches(req.pretty_url)
        flow.metadata["mitllmproxy"] = ok
        flow.metadata["mitllmproxy_ws"] = ok and ws
        return ok

    @staticmethod
    def _is_ws(flow: http.HTTPFlow) -> bool:
        return bool(flow.metadata.get("mitllmproxy_ws"))

    @staticmethod
    def _ws_headers(flow: http.HTTPFlow) -> tuple[str, dict, dict]:
        """The handshake's URL and headers, shared by every turn (the event dicts are only read)."""
        cached = flow.metadata.get("mitllmproxy_ws_headers")
        if cached is None:
            resp = _headers(flow.response.headers) if flow.response is not None else {}
            resp["content-type"] = "text/event-stream"
            cached = flow.metadata["mitllmproxy_ws_headers"] = (flow.request.pretty_url, _headers(flow.request.headers), resp)
        return cached

    def _ws_event(self, flow: http.HTTPFlow, turn: dict, state: str) -> dict:
        """One WebSocket turn as the event an HTTP request would produce. `turn` is no longer
        changed once a non-pending event is made from it."""
        url, req_headers, resp_headers = self._ws_headers(flow)
        event = {
            "flow_id": turn["flow_id"],
            "state": state,
            "method": "POST",
            "url": url,
            "started_at": turn["started_at"],
            "request_headers": req_headers,
            "request_body": turn["body"],
        }
        if state == "pending":
            return event
        event.update(
            {
                "status": 200,
                "response_started_at": turn["response_started_at"],
                "ended_at": turn["ended_at"] or time.time(),
                "response_headers": resp_headers,
                "response_body": _SSE(turn["events"], turn["size"]) if turn["events"] is not None else None,
            }
        )
        return event

    def _ws_close_turn(self, flow: http.HTTPFlow, error: str) -> None:
        turn = flow.metadata.pop("mitllmproxy_turn", None)
        if turn is None:
            return
        event = self._ws_event(flow, turn, "error")
        event["error"] = error
        if not turn["events"]:
            for k in ("status", "response_started_at", "response_headers", "response_body"):
                event.pop(k)
        self._send(event)

    # ---- mitmproxy hooks -----------------------------------------------

    def requestheaders(self, flow: http.HTTPFlow) -> None:
        if self._want(flow) and not self._is_ws(flow):
            flow.request.stream = _copier(flow, "req")

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        if self._want(flow) and not self._is_ws(flow) and flow.response is not None:
            flow.response.stream = _copier(flow, "resp")

    def request(self, flow: http.HTTPFlow) -> None:
        # With streaming on, this fires once the whole request body has passed.
        if self._want(flow) and not self._is_ws(flow):
            _restore(flow, "req")
            self._send(self._base(flow, "pending"))

    def response(self, flow: http.HTTPFlow) -> None:
        if not self._want(flow) or self._is_ws(flow):
            return
        _restore(flow, "resp")
        resp = flow.response
        event = self._base(flow, "done")
        event.update(
            {
                "status": resp.status_code,
                "response_started_at": resp.timestamp_start,
                "ended_at": resp.timestamp_end or time.time(),
                "response_headers": _headers(resp.headers),
                "response_body": _body(resp),
            }
        )
        self._send(event)

    def error(self, flow: http.HTTPFlow) -> None:
        if not self._want(flow):
            return
        if self._is_ws(flow):
            self._ws_close_turn(flow, str(flow.error) if flow.error else "websocket error")
            return
        _restore(flow, "req")
        _restore(flow, "resp")
        event = self._base(flow, "error")
        event["error"] = str(flow.error) if flow.error else "unknown error"
        event["ended_at"] = time.time()
        if flow.response is not None:
            event["status"] = flow.response.status_code
            event["response_started_at"] = flow.response.timestamp_start
            event["response_headers"] = _headers(flow.response.headers)
            event["response_body"] = _body(flow.response)
        self._send(event)

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        if not self._is_ws(flow) or flow.websocket is None:
            return
        msg = flow.websocket.messages[-1]
        if not msg.is_text:
            return
        text = msg.text
        data = None
        m = WS_TYPE.match(text)
        if m:
            kind = m.group(1)
        else:
            try:
                data = json.loads(text)
            except ValueError:
                pass
            kind = data.get("type") if isinstance(data, dict) else None
        if msg.from_client:
            if kind != "response.create":
                return
            self._ws_close_turn(flow, "superseded by a new response.create")
            seq = flow.metadata.get("mitllmproxy_seq", 0) + 1
            flow.metadata["mitllmproxy_seq"] = seq
            turn = {
                "flow_id": f"{flow.id}-ws{seq}",
                "started_at": msg.timestamp,
                "body": _WSRequest(text, data),
                "events": [],
                "size": 0,
                "response_started_at": None,
                "ended_at": None,
            }
            flow.metadata["mitllmproxy_turn"] = turn
            self._send(self._ws_event(flow, turn, "pending"))
            return
        turn = flow.metadata.get("mitllmproxy_turn")
        if turn is None:
            return
        if turn["events"] is not None:
            turn["size"] += len(text)
            if turn["size"] > MAX_BODY_COPY:
                log.warning("mitllmproxy: websocket response over %d bytes, not capturing it", MAX_BODY_COPY)
                turn["events"] = None
            else:
                turn["events"].append((kind if isinstance(kind, str) else None, text))
        if turn["response_started_at"] is None:
            turn["response_started_at"] = msg.timestamp
        if kind in WS_FINAL:
            turn["ended_at"] = msg.timestamp
            del flow.metadata["mitllmproxy_turn"]
            self._send(self._ws_event(flow, turn, "done"))

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        if not self._is_ws(flow):
            return
        ws = flow.websocket
        reason = (ws.close_reason if ws is not None else None) or (str(flow.error) if flow.error else None)
        self._ws_close_turn(flow, reason or "websocket closed")


addons = [MitLlmProxy()]
