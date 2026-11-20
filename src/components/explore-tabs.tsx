import Link from "next/link";

export type ExploreTab = "search" | "matches" | "all" | "saved";

/** The tabs inside Explore: search every job (the main one), the agent's matches, everything it found, saved. */
export function ExploreTabs({ active, term }: { active: ExploreTab; term?: string }) {
  const q = term ? `q=${encodeURIComponent(term)}` : "";
  const tabs: [ExploreTab, string, string][] = [
    ["search", "Search every job", `/search${q ? `?${q}` : ""}`],
    ["matches", "Agent’s matches", `/jobs${q ? `?${q}` : ""}`],
    ["all", "All roles found", `/jobs?scope=all${q ? `&${q}` : ""}`],
    ["saved", "Saved", "/jobs?show=saved"],
  ];
  return (
    <nav aria-label="Explore" className="no-scrollbar -mx-1 mb-6 flex overflow-x-auto px-1">
      <div className="inline-flex shrink-0 border border-[var(--border-strong)]">
        {tabs.map(([k, label, href]) => (
          <Link
            key={k}
            href={href}
            aria-current={active === k ? "page" : undefined}
            className={`min-h-[44px] whitespace-nowrap px-4 py-3 text-sm transition ${active === k ? "bg-[var(--accent)] font-semibold text-white" : "hover:bg-[var(--hover)]"}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
