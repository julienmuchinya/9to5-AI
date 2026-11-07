import Link from "next/link";
import { ReactNode } from "react";

/** Shared text-input style. */
export const inputCls =
  "mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background-2)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)]/70 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow)] ${className}`}>{children}</div>;
}

/** Card with a numbered/iconed title row. */
export function Section({ title, description, icon, children, className = "" }: { title: string; description?: ReactNode; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="mb-4 flex items-start gap-3">
        {icon && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{icon}</div>}
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

type Variant = "default" | "success" | "warning" | "danger" | "accent" | "info";

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: Variant }) {
  const colors: Record<Variant, string> = {
    default: "bg-white/5 text-[var(--muted)] ring-white/10",
    success: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    warning: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    danger: "bg-red-400/10 text-red-300 ring-red-400/20",
    accent: "bg-[var(--accent-soft)] text-[#b3a9ff] ring-[var(--accent)]/25",
    info: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colors[variant]}`}>{children}</span>;
}

export const buttonCls = (variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "sm" | "md" = "md") =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${
    size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"
  } ${
    {
      primary: "bg-[var(--accent)] text-white shadow-[0_6px_20px_-8px_var(--accent)] hover:bg-[var(--accent-hover)]",
      secondary: "border border-[var(--border)] bg-[var(--card-2)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-white/5",
      danger: "bg-red-500/90 text-white hover:bg-red-500",
      ghost: "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]",
    }[variant]
  }`;

export function Button({
  children,
  href,
  onClick,
  variant = "primary",
  size = "md",
  type = "button",
  disabled,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const cls = `${buttonCls(variant, size)} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: string; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[var(--muted)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  variant = "default",
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "success" | "warning" | "danger";
  icon?: ReactNode;
}) {
  const tone = {
    default: "from-[var(--accent)]/10 text-[var(--accent)]",
    success: "from-emerald-400/10 text-emerald-300",
    warning: "from-amber-400/10 text-amber-300",
    danger: "from-red-400/10 text-red-300",
  }[variant];
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br ${tone} to-transparent bg-[var(--card)] p-4 shadow-[var(--shadow)]`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{label}</p>
        {icon && <span className="opacity-80">{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export function EmptyState({ message, action, icon = "✦" }: { message: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--card)]/40 px-6 py-14 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-lg text-[var(--accent)]">{icon}</div>
      <p className="max-w-md text-[var(--muted)]">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Small pill-style tab link. */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-1.5 text-sm transition ${
        active ? "bg-[var(--accent-soft)] font-medium text-[#c3baff] ring-1 ring-inset ring-[var(--accent)]/30" : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </Link>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  const c = {
    info: "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[#cfc8ff]",
    warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    danger: "border-red-400/25 bg-red-400/10 text-red-200",
    success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  }[tone];
  return <div className={`rounded-xl border p-3 text-sm ${c}`}>{children}</div>;
}

/** A stat that is also a filter button: the number, a label, and an active ring when selected. */
export function StatButton({
  href,
  label,
  value,
  active = false,
  tone = "default",
}: {
  href: string;
  label: string;
  value: number;
  active?: boolean;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const t = {
    default: { dot: "bg-[var(--accent)]", ring: "ring-[var(--accent)]/50", bg: "bg-[var(--accent-soft)]" },
    info: { dot: "bg-cyan-400", ring: "ring-cyan-400/50", bg: "bg-cyan-400/10" },
    success: { dot: "bg-emerald-400", ring: "ring-emerald-400/50", bg: "bg-emerald-400/10" },
    warning: { dot: "bg-amber-400", ring: "ring-amber-400/50", bg: "bg-amber-400/10" },
    danger: { dot: "bg-red-400", ring: "ring-red-400/50", bg: "bg-red-400/10" },
  }[tone];
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition active:scale-[0.98] ${
        active ? `border-transparent ${t.bg} ring-2 ring-inset ${t.ring}` : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-strong)] hover:bg-white/[0.04]"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot} ${value > 0 && tone === "warning" ? "animate-pulse" : ""}`} />
        <span className={`truncate text-sm ${active ? "font-medium text-[var(--foreground)]" : "text-[var(--muted)] group-hover:text-[var(--foreground)]"}`}>{label}</span>
      </span>
      <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{value}</span>
    </Link>
  );
}
