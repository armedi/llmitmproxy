export type GroupBy = "none" | "client" | "model" | "provider";

export interface Filters {
  q: string;
  provider: string;
  client: string;
  errors: boolean;
  recent: boolean;
  hideOneOff: boolean;
  group: GroupBy;
}

export const DEFAULT_FILTERS: Filters = { q: "", provider: "", client: "", errors: false, recent: false, hideOneOff: false, group: "none" };

/** The filters as URL search params; defaults are left out so a plain URL means no filters. */
export interface FilterSearch {
  q?: string;
  provider?: string;
  client?: string;
  errors?: boolean;
  recent?: boolean;
  oneoff?: "hide";
  group?: Exclude<GroupBy, "none">;
}

export const FILTER_KEYS = ["q", "provider", "client", "errors", "recent", "oneoff", "group"] as const satisfies (keyof FilterSearch)[];

const GROUPS: GroupBy[] = ["client", "model", "provider"];
const str = (v: unknown) => (v == null || v === "" ? undefined : String(v));
// Older links wrote flags as `errors=1`.
const flag = (v: unknown) => (v === true || v === 1 || v === "1" || v === "true" ? true : undefined);

export function validateFilterSearch(raw: Record<string, unknown>): FilterSearch {
  return {
    q: str(raw.q),
    provider: str(raw.provider),
    client: str(raw.client),
    errors: flag(raw.errors),
    recent: flag(raw.recent),
    oneoff: raw.oneoff === "hide" ? "hide" : undefined,
    group: GROUPS.includes(raw.group as GroupBy) ? (raw.group as FilterSearch["group"]) : undefined,
  };
}

export const filtersFromSearch = (s: FilterSearch): Filters => ({
  q: s.q ?? "",
  provider: s.provider ?? "",
  client: s.client ?? "",
  errors: !!s.errors,
  recent: !!s.recent,
  hideOneOff: s.oneoff === "hide",
  group: s.group ?? "none",
});

/** Every key is present, with undefined for defaults, so navigating with it clears what was unset. */
export const searchFromFilters = (f: Filters): FilterSearch => ({
  q: f.q || undefined,
  provider: f.provider || undefined,
  client: f.client || undefined,
  errors: f.errors || undefined,
  recent: f.recent || undefined,
  oneoff: f.hideOneOff ? "hide" : undefined,
  group: f.group === "none" ? undefined : f.group,
});

/** Remember the filters (not the search text) for the next visit without any in the URL. */
export function saveFilters(f: Filters) {
  const { q: _q, ...keep } = f;
  localStorage.setItem("filters", JSON.stringify(keep));
}

/** The last used filters, as search params; empty when there are none. */
export function savedFilterSearch(): FilterSearch {
  let saved: Partial<Filters> = {};
  try {
    saved = JSON.parse(localStorage.getItem("filters") ?? "{}");
  } catch {}
  if (localStorage.getItem("hideOneOff") === "1") saved.hideOneOff ??= true; // older setting
  const search = searchFromFilters({ ...DEFAULT_FILTERS, ...saved, q: "" });
  return Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined));
}

export const activeCount = (f: Filters) => [f.provider, f.client, f.errors, f.recent, f.hideOneOff].filter(Boolean).length;
