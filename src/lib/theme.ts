import { useEffect } from "react";
import { useStored } from "./hooks";

export type ThemePref = "system" | "light" | "dark";

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Applies the theme to <html data-theme>, following the OS when set to "system". */
export function useTheme(): [ThemePref, () => void] {
  const [pref, setPref] = useStored<ThemePref>("theme", "system");
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = pref === "system" ? (systemDark() ? "dark" : "light") : pref;
    };
    apply();
    if (pref !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
  const cycle = () => setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  return [pref, cycle];
}
