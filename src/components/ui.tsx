import Link from "next/link";
import { Fragment, ReactNode } from "react";

/*
 * Career Desk primitives: flat sheets on warm paper, 1px rules, mono labels, serif statements.
 * Signatures are unchanged from the earlier UI so every page keeps working.
 */

/** Shared text-input style. */
export const inputCls =
  "mt-1.5 w-full rounded-sm border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)]/80 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15";

/** Render "A better *next* move." with the starred word as the orange italic accent. */
export function Emphasis({ text }: { text: string }) {
  const parts = text.split(/\*([^*]+)\*/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/** "—— OVERLINE / LABEL" in small mono capitals. */
export function Overline({ children, rule = true, className = "" }: { children: ReactNode; rule?: boolean; className?: string }) {
  return <p className={`kicker ${rule ? "rule-label" : ""} ${className}`}>{children}</p>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-sm border border-[var(--border)] bg-[var(--card)] p-5 ${className}`}>{children}</div>;
}

/** A titled sheet. */
export function Section({ title, description, icon, children, className = "" }: { title: string; description?: ReactNode; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="mb-4 flex items-start gap-3 border-b border-[var(--border)] pb-3">
        {icon && <div className="grid h-8 w-8 shrink-0 place-items-center text-[var(--accent-text)]">{icon}</div>}
        <div className="min-w-0">
          <h2 className="display text-[22px]">{title}</h2>
          {description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

type Variant = "default" | "success" | "warning" | "danger" | "accent" | "info";

/** Status / metadata tag: small mono label on a tinted ground. */
export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: Variant }) {
  const colors: Record<Variant, string> = {
    default: "bg-[var(--hover)] text-[var(--muted)] ring-[var(--border)]",
    success: "bg-emerald-900/70 text-emerald-300 ring-emerald-400/25",
    warning: "bg-amber-900/70 text-amber-300 ring-amber-400/25",
    danger: "bg-red-900/70 text-red-300 ring-red-400/25",
    accent: "bg-[var(--accent-soft)] text-[var(--accent-text)] ring-[var(--accent)]/25",
    info: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25",
  };
  return <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] tracking-wide ring-1 ring-inset ${colors[variant]}`}>{children}</span>;
}

export type ButtonVariant = "primary" | "accent" | "secondary" | "danger" | "ghost";

export const buttonCls = (variant: ButtonVariant = "primary", size: "sm" | "md" = "md") =>
  `inline-flex items-center justify-center gap-1.5 rounded-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 ${
    size === "sm" ? "min-h-[36px] px-3 text-sm" : "min-h-[44px] px-4 text-sm"
  } ${
    {
      // Pine for everyday actions; vermilion only for the one most important action on a screen.
      primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
      accent: "bg-[var(--orange)] text-[#1b120d] hover:brightness-95",
      secondary: "border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--foreground)]",
      danger: "bg-[var(--danger)] text-white hover:brightness-95",
      ghost: "text-[var(--foreground)] underline-offset-4 hover:underline",
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
  variant?: ButtonVariant;
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

/**
 * Editorial page header: "—— EYEBROW" overline, a large serif statement (wrap a word in *stars* for the
 * orange italic accent), an optional right-hand note and action.
 */
export function PageHeader({ title, description, action, eyebrow, aside }: { title: string; description?: string; action?: ReactNode; eyebrow?: string; aside?: string }) {
  return (
    <header className="mb-8 animate-fade-up sm:mb-10">
      {(eyebrow || aside) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {eyebrow ? <Overline>{eyebrow}</Overline> : <span />}
          {aside && <p className="kicker hidden sm:block">{aside}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="display text-[40px] sm:text-[56px] lg:text-[64px]">
            <Emphasis text={title} />
          </h1>
          {description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{description}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A metric as a flat cell: big serif number, mono label. Used in StatStrip and as a card. */
export function StatCard({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "success" | "warning" | "danger";
  icon?: ReactNode;
}) {
  const tone = { default: "", success: "text-emerald-400", warning: "text-amber-400", danger: "text-red-400" }[variant];
  return (
    <div className="h-full border-t border-[var(--foreground)] pt-3">
      <p className="kicker">{label}</p>
      <p className={`display mt-1 text-[40px] tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

/** Inline row of numbers separated by thin rules ("4 TRACKED · 2 NEED ATTENTION …"). */
export function StatStrip({ items }: { items: { value: string | number; label: string; href?: string; tone?: "warning" | "success" }[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-y-4 border-y border-[var(--border)] py-5">
      {items.map((it, i) => {
        const body = (
          <span className="flex items-end gap-2.5">
            <span className={`display text-[38px] leading-none tabular-nums ${it.tone === "warning" ? "text-amber-400" : it.tone === "success" ? "text-emerald-400" : ""}`}>{it.value}</span>
            <span className="kicker max-w-[9rem] pb-1 leading-tight">{it.label}</span>
          </span>
        );
        return (
          <div key={it.label} className={`pr-6 ${i ? "border-l border-[var(--border)] pl-6" : ""}`}>
            {it.href ? (
              <Link href={it.href} className="block hover:opacity-80">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ message, action, icon, title }: { message: string; action?: ReactNode; icon?: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
      {icon && <p className="kicker mb-2">{icon === "!" ? "Something went wrong" : icon}</p>}
      <p className="display text-[26px]">{title ?? (icon === "!" ? "Something interrupted the flow." : "Nothing here right now.")}</p>
      <p className="mt-2 max-w-md text-sm text-[var(--muted)]">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small square tab link. */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-sm px-3 py-1.5 text-sm transition ${
        active ? "bg-[var(--accent)] font-medium text-white" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </Link>
  );
}

/** Note with a vermilion rule on the left. */
export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  const c = {
    info: "border-l-[var(--orange)] bg-[var(--accent-soft)] text-[var(--foreground)]",
    warning: "border-l-amber-400 bg-amber-900/60 text-amber-200",
    danger: "border-l-red-400 bg-red-900/60 text-red-200",
    success: "border-l-emerald-400 bg-emerald-900/60 text-emerald-200",
  }[tone];
  return <div className={`border-l-[3px] px-4 py-3 text-sm ${c}`}>{children}</div>;
}

/** A stat that is also a filter button. */
export function StatButton({
  href,
  label,
  value,
  active = false,
}: {
  href: string;
  label: string;
  value: number;
  active?: boolean;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-3 rounded-sm border px-3.5 py-2.5 text-left transition ${
        active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--foreground)]"
      }`}
    >
      <span className="truncate text-sm">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </Link>
  );
}

/** Serif initial in a thin square — an employer mark (no logos are fetched). */
export function CompanyMark({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-[26px]" : "h-11 w-11 text-[22px]";
  return (
    <span className={`grid shrink-0 place-items-center rounded-sm border border-[var(--border-strong)] bg-[var(--card)] font-serif leading-none ${dim}`} aria-hidden>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Words, not percentages: fit describes skill overlap; it is never a chance of being hired. */
export function fitLabel(score: number): { label: string; tone: "success" | "warning" | "default" } {
  return score >= 75 ? { label: "Strong fit", tone: "success" } : score >= 60 ? { label: "Good fit", tone: "warning" } : { label: "Explore", tone: "default" };
}

export function FitBadge({ score }: { score: number }) {
  const f = fitLabel(score);
  const tone = { success: "text-emerald-300 ring-emerald-400/40", warning: "text-amber-300 ring-amber-400/40", default: "text-[var(--muted)] ring-[var(--border-strong)]" }[f.tone];
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset ${tone}`}
      title={`Fit ${score}/100 — overlap between this posting and your resume, roles, level and location. It does not predict hiring decisions.`}
    >
      {f.label}
    </span>
  );
}
