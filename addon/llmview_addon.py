"""
llmview mitmproxy addon.

Filters flows by the URL patterns in llmview.config.json and forwards matching
ones to the llmview server. Stdlib only, so it runs inside mitmproxy's own
environment without installing anything.

    mitmdump -s addon/llmview_addon.py
    mitmweb  -s addon/llmview_addon.py

Environment overrides:
    LLMVIEW_CONFIG  path to llmview.config.json (default: repo root)
    LLMVIEW_URL     ingest endpoint (default: http://127.0.0.1:<port>/ingest)
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
import urllib.error
import urllib.request
from pathlib import Path

from mitmproxy import http

log = logging.getLogger("llmview")

CONFIG_PATH = Path(
    os.environ.get("LLMVIEW_CONFIG")
    or Path(__file__).resolve().parent.parent / "llmview.config.json"
)
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
    glob = pattern.split("://", 1)[-1]
    return lambda full, short: fnmatch.fnmatchcase(short, glob)


class Config:
    def __init__(self, path: Path):
        self.path = path
        self.mtime = -1.0
        self.port = 4545
        self.include: list = []
        self.exclude: list = []
        self.checked = 0.0

    def refresh(self) -> None:
        now = time.monotonic()
        if now - self.checked < 1.0:
            return
        self.checked = now
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            if self.mtime == -1.0:
                log.warning("llmview: config not found at %s", self.path)
                self.mtime = -2.0
            return
        if mtime == self.mtime:
            return
        try:
            data = json.loads(self.path.read_text())
        except (OSError, ValueError) as e:
            log.warning("llmview: failed to read config: %s", e)
            return
        self.mtime = mtime
        self.port = int(data.get("port", 4545))
        self.include = [_compile(p) for p in data.get("urls", [])]
        self.exclude = [_compile(p) for p in data.get("ignore", [])]
        log.info("llmview: loaded %d url patterns from %s", len(self.include), self.path)

    def matches(self, url: str) -> bool:
        self.refresh()
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


def _body(msg: http.Message | None) -> dict | None:
    if msg is None or msg.raw_content is None:
        return None
    try:
        content = msg.get_content(strict=False) or b""
    except Exception:
        content = msg.raw_content or b""
    try:
        return {"text": content.decode("utf-8")}
    except UnicodeDecodeError:
        return {"base64": base64.b64encode(content).decode("ascii")}


class LLMView:
    def __init__(self) -> None:
        self.config = Config(CONFIG_PATH)
        self.q: queue.Queue[dict] = queue.Queue(maxsize=1000)
        self.down_since: float | None = None
        threading.Thread(target=self._worker, name="llmview-sender", daemon=True).start()

    # ---- sending -------------------------------------------------------

    def _endpoint(self) -> str:
        return os.environ.get("LLMVIEW_URL") or f"http://127.0.0.1:{self.config.port}/ingest"

    def _worker(self) -> None:
        while True:
            event = self.q.get()
            data = json.dumps(event).encode("utf-8")
            req = urllib.request.Request(
                self._endpoint(), data=data, headers={"content-type": "application/json"}, method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp.read()
                if self.down_since is not None:
                    log.info("llmview: server reachable again")
                    self.down_since = None
            except (urllib.error.URLError, OSError) as e:
                if self.down_since is None:
                    log.warning("llmview: cannot reach %s (%s); dropping events until it is up", self._endpoint(), e)
                    self.down_since = time.time()

    def _send(self, event: dict) -> None:
        try:
            self.q.put_nowait(event)
        except queue.Full:
            log.warning("llmview: send queue full, dropping event")

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
        if flow.metadata.get("llmview") is not None:
            return flow.metadata["llmview"]
        ok = flow.request.method == "POST" and self.config.matches(flow.request.pretty_url)
        flow.metadata["llmview"] = ok
        return ok

    # ---- mitmproxy hooks -----------------------------------------------

    def request(self, flow: http.HTTPFlow) -> None:
        if self._want(flow):
            self._send(self._base(flow, "pending"))

    def response(self, flow: http.HTTPFlow) -> None:
        if not self._want(flow):
            return
        resp = flow.response
        event = self._base(flow, "done")
        event.update(
            {
                "status": resp.status_code,
                "ended_at": resp.timestamp_end or time.time(),
                "response_headers": _headers(resp.headers),
                "response_body": _body(resp),
            }
        )
        self._send(event)

    def error(self, flow: http.HTTPFlow) -> None:
        if not self._want(flow):
            return
        event = self._base(flow, "error")
        event["error"] = str(flow.error) if flow.error else "unknown error"
        event["ended_at"] = time.time()
        if flow.response is not None:
            event["status"] = flow.response.status_code
            event["response_headers"] = _headers(flow.response.headers)
            event["response_body"] = _body(flow.response)
        self._send(event)


addons = [LLMView()]
