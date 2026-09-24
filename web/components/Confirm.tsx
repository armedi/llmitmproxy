import { useCallback, useState } from "react";

export interface ConfirmRequest {
  title: string;
  /** What exactly goes away, shown under the title. */
  body: React.ReactNode;
  action: string;
  onConfirm: () => void;
}

/** Ask before a destructive action. Returns the dialog to render and a function that opens it. */
export function useConfirm(): [React.ReactNode, (r: ConfirmRequest) => void] {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const close = () => setReq(null);
  const dialog = req && (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        // Keep the app's single-key shortcuts from firing behind the dialog.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") close();
        }}
      >
        <h2 id="confirm-title">{req.title}</h2>
        <div className="confirm-body">{req.body}</div>
        <p className="muted">This can't be undone.</p>
        <div className="confirm-actions">
          {/* Cancel has focus, so a stray Enter never deletes anything. */}
          <button className="ghost" autoFocus onClick={close}>
            Cancel
          </button>
          <button
            className="danger-solid"
            onClick={() => {
              close();
              req.onConfirm();
            }}
          >
            {req.action}
          </button>
        </div>
      </div>
    </div>
  );
  return [dialog, useCallback((r: ConfirmRequest) => setReq(r), [])];
}
