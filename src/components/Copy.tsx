import { Check, Copy as CopyIcon } from "lucide-react";
import { useState } from "react";

/** Small copy-to-clipboard button; `text` may be computed lazily. `iconOnly` keeps the label as its tooltip. */
export function Copy({ text, label = "Copy", className = "", iconOnly = false }: { text: string | (() => string); label?: string; className?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  const Icon = done ? Check : CopyIcon;
  return (
    <button
      className={`copy ${iconOnly ? "icon" : ""} ${className}`}
      title={label}
      aria-label={iconOnly ? (done ? "Copied" : label) : undefined}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {iconOnly ? <Icon size={16} aria-hidden /> : done ? "Copied" : label}
    </button>
  );
}
