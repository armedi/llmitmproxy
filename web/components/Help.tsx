import { Modal } from "./Modal";

const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous message"],
  ["J / K", "Next / previous user prompt"],
  ["] / [", "Next / previous session"],
  ["⌘F / Ctrl+F", "Find in session (Conversation tab)"],
  ["Enter / Shift+Enter", "Next / previous match"],
  ["t", "Switch Conversation / Raw"],
  ["f", "Focused mode: prompts and final answers only"],
  ["m", "Formatted / plain text"],
  ["v", "Show / hide the stats panel"],
  ["b", "Show / hide the sidebar"],
  ["Esc", "Close find or this help; in Raw, return to the latest request"],
  ["?", "This help"],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal aria-label="Keyboard shortcuts" onClose={onClose}>
      <div className="modal-head">
        <h2>Keyboard shortcuts</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
