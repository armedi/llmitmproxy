import { useEffect, useState } from "react";
import { api } from "../api";

export function Settings({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [urls, setUrls] = useState("");
  const [ignore, setIgnore] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.config().then(({ path, config }) => {
      setPath(path);
      setConfig(config);
      setUrls((config.urls ?? []).join("\n"));
      setIgnore((config.ignore ?? []).join("\n"));
    });
  }, []);

  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    const r = await api.saveConfig({ ...config, urls: lines(urls), ignore: lines(ignore) });
    if (r.ok) onClose();
    else setError((await r.json()).error ?? "save failed");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>URL filters</h2>
        <p className="muted">
          Only POST requests matching one of these patterns are captured. Globs are matched against <code>host/path</code>{" "}
          (no scheme, no query), with <code>*</code> matching anything. Prefix a line with <code>re:</code> to use a regex
          against the full URL. The addon reloads <code>{path}</code> within a second of saving.
        </p>
        <label>Capture</label>
        <textarea rows={8} value={urls} onChange={(e) => setUrls(e.target.value)} spellCheck={false} />
        <label>Ignore</label>
        <textarea rows={3} value={ignore} onChange={(e) => setIgnore(e.target.value)} spellCheck={false} />
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save} disabled={!config}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
