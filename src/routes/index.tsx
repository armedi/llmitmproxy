import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useArranged } from "../sidebar/Sidebar";

export const Route = createFileRoute("/")({
  component: Home,
});

/** Opens the newest session that passes the filters. */
function Home() {
  const { groups } = useArranged();
  const newest = groups[0]?.roots[0];
  return newest ? <Navigate to="/session/$id" params={{ id: newest.id }} replace /> : <div className="placeholder">Select a session</div>;
}
