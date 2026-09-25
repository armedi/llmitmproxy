import { useCallback, useState } from "react";
import { Modal } from "./Modal";

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
    <Modal
      className="confirm"
      role="alertdialog"
      aria-labelledby="confirm-title"
      onClose={close}
      // Keep the app's single-key shortcuts from firing behind the dialog.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id="confirm-title">{req.title}</h2>
      <div className="confirm-body">{req.body}</div>
      <p className="muted">This can't be undone.</p>
      <div className="confirm-actions">
        {/* Cancel is the first control, so the dialog focuses it and a stray Enter never deletes anything. */}
        <button className="ghost" onClick={close}>
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
    </Modal>
  );
  return [dialog, useCallback((r: ConfirmRequest) => setReq(r), [])];
}
