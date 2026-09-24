import { Database } from "bun:sqlite";
import { detectClient } from "./clients";
import { bodyText, normalizeRequest, normalizeResponse } from "./parsers";
import { costOf, loadPricing, type Pricing } from "./pricing";
import { fingerprint, matchSession, messageHashes, titleFor } from "./sessions";
import type { IngestEvent, Normalized, Provider, Usage } from "./types";

export interface SessionRow {
  id: number;
  title: string;
  provider: string;
  model: string | null;
  /** The agent's own session id; sessions sharing it form one group. */
  session_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  /** The agent app that sent the requests (claude-code, codex, …), when recognised. */
  client: string | null;
  fingerprint: string;
  created_at: number;
  updated_at: number;
  request_count: number;
  latest_request_id: number;
  latest_msg_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** Estimated dollars across priced requests. */
  cost: number;
  /** Requests with usage but no known price. */
  unpriced: number;
  pending: number;
  last_error: string | null;
  /** Stop reason of the latest request's response. */
  last_stop_reason: string | null;
  /** For a main session: cost of the whole group, subagents included. Otherwise its own cost. */
  group_cost: number;
  /** The group's main session, when this one is a subagent or side call. */
  parent_id: number | null;
  child_count: number;
}

export interface RequestSummary {
  id: number;
  flow_id: string;
  session_id: number;
  state: string;
  provider: string;
  model: string | null;
  url: string;
  status: number | null;
  started_at: number;
  response_started_at: number | null;
  ended_at: number | null;
  msg_count: number;
  error: string | null;
  usage: Usage | null;
  cost: number | null;
  stop_reason: string | null;
  /** Names of the tools the response called. */
  tool_calls: string[];
}

const SESSION_WINDOW_S = 24 * 3600;
/** Bump when parsers change what they extract from responses, to re-parse stored ones. */
const PARSER_VERSION = "2";

const placeholders = (ids: unknown[]) => ids.map(() => "?").join(",");

export class Store {
  db: Database;
  pricing: Pricing;

  constructor(path: string, pricing: Pricing = loadPricing(path)) {
    this.pricing = pricing;
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        session_id TEXT,
        agent_id TEXT,
        agent_name TEXT,
        fingerprint TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        latest_request_id INTEGER,
        latest_msg_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_match ON sessions(fingerprint, updated_at);
      CREATE INDEX IF NOT EXISTS sessions_group ON sessions(session_id, agent_id, updated_at);
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flow_id TEXT NOT NULL UNIQUE,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        method TEXT,
        url TEXT NOT NULL,
        status INTEGER,
        started_at REAL NOT NULL,
        ended_at REAL,
        request_headers TEXT,
        response_headers TEXT,
        request_body TEXT,
        response_body TEXT,
        normalized TEXT NOT NULL,
        msg_count INTEGER NOT NULL,
        msg_hashes TEXT NOT NULL,
        response_id TEXT,
        usage TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS requests_session ON requests(session_id, id);
      CREATE INDEX IF NOT EXISTS requests_response_id ON requests(response_id);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.addColumns("requests", { response_started_at: "REAL", cost: "REAL" });
    this.addColumns("sessions", { client: "TEXT", cost: "REAL NOT NULL DEFAULT 0", unpriced: "INTEGER NOT NULL DEFAULT 0" });
    this.maintain();
  }

  private addColumns(table: string, cols: Record<string, string>) {
    const have = new Set(this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, def] of Object.entries(cols)) if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }

  private meta(key: string): string | null {
    return this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
  }

  private setMeta(key: string, value: string) {
    this.db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** Bring stored data up to date with the current parsers and prices. Cheap when nothing changed. */
  private maintain() {
    this.db.transaction(() => {
      const hasRows = this.db.query("SELECT 1 FROM requests LIMIT 1").get() != null;
      const reparse = hasRows && this.meta("parser_version") !== PARSER_VERSION;
      if (reparse) this.reparseResponses();
      if (reparse || (hasRows && this.meta("pricing_hash") !== this.pricing.hash)) this.recomputeCosts();
      if (reparse) this.rebuildTotals();
      this.backfillClients();
      this.setMeta("parser_version", PARSER_VERSION);
      this.setMeta("pricing_hash", this.pricing.hash);
    })();
  }

  /** Re-run the response parsers over stored bodies, so fixes apply to old captures. */
  private reparseResponses() {
    const rows = this.db
      .query<Record<string, any>, []>(
        "SELECT id, provider, flow_id, method, url, started_at, ended_at, state, status, error, response_headers, response_body, normalized FROM requests WHERE state != 'pending'",
      )
      .all();
    const update = this.db.query("UPDATE requests SET normalized = ?, usage = ? WHERE id = ?");
    for (const r of rows) {
      const n: Normalized = JSON.parse(r.normalized);
      const resp = normalizeResponse(r.provider as Provider, {
        ...(r as any),
        response_headers: JSON.parse(r.response_headers ?? "{}"),
        response_body: r.response_body == null ? null : { text: r.response_body },
        error: r.state === "error" ? (r.error ?? undefined) : undefined,
        status: r.status ?? undefined,
      });
      n.response = resp;
      update.run(JSON.stringify(n), resp?.usage ? JSON.stringify(resp.usage) : null, r.id);
    }
  }

  private recomputeCosts() {
    const rows = this.db
      .query<{ id: number; model: string | null; usage: string | null; resp_model: string | null }, []>(
        "SELECT id, model, usage, json_extract(normalized, '$.response.model') AS resp_model FROM requests",
      )
      .all();
    const update = this.db.query("UPDATE requests SET cost = ? WHERE id = ?");
    for (const r of rows) update.run(r.usage ? costOf(this.pricing, JSON.parse(r.usage), r.resp_model ?? r.model) : null, r.id);
    this.db.exec(`UPDATE sessions SET
      cost = coalesce((SELECT sum(cost) FROM requests r WHERE r.session_id = sessions.id), 0),
      unpriced = (SELECT count(*) FROM requests r WHERE r.session_id = sessions.id AND r.usage IS NOT NULL AND r.cost IS NULL)`);
  }

  private rebuildTotals() {
    const sum = (k: string) => `coalesce((SELECT sum(json_extract(r.usage, '$.${k}')) FROM requests r WHERE r.session_id = sessions.id), 0)`;
    this.db.exec(`UPDATE sessions SET input_tokens = ${sum("input")}, output_tokens = ${sum("output")},
      cache_read_tokens = ${sum("cacheRead")}, cache_write_tokens = ${sum("cacheWrite")}`);
  }

  private backfillClients() {
    const rows = this.db
      .query<{ id: number; headers: string | null }, []>(
        `SELECT s.id, r.request_headers AS headers FROM sessions s JOIN requests r ON r.id = s.latest_request_id WHERE s.client IS NULL`,
      )
      .all();
    const update = this.db.query("UPDATE sessions SET client = ? WHERE id = ?");
    for (const r of rows) {
      const client = detectClient(JSON.parse(r.headers ?? "{}"));
      if (client) update.run(client, r.id);
    }
  }

  /** Store an event from the addon. Returns the ids that changed. */
  ingest(ev: IngestEvent): { sessionId: number; requestId: number } {
    return this.db.transaction(() => {
      const existing = this.db
        .query<{ id: number; session_id: number; normalized: string; state: string }, [string]>(
          "SELECT id, session_id, normalized, state FROM requests WHERE flow_id = ?",
        )
        .get(ev.flow_id);

      let n: Normalized;
      let requestId: number;
      let sessionId: number;

      if (existing) {
        n = JSON.parse(existing.normalized);
        requestId = existing.id;
        sessionId = existing.session_id;
        // Already finished: ignore late "pending" events and duplicate deliveries.
        if (existing.state !== "pending") return { sessionId, requestId };
      } else {
        n = normalizeRequest(ev);
        this.stitchPrevious(n);
        const hashes = messageHashes(n.messages);
        const client = detectClient(ev.request_headers ?? {});
        sessionId = this.findOrCreateSession(n, hashes, ev.started_at, client);
        requestId = Number(
          this.db
            .query(
              `INSERT INTO requests (flow_id, session_id, state, provider, model, method, url, started_at,
                 request_headers, request_body, normalized, msg_count, msg_hashes)
               VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              ev.flow_id,
              sessionId,
              n.provider,
              n.model ?? null,
              ev.method,
              ev.url,
              ev.started_at,
              JSON.stringify(ev.request_headers ?? {}),
              bodyText(ev.request_body) ?? null,
              JSON.stringify(n),
              n.messages.length,
              JSON.stringify(hashes),
            ).lastInsertRowid,
        );
        this.db
          .query(
            `UPDATE sessions SET request_count = request_count + 1, updated_at = max(updated_at, ?),
               model = coalesce(?, model), client = coalesce(client, ?),
               latest_request_id = CASE WHEN ? >= latest_msg_count THEN ? ELSE latest_request_id END,
               latest_msg_count = max(latest_msg_count, ?)
             WHERE id = ?`,
          )
          .run(ev.started_at, n.model ?? null, client, n.messages.length, requestId, n.messages.length, sessionId);
      }

      if (ev.state !== "pending") {
        const resp = normalizeResponse(n.provider, ev);
        n.response = resp;
        const u = resp?.usage;
        const cost = u ? costOf(this.pricing, u, resp?.model ?? n.model) : null;
        this.db
          .query(
            `UPDATE requests SET state = ?, status = ?, ended_at = ?, response_started_at = ?, response_headers = ?, response_body = ?,
               normalized = ?, response_id = ?, usage = ?, cost = ?, error = ?
             WHERE id = ?`,
          )
          .run(
            ev.state,
            ev.status ?? null,
            ev.ended_at ?? null,
            ev.response_started_at ?? null,
            JSON.stringify(ev.response_headers ?? {}),
            bodyText(ev.response_body) ?? null,
            JSON.stringify(n),
            resp?.id ?? null,
            u ? JSON.stringify(u) : null,
            cost,
            resp?.error ?? ev.error ?? null,
            requestId,
          );
        this.db
          .query(
            `UPDATE sessions SET updated_at = max(updated_at, ?),
               input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
               cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?,
               cost = cost + ?, unpriced = unpriced + ?,
               last_error = CASE WHEN latest_request_id = ? THEN ? ELSE last_error END
             WHERE id = ?`,
          )
          .run(
            ev.ended_at ?? ev.started_at,
            u?.input ?? 0,
            u?.output ?? 0,
            u?.cacheRead ?? 0,
            u?.cacheWrite ?? 0,
            cost ?? 0,
            u && cost == null ? 1 : 0,
            requestId,
            resp?.error ?? ev.error ?? null,
            sessionId,
          );
      }
      return { sessionId, requestId };
    })();
  }

  /**
   * OpenAI Responses with previous_response_id only sends the new input items.
   * Prepend the previous request's history and output so the latest request shows everything.
   */
  private stitchPrevious(n: Normalized) {
    if (!n.previousResponseId) return;
    const prev = this.db
      .query<{ normalized: string; session_id: number }, [string]>(
        "SELECT normalized, session_id FROM requests WHERE response_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(n.previousResponseId);
    if (!prev) return;
    const p: Normalized = JSON.parse(prev.normalized);
    const history = [...p.messages];
    if (p.response?.blocks.length) history.push({ role: "assistant", content: p.response.blocks });
    n.messages = [...history, ...n.messages];
    if (!n.system.length) n.system = p.system;
    if (!n.tools.length) n.tools = p.tools;
  }

  private findOrCreateSession(n: Normalized, hashes: string[], ts: number, client: string | null): number {
    const fp = fingerprint(n);
    const sid = n.sessionId ?? null;
    const agent = n.agentId ?? null;
    if (sid && agent) {
      // A subagent id names its thread outright.
      const row = this.db
        .query<{ id: number }, [string, string]>("SELECT id FROM sessions WHERE session_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(sid, agent);
      if (row) return row.id;
    } else {
      // With an explicit session id the tool set may change mid-conversation, so only the id scopes the search.
      const candidates = this.db
        .query<{ id: number; msg_hashes: string }, [string | null, string | null, string, number]>(
          `SELECT s.id, r.msg_hashes FROM sessions s JOIN requests r ON r.id = s.latest_request_id
           WHERE s.session_id IS ? AND s.agent_id IS NULL AND (? IS NOT NULL OR (s.fingerprint = ? AND s.updated_at > ?))
           ORDER BY s.updated_at DESC LIMIT 100`,
        )
        .all(sid, sid, fp, ts - SESSION_WINDOW_S)
        .map((r) => ({ sessionId: r.id, hashes: JSON.parse(r.msg_hashes) as string[] }));
      const match = matchSession(candidates, hashes);
      if (match !== undefined) return match;
    }
    return Number(
      this.db
        .query(
          `INSERT INTO sessions (title, provider, model, session_id, agent_id, agent_name, client, fingerprint, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(titleFor(n), n.provider, n.model ?? null, sid, agent, n.agentName ?? null, client, fp, ts, ts).lastInsertRowid,
    );
  }

  /**
   * Each group's main session is its longest non-subagent conversation; every other session
   * with the same agent session id (subagents, side calls, threads started by /clear) is its child.
   */
  private sessionsQuery(where: string) {
    return `WITH roots AS (
        SELECT session_id, id AS root_id FROM (
          SELECT session_id, id, row_number() OVER (PARTITION BY session_id ORDER BY agent_id IS NOT NULL, latest_msg_count DESC, request_count DESC, id) AS rn
          FROM sessions WHERE session_id IS NOT NULL
        ) WHERE rn = 1
      )
      SELECT s.*,
        (SELECT count(*) FROM requests r WHERE r.session_id = s.id AND r.state = 'pending') AS pending,
        CASE WHEN g.root_id = s.id THEN NULL ELSE g.root_id END AS parent_id,
        CASE WHEN g.root_id = s.id THEN (SELECT count(*) - 1 FROM sessions c WHERE c.session_id = s.session_id) ELSE 0 END AS child_count,
        CASE WHEN g.root_id = s.id THEN (SELECT sum(c.cost) FROM sessions c WHERE c.session_id = s.session_id) ELSE s.cost END AS group_cost,
        (SELECT json_extract(r.normalized, '$.response.stopReason') FROM requests r WHERE r.id = s.latest_request_id) AS last_stop_reason
      FROM sessions s LEFT JOIN roots g ON g.session_id = s.session_id
      ${where}`;
  }

  listSessions(limit = 500): SessionRow[] {
    return this.db.query<SessionRow, [number]>(this.sessionsQuery("ORDER BY s.updated_at DESC LIMIT ?")).all(limit);
  }

  getSession(id: number): SessionRow | null {
    return this.db.query<SessionRow, [number]>(this.sessionsQuery("WHERE s.id = ?")).get(id);
  }

  listRequests(sessionId: number): RequestSummary[] {
    return this.db
      .query<Record<string, any>, [number]>(
        `SELECT id, flow_id, session_id, state, provider, coalesce(json_extract(normalized, '$.response.model'), model) AS model,
           url, status, started_at, response_started_at, ended_at, msg_count, error, usage, cost,
           json_extract(normalized, '$.response.stopReason') AS stop_reason,
           (SELECT json_group_array(json_extract(b.value, '$.name')) FROM json_each(normalized, '$.response.blocks') b
             WHERE json_extract(b.value, '$.type') = 'tool_use') AS tool_calls
         FROM requests WHERE session_id = ? ORDER BY id`,
      )
      .all(sessionId)
      .map((r) => ({ ...r, usage: r.usage ? JSON.parse(r.usage) : null, tool_calls: JSON.parse(r.tool_calls ?? "[]") }) as RequestSummary);
  }

  getRequest(id: number): Record<string, any> | null {
    const row = this.db.query<Record<string, any>, [number]>("SELECT * FROM requests WHERE id = ?").get(id);
    if (!row) return null;
    return {
      ...row,
      normalized: JSON.parse(row.normalized),
      request_headers: JSON.parse(row.request_headers ?? "{}"),
      response_headers: JSON.parse(row.response_headers ?? "{}"),
      usage: row.usage ? JSON.parse(row.usage) : null,
      msg_hashes: undefined,
    };
  }

  /** Deleting a group's main session deletes its children too. Returns the deleted ids. */
  deleteSession(id: number): number[] {
    const s = this.getSession(id);
    if (!s) return [];
    const ids =
      s.session_id && s.parent_id == null
        ? this.db.query<{ id: number }, [string]>("SELECT id FROM sessions WHERE session_id = ?").all(s.session_id).map((r) => r.id)
        : [id];
    this.db.query(`DELETE FROM sessions WHERE id IN (${placeholders(ids)})`).run(...ids);
    return ids;
  }

  /**
   * Delete requests that started before `cutoff` (epoch seconds), and sessions left with none.
   * Sessions that keep some requests get their counts, tokens and latest request recomputed.
   */
  prune(cutoff: number): { deleted: number[]; updated: number[] } {
    return this.db.transaction(() => {
      const affected = this.db
        .query<{ session_id: number }, [number]>("SELECT DISTINCT session_id FROM requests WHERE started_at < ?")
        .all(cutoff)
        .map((r) => r.session_id);
      if (!affected.length) return { deleted: [], updated: [] };
      this.db.query("DELETE FROM requests WHERE started_at < ?").run(cutoff);
      const deleted = this.db
        .query<{ id: number }, number[]>(
          `DELETE FROM sessions WHERE id IN (${placeholders(affected)})
             AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id = sessions.id) RETURNING id`,
        )
        .all(...affected)
        .map((r) => r.id);
      const gone = new Set(deleted);
      const updated = affected.filter((id) => !gone.has(id));
      if (updated.length) {
        // Same "latest" rule as ingest: the longest conversation, the newest on ties.
        this.db
          .query(
            `WITH latest AS (
               SELECT session_id, id, msg_count, error FROM (
                 SELECT session_id, id, msg_count, error,
                   row_number() OVER (PARTITION BY session_id ORDER BY msg_count DESC, id DESC) AS rn
                 FROM requests WHERE session_id IN (${placeholders(updated)})
               ) WHERE rn = 1
             )
             UPDATE sessions SET
               request_count = (SELECT count(*) FROM requests r WHERE r.session_id = sessions.id),
               created_at = (SELECT min(started_at) FROM requests r WHERE r.session_id = sessions.id),
               latest_request_id = (SELECT id FROM latest WHERE latest.session_id = sessions.id),
               latest_msg_count = (SELECT msg_count FROM latest WHERE latest.session_id = sessions.id),
               last_error = (SELECT error FROM latest WHERE latest.session_id = sessions.id),
               input_tokens = (SELECT coalesce(sum(json_extract(usage, '$.input')), 0) FROM requests r WHERE r.session_id = sessions.id),
               output_tokens = (SELECT coalesce(sum(json_extract(usage, '$.output')), 0) FROM requests r WHERE r.session_id = sessions.id),
               cache_read_tokens = (SELECT coalesce(sum(json_extract(usage, '$.cacheRead')), 0) FROM requests r WHERE r.session_id = sessions.id),
               cache_write_tokens = (SELECT coalesce(sum(json_extract(usage, '$.cacheWrite')), 0) FROM requests r WHERE r.session_id = sessions.id),
               cost = (SELECT coalesce(sum(cost), 0) FROM requests r WHERE r.session_id = sessions.id),
               unpriced = (SELECT count(*) FROM requests r WHERE r.session_id = sessions.id AND r.usage IS NOT NULL AND r.cost IS NULL)
             WHERE id IN (${placeholders(updated)})`,
          )
          .run(...updated, ...updated);
      }
      return { deleted, updated };
    })();
  }

  clear() {
    this.db.exec("DELETE FROM requests; DELETE FROM sessions;");
  }
}
