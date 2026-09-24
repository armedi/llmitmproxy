const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous message"],
  ["J / K", "Next / previous user prompt"],
  ["] / [", "Next / previous session"],
  ["⌘F / Ctrl+F", "Find in session (Conversation tab)"],
  ["Enter / Shift+Enter", "Next / previous match"],
  ["t", "Switch Conversation / Raw"],
  ["f", "Focused mode: prompts and final answers only"],
  ["m", "Markdown / plain text"],
  ["v", "Show / hide the stats panel"],
  ["b", "Show / hide the sidebar"],
  ["Esc", "Close find or this help; in Raw, return to the latest request"],
  ["?", "This help"],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
