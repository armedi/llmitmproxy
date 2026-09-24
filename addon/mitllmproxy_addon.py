"""
mitllmproxy mitmproxy addon.

Filters flows by the URL patterns in config/capture-urls.json (fixed, shipped
with the package) and queues matching
ones as JSON files in a spool directory next to the database (`<db>-spool/`). The
server imports and deletes them whenever it runs, so capturing works without it.
Stdlib only (mitmproxy's binary builds don't even ship sqlite3), so it runs inside
mitmproxy's own environment without installing anything.

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

log = logging.getLogger("mitllmproxy")

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "capture-urls.json"
DEFAULT_DB = Path.home() / ".mitllmproxy" / "mitllmproxy.db"
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


class MitLlmProxy:
    def __init__(self) -> None:
        self.config = Config(CONFIG_PATH)
        self.q: queue.Queue[dict] = queue.Queue(maxsize=1000)
        self.failing = False
        threading.Thread(target=self._worker, name="mitllmproxy-writer", daemon=True).start()

    # ---- writing -------------------------------------------------------

    @staticmethod
    def _spool_dir() -> Path:
        env = os.environ.get("MITLLMPROXY_DB")
        db = Path(env).expanduser() if env else DEFAULT_DB
        return db.with_name(db.name + "-spool")

    def _worker(self) -> None:
        seq = 0
        while True:
            event = self.q.get()
            spool: Path | None = None
            try:
                spool = self._spool_dir()
                spool.mkdir(parents=True, exist_ok=True)
                # Names sort in write order; write to a dotfile then rename so the server never sees partial files.
                seq += 1
                name = f"{time.time_ns():020d}-{os.getpid()}-{seq:08d}.json"
                tmp = spool / f".{name}.tmp"
                tmp.write_text(json.dumps(event), encoding="utf-8")
                os.replace(tmp, spool / name)
                if self.failing:
                    log.info("mitllmproxy: writing to %s again", spool)
                    self.failing = False
            except Exception as e:  # never let the writer thread die
                if not self.failing:
                    log.warning("mitllmproxy: cannot write to %s (%s); dropping events until it works", spool, e)
                    self.failing = True

    def _send(self, event: dict) -> None:
        try:
            self.q.put_nowait(event)
        except queue.Full:
            log.warning("mitllmproxy: write queue full, dropping event")

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
        ok = flow.request.method == "POST" and self.config.matches(flow.request.pretty_url)
        flow.metadata["mitllmproxy"] = ok
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
        event = self._base(flow, "error")
        event["error"] = str(flow.error) if flow.error else "unknown error"
        event["ended_at"] = time.time()
        if flow.response is not None:
            event["status"] = flow.response.status_code
            event["response_started_at"] = flow.response.timestamp_start
            event["response_headers"] = _headers(flow.response.headers)
            event["response_body"] = _body(flow.response)
        self._send(event)


addons = [MitLlmProxy()]
