import { useEffect, useRef } from "react";

/** A modal <dialog>: the browser traps focus and closes it on Esc; a click on the backdrop closes it too. */
export function Modal({
  className = "",
  onClose,
  onKeyDown,
  children,
  ...aria
}: {
  className?: string;
  onClose: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>;
  children: React.ReactNode;
  role?: "dialog" | "alertdialog";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      // The body fills the dialog, so a click that lands on the dialog itself is on the backdrop.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      {...aria}
    >
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
