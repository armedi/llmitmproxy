import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, defaultStringifySearch, HeadContent, Outlet, redirect, retainSearchParams, Scripts, useNavigate, useParams } from "@tanstack/react-router";
import { Keyboard, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { api, sessionsQuery } from "../data/api";
import { useConfirm } from "../components/Confirm";
import { Help } from "../components/Help";
import { SessionList, useArranged } from "../sidebar/Sidebar";
import { FILTER_KEYS, type Filters, savedFilterSearch, saveFilters, searchFromFilters, validateFilterSearch } from "../sidebar/filters";
import { useKeys, useResizable, useStored } from "../lib/hooks";
import { useLiveUpdates } from "../data/live";
import styles from "../styles/styles.css?url";
import { useTheme } from "../lib/theme";

// Set the theme before styles apply, so the page doesn't flash the wrong one.
const THEME_SCRIPT = `try {
  const t = JSON.parse(localStorage.getItem("theme") || '"system"');
  document.documentElement.dataset.theme = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
} catch {}`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [{ charSet: "UTF-8" }, { name: "viewport", content: "width=device-width, initial-scale=1.0" }, { title: "mitllmproxy" }],
    links: [
      { rel: "icon", href: "data:," },
      { rel: "stylesheet", href: styles },
    ],
    scripts: [{ children: THEME_SCRIPT }],
  }),
  // The UI reads localStorage and matchMedia while rendering, so the server only renders the document.
  ssr: false,
  // Sidebar filters live in the URL (shareable, survive reload) and carry over to every page.
  validateSearch: validateFilterSearch,
  search: { middlewares: [retainSearchParams([...FILTER_KEYS])] },
  beforeLoad: ({ location }) => {
    // Without filters in the URL, fall back to the last used ones.
    if (location.searchStr) return;
    const saved = savedFilterSearch();
    if (Object.keys(saved).length) throw redirect({ href: `${location.pathname}${defaultStringifySearch(saved)}`, replace: true });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(sessionsQuery),
  shellComponent: Shell,
  component: Layout,
  notFoundComponent: () => <div className="placeholder">Nothing here. Pick a session from the list.</div>,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

const THEME_LABEL = { system: "Auto", light: "Light", dark: "Dark" } as const;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function Layout() {
  const { sessions, filters, groups, children, now } = useArranged();
  const selected = useParams({ from: "/session/$id", shouldThrow: false })?.id ?? null;
  const navigate = useNavigate();
  const connected = useLiveUpdates();
  const [sidebarOpen, setSidebarOpen] = useStored("sidebar", true);
  const [help, setHelp] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const ThemeIcon = THEME_ICON[theme];
  const [confirmDialog, askConfirm] = useConfirm();
  const sidebar = useResizable("sidebarWidth", 340, 220, 520, "right");

  const setFilters = (f: Filters) => {
    saveFilters(f);
    navigate({ to: ".", search: (prev) => ({ ...prev, ...searchFromFilters(f) }), replace: true });
  };

  const order = useMemo(() => groups.flatMap((g) => g.roots.flatMap((r) => [r, ...(children.get(r.id) ?? [])])), [groups, children]);
  const current = sessions.find((s) => s.id === selected);
  const step = (d: number) => {
    const roots = order.filter((s) => s.parent_id == null);
    const at = roots.findIndex((s) => s.id === (current?.parent_id ?? current?.id));
    const next = roots[Math.max(0, Math.min(roots.length - 1, at + d))];
    if (next) navigate({ to: "/session/$id", params: { id: next.id } });
  };
  const roots = sessions.filter((s) => s.parent_id == null).length;
  const clearAll = () =>
    askConfirm({
      title: "Delete all sessions?",
      body: (
        <p>
          All {roots} session{roots === 1 ? "" : "s"}
          {sessions.length > roots && `, with their ${sessions.length - roots} subagents and side calls,`} will be permanently deleted from the database.
        </p>
      ),
      action: "Delete all",
      onConfirm: () => api.clear(),
    });

  useKeys({
    "]": () => step(1),
    "[": () => step(-1),
    b: () => setSidebarOpen((o) => !o),
    "?": () => setHelp((h) => !h),
    Escape: () => (help ? setHelp(false) : false),
  });

  return (
    <div className="app" style={{ gridTemplateColumns: sidebarOpen ? `${sidebar.width}px 1fr` : "1fr" }}>
      {sidebarOpen && (
        <aside className="sidebar">
          <header className="sidebar-head">
            <div className="brand">mitllmproxy</div>
            <span className={`live ${connected ? "on" : "off"}`} title={connected ? "Receiving updates from the server" : "Lost the connection to the server; retrying"}>
              {connected ? "live" : "offline"}
            </span>
            <span className="spacer" />
            <button
              className="ghost small icon"
              onClick={cycleTheme}
              title={`Theme: ${THEME_LABEL[theme]}. Click to cycle system, light and dark`}
              aria-label={`Theme: ${THEME_LABEL[theme]}`}
            >
              <ThemeIcon size={16} aria-hidden />
            </button>
            <button className="ghost small icon" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
              <Keyboard size={16} aria-hidden />
            </button>
            <button className="ghost small icon" onClick={() => setSidebarOpen(false)} title="Hide sidebar (b)" aria-label="Hide sidebar">
              <PanelLeftClose size={16} aria-hidden />
            </button>
          </header>
          <SessionList
            sessions={sessions}
            groups={groups}
            children={children}
            filters={filters}
            onFilters={setFilters}
            selected={selected}
            now={now}
            footer={
              <button className="ghost small danger" onClick={clearAll} disabled={!sessions.length} title="Delete all sessions (asks first)">
                Delete all
              </button>
            }
          />
          <div className="resize-handle right" onPointerDown={sidebar.onPointerDown} />
        </aside>
      )}
      <main className="main">
        {!sidebarOpen && (
          <button className="ghost small icon sidebar-show" onClick={() => setSidebarOpen(true)} title="Show sidebar (b)" aria-label="Show sidebar">
            <PanelLeftOpen size={16} aria-hidden />
          </button>
        )}
        <Outlet />
      </main>
      {help && <Help onClose={() => setHelp(false)} />}
      {confirmDialog}
    </div>
  );
}
