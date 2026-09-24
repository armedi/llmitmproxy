import { useState } from "react";

/** Small copy-to-clipboard button; `text` may be computed lazily. */
export function Copy({ text, label = "Copy", className = "" }: { text: string | (() => string); label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`copy ${className}`}
      title={label}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
