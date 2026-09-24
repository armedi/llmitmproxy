import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FindResult, FindState } from "./Conversation";

interface Props {
  find: FindState;
  result: FindResult;
  onChange: (f: FindState) => void;
  onClose: () => void;
}

/** In-session search. Enter / Shift+Enter step through matches; Esc closes. */
export function FindBar({ find, result, onChange, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const pos = result.count ? (((find.cursor % result.count) + result.count) % result.count) + 1 : 0;
  const step = (d: number) => onChange({ ...find, cursor: find.cursor + d });
  return (
    <div className="find-bar">
      <input
        ref={input}
        placeholder="Find in session (includes collapsed tool calls)"
        value={find.query}
        onChange={(e) => onChange({ query: e.target.value, cursor: 0 })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") onClose();
        }}
      />
      <span className="muted find-count">{find.query.trim() ? `${pos} / ${result.count}` : ""}</span>
      <button className="ghost" onClick={() => step(-1)} disabled={!result.count} title="Previous (Shift+Enter)" aria-label="Previous match">
        <ChevronUp size={16} aria-hidden />
      </button>
      <button className="ghost" onClick={() => step(1)} disabled={!result.count} title="Next (Enter)" aria-label="Next match">
        <ChevronDown size={16} aria-hidden />
      </button>
      <button className="ghost" onClick={onClose} title="Close (Esc)" aria-label="Close find">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Ticks beside the transcript at each match; the current one is emphasized. */
export function FindRail({ result, cursor, onJump }: { result: FindResult; cursor: number; onJump: (i: number) => void }) {
  if (!result.count) return null;
  const cur = ((cursor % result.count) + result.count) % result.count;
  return (
    <div className="find-rail" aria-hidden>
      {result.marks.map((m, i) => (
        <span key={i} className={`tick ${i === cur ? "on" : ""}`} style={{ top: `${m * 100}%` }} onClick={() => onJump(i)} />
      ))}
    </div>
  );
}
