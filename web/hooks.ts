import { useCallback, useEffect, useRef, useState } from "react";

/** State persisted in localStorage under `key`. */
export function useStored<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue];
}

/**
 * A column width the user can drag. `edge` is the side the handle sits on: a left sidebar
 * grows when dragged right, a right panel when dragged left.
 */
export function useResizable(key: string, initial: number, min: number, max: number, edge: "right" | "left") {
  const [width, setWidth] = useStored(key, initial);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        setWidth(Math.min(max, Math.max(min, startW + (edge === "right" ? dx : -dx))));
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        document.body.classList.remove("resizing");
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      document.body.classList.add("resizing");
    },
    [width, min, max, edge, setWidth],
  );
  return { width: Math.min(max, Math.max(min, width)), onPointerDown };
}

/** True when a key press is meant for a text field rather than a shortcut. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/**
 * Global shortcuts. Keys are matched on `e.key` ("j", "J", "?", "[") with "mod+" for Cmd/Ctrl.
 * A handler returning false lets the event through (e.g. to the browser).
 */
export function useKeys(bindings: Record<string, (e: KeyboardEvent) => boolean | void>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = mod ? `mod+${e.key.toLowerCase()}` : e.altKey ? "" : e.key;
      const fn = ref.current[key];
      if (!fn) return;
      if (!mod && key !== "Escape" && isTyping(e)) return;
      if (fn(e) !== false) e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Current time, refreshed every `ms` while `active`. */
export function useNow(ms = 5000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}
