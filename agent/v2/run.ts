#!/usr/bin/env npx tsx
/**
 * 9to5 AI agent v2 — runs on GitHub Actions every few hours.
 *   discover → verify → match (per user) → auto-apply (per user, capped) → log
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 * Optional: DISCOVER=false, APPLY=false, APPLY_DRY_RUN=true, BOARD_BATCH=40, ONLY_USER=<uuid>
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  boardsFrom,
  fetchAshby,
  fetchGreenhouse,
  fetchLever,
  fetchRemoteFeeds,
  fetchSimplify,
  type Posting,
} from "../../src/lib/v2/discovery/sources";
import { verifyPosting, canAutoSubmit } from "../../src/lib/v2/verify";
import { matchPosting, type MatchProfile } from "../../src/lib/v2/match";
import { bumpUsage, freeTierSnapshot, checkGemini, today } from "../../src/lib/v2/freeTier";
import { renderResumePdf, tailorResume, resumeToText, type ParsedResume } from "../../src/lib/v2/resume";
import { applyToJob, type Applicant } from "./apply";
import { scanInbox } from "./inbox";
import { resumeFocus } from "../../src/lib/v2/tracking";
import { encryptSecret, generatePortalPassword } from "../../src/lib/v2/vault";

const startedAt = Date.now();
const env = (k: string, d = "") => process.env[k] ?? d;
const log = (...a: unknown[]) => console.log("[9to5]", ...a);

function db(): SupabaseClient {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
/** "job-boards.greenhouse.io/acme" — one company's board, so a CAPTCHA at one company doesn't pause the rest. */
const siteKey = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.toLowerCase()}/${x.pathname.split("/").filter(Boolean)[0] ?? ""}`;
  } catch {
    return "";
  }
};
// Career sites that make you create an account before applying.
const ACCOUNT_SITES = /(myworkdayjobs\.com|myworkdaysite\.com|icims\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|brassring\.com|ultipro\.com|ukg\.net|jobvite\.com|avature\.net|phenompeople\.com|eightfold\.ai)/i;

// ── Anti-ban pacing (all tunable by env) ──────────────────────────────────
const PACE_MIN_S = Number(env("PACE_MIN_S", "40"));
const PACE_MAX_S = Number(env("PACE_MAX_S", "90"));
const ATS_DAILY_CAP = Number(env("ATS_DAILY_CAP", "25")); // per ATS host, all users combined
const COMPANY_GAP_DAYS = Number(env("COMPANY_GAP_DAYS", "14")); // agent applies to a company at most once per N days

async function activeCooldowns(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await sb.from("site_cooldowns").select("host,reason").gt("until", new Date().toISOString());
  return new Map((data ?? []).map((r) => [r.host as string, (r.reason as string) ?? ""]));
}
async function coolDown(sb: SupabaseClient, key: string, hours: number, reason: string) {
  if (!key) return;
  await sb.from("site_cooldowns").upsert({ host: key, until: new Date(Date.now() + hours * 3600_000).toISOString(), reason, updated_at: new Date().toISOString() });
  log(`cooldown ${key} for ${hours}h: ${reason}`);
}

/** Makes sure there's one saved login per company portal, so every job there reuses it. */
async function ensurePortalLogin(sb: SupabaseClient, userId: string, email: string, company: string, url: string) {
  const host = hostOf(url);
  if (!host) return;
  const { data } = await sb.from("application_accounts").select("id").eq("user_id", userId).eq("portal_host", host).maybeSingle();
  if (data) return;
  await sb.from("application_accounts").insert({
    user_id: userId,
    company_name: company,
    portal_host: host,
    portal_name: host,
    login_url: `https://${host}`,
    email_used: email,
    password_enc: encryptSecret(generatePortalPassword()),
    created_by: "agent",
    account_created: false,
  });
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ── 1+2. Discover and verify ──────────────────────────────────────────────
async function discover(sb: SupabaseClient): Promise<(Posting & { id: string; verification_status: string; verification_score: number })[]> {
  const [interns, newGrad, remote] = await Promise.all([fetchSimplify("internships"), fetchSimplify("new_grad"), fetchRemoteFeeds()]);
  log(`simplify internships=${interns.length} new_grad=${newGrad.length} remote_feeds=${remote.length}`);

  // Companies discovered automatically from the curated lists; scan a rotating slice of their boards each run.
  const simplifyAll = [...interns, ...newGrad];
  const names = new Map<string, string>();
  for (const p of simplifyAll) if (p.ats_board) names.set(`${p.ats}:${p.ats_board.toLowerCase()}`, p.company_name);
  const boards = boardsFrom(simplifyAll);
  const batch = Number(env("BOARD_BATCH", "40"));
  const slot = Math.floor(Date.now() / (3 * 3600_000)) % Math.max(1, Math.ceil(boards.length / batch));
  const slice = boards.slice(slot * batch, slot * batch + batch);
  const boardPostings: Posting[] = [];
  for (const group of chunk(slice, 8)) {
    const res = await Promise.all(
      group.map((b) => (b.ats === "greenhouse" ? fetchGreenhouse(b.board) : b.ats === "lever" ? fetchLever(b.board) : fetchAshby(b.board)))
    );
    for (const list of res)
      for (const p of list) boardPostings.push({ ...p, company_name: names.get(`${p.ats}:${(p.ats_board ?? "").toLowerCase()}`) ?? p.company_name });
  }
  log(`company boards: ${slice.length}/${boards.length} scanned this run → ${boardPostings.length} STEM US postings`);

  const all = new Map<string, Posting>();
  for (const p of [...simplifyAll, ...boardPostings, ...remote]) if (!all.has(p.source_key)) all.set(p.source_key, p);
  const postings = [...all.values()];

  const limits = await freeTierSnapshot(sb);
  if (!limits.database.allowed) {
    log(`SKIP saving postings: ${limits.database.reason}`);
    return [];
  }

  const now = new Date().toISOString();
  const saved: (Posting & { id: string; verification_status: string; verification_score: number })[] = [];
  for (const part of chunk(postings, 400)) {
    const rows = part.map((p) => {
      const v = verifyPosting(p);
      return {
        ...p,
        salary_min: p.salary_min ?? null,
        salary_max: p.salary_max ?? null,
        last_seen_at: now,
        active: true,
        verification_status: v.status,
        verification_score: v.score,
        verification_signals: v.signals,
        verified_at: now,
      };
    });
    const { data, error } = await sb.from("job_postings").upsert(rows, { onConflict: "source_key" }).select("id,source_key");
    if (error) {
      log("posting upsert error:", error.message);
      continue;
    }
    const ids = new Map((data ?? []).map((r) => [r.source_key as string, r.id as string]));
    for (const r of rows) {
      const id = ids.get(r.source_key);
      if (id) saved.push({ ...r, salary_min: r.salary_min ?? undefined, salary_max: r.salary_max ?? undefined, id });
    }
  }
  await bumpUsage(sb, "jobs_discovered", saved.length);

  // Postings no longer listed go inactive; old inactive ones are removed to keep the database small.
  await sb.from("job_postings").update({ active: false }).lt("last_seen_at", new Date(Date.now() - 4 * 86400_000).toISOString()).eq("active", true);
  await sb.from("job_postings").delete().eq("active", false).lt("last_seen_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  const counts = saved.reduce<Record<string, number>>((m, p) => ((m[p.verification_status] = (m[p.verification_status] ?? 0) + 1), m), {});
  log(`saved ${saved.length} postings`, counts);
  return saved;
}

// ── 3. Match per user ─────────────────────────────────────────────────────
interface UserRow {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  school: string | null;
  graduation_date: string | null;
  work_authorized_us: boolean | null;
  sponsorship_needed: boolean | null;
  relocation: boolean | null;
  skills: string[] | null;
  target_roles: string[] | null;
  job_levels: string[] | null;
  min_salary: number | null;
  locations: string[] | null;
  keywords_include: string[] | null;
  keywords_exclude: string[] | null;
  excluded_companies: string[] | null;
  resume_path: string | null;
  resume_parsed: ParsedResume | null;
  resume_updated_at: string | null;
  updated_at: string | null;
}
interface Settings {
  user_id: string;
  paused: boolean | null;
  emergency_stop: boolean | null;
  auto_submit_enabled: boolean | null;
  daily_apply_cap: number | null;
  min_fit_score: number | null;
}

function toMatchProfile(u: UserRow): MatchProfile {
  return {
    skills: [...new Set([...(u.skills ?? []), ...(u.resume_parsed?.skills ?? [])])],
    target_roles: u.target_roles?.length ? u.target_roles : (u.resume_parsed?.target_roles ?? []),
    job_levels: u.job_levels ?? ["internship", "new_grad", "entry"],
    min_salary: u.min_salary ?? 80000,
    locations: u.locations ?? ["remote_us", "GA"],
    relocation: u.relocation,
    keywords_include: u.keywords_include ?? [],
    keywords_exclude: u.keywords_exclude ?? [],
    excluded_companies: u.excluded_companies ?? [],
  };
}

async function matchUser(
  sb: SupabaseClient,
  u: UserRow,
  fresh: (Posting & { id: string; verification_status: string; verification_score: number })[],
  lastRunAt: string | null
): Promise<number> {
  let pool = fresh;
  // Profile changed since last run → re-match against the stored pool, not just new postings.
  const changed = !lastRunAt || [u.updated_at, u.resume_updated_at].some((t) => t && t > lastRunAt);
  if (changed) {
    const { data } = await sb
      .from("job_postings")
      .select("id,source,source_key,company_name,title,level,locations,is_remote,url,apply_url,ats,salary_min,salary_max,description,verification_status,verification_score,posted_at")
      .eq("active", true)
      .neq("verification_status", "rejected")
      .order("last_seen_at", { ascending: false })
      .limit(4000);
    pool = (data ?? []) as typeof fresh;
  }
  const profile = toMatchProfile(u);
  const matches = pool
    .filter((p) => p.verification_status !== "rejected")
    .map((p) => ({ p, m: matchPosting(profile, { ...p, salary_min: p.salary_min ?? null, salary_max: p.salary_max ?? null, description: p.description ?? null, level: p.level }) }))
    .filter((x) => x.m.eligible && x.m.score >= 40)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 300);
  if (!matches.length) return 0;
  const rows = matches.map(({ p, m }) => ({
    user_id: u.id,
    idempotency_key: p.source_key,
    posting_id: p.id,
    title: p.title,
    company_name: p.company_name,
    url: p.url,
    source: p.source,
    fit_score: m.score,
    fit_reasons: m.reasons,
    trust_score: p.verification_score,
  }));
  for (const part of chunk(rows, 300)) {
    const { error } = await sb.from("jobs").upsert(part, { onConflict: "user_id,idempotency_key" });
    if (error) log(`jobs upsert error for ${u.id}:`, error.message);
  }
  return rows.length;
}

// ── 4. Auto-apply per user ────────────────────────────────────────────────
async function applyForUser(sb: SupabaseClient, u: UserRow, s: Settings, browser: import("playwright").Browser): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const cap = Math.max(0, Math.min(25, s.daily_apply_cap ?? 5));
  const { count: doneToday } = await sb
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", u.id)
    .eq("status", "submitted")
    .gte("submitted_at", `${today()}T00:00:00Z`);
  let remaining = cap - (doneToday ?? 0);
  if (remaining <= 0) return { cap_reached: 1 };
  if (!u.resume_parsed?.experience && !u.resume_path) return { no_resume: 1 };
  const email = u.job_email;
  const [first, ...rest] = (u.full_name ?? "").trim().split(/\s+/);
  const firstName = u.first_name || first;
  const lastName = u.last_name || rest.join(" ");
  if (!email || !firstName || !lastName) return { missing_contact: 1 };

  // Queued by the user (chat or Jobs page) first, then the agent's best verified matches.
  const { data: queued } = await sb
    .from("applications")
    .select("id,job_id,status,attempts")
    .eq("user_id", u.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(remaining * 2);
  const { data: existing } = await sb.from("applications").select("job_id").eq("user_id", u.id);
  const taken = new Set((existing ?? []).map((a) => a.job_id));
  const minFit = s.min_fit_score ?? 65;
  const { data: best } = await sb
    .from("jobs")
    .select("id,title,company_name,url,fit_score,posting_id,dismissed, job_postings!inner(ats,apply_url,url,verification_status,description)")
    .eq("user_id", u.id)
    .eq("dismissed", false)
    .gte("fit_score", minFit)
    .eq("job_postings.verification_status", "verified")
    .in("job_postings.ats", ["greenhouse", "lever", "ashby"])
    .order("fit_score", { ascending: false })
    .limit(60);

  type JobRow = { id: string; title: string; company_name: string; url: string; posting_id: string; job_postings: { ats: string; apply_url: string; url: string; verification_status: string; description: string } };
  const queue: { appId?: string; job: JobRow }[] = [];
  if (queued?.length) {
    const { data: qJobs } = await sb
      .from("jobs")
      .select("id,title,company_name,url,posting_id, job_postings!inner(ats,apply_url,url,verification_status,description)")
      .in("id", queued.map((q) => q.job_id));
    for (const q of queued) {
      const j = (qJobs ?? []).find((x) => x.id === q.job_id) as unknown as JobRow | undefined;
      if (j) queue.push({ appId: q.id, job: j });
    }
  }
  const companiesApplied = new Set<string>();
  for (const j of (best ?? []) as unknown as JobRow[]) if (!taken.has(j.id)) queue.push({ job: j });

  // Pacing data: cooldowns, companies applied to recently, and today's per-site volume (all users).
  const cooldowns = await activeCooldowns(sb);
  const { data: recentApps } = await sb
    .from("applications")
    .select("jobs(company_name)")
    .eq("user_id", u.id)
    .in("status", ["submitted", "received", "under_review", "interview", "offer", "rejected"])
    .gte("submitted_at", new Date(Date.now() - COMPANY_GAP_DAYS * 86400_000).toISOString());
  for (const a of (recentApps ?? []) as unknown as { jobs: { company_name: string } | null }[])
    if (a.jobs?.company_name) companiesApplied.add(a.jobs.company_name.toLowerCase());
  const { data: todayAll } = await sb.from("applications").select("apply_url").eq("status", "submitted").gte("submitted_at", `${today()}T00:00:00Z`);
  const hostCount: Record<string, number> = {};
  for (const a of todayAll ?? []) {
    const h = hostOf(a.apply_url ?? "");
    hostCount[h] = (hostCount[h] ?? 0) + 1;
  }
  let submittedThisRun = 0;

  const dir = mkdtempSync(join(tmpdir(), "9to5-"));
  let original: string | null = null;
  if (u.resume_path) {
    const { data } = await sb.storage.from("resumes").download(u.resume_path);
    if (data) {
      original = join(dir, "resume.pdf");
      writeFileSync(original, Buffer.from(await data.arrayBuffer()));
    }
  }
  const applicant: Applicant = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: u.phone,
    city: u.city,
    state: u.state,
    linkedin_url: u.linkedin_url,
    github_url: u.github_url,
    website_url: u.website_url,
    school: u.school,
    graduation_date: u.graduation_date,
    work_authorized_us: u.work_authorized_us,
    sponsorship_needed: u.sponsorship_needed,
    resume_text: u.resume_parsed ? resumeToText(u.resume_parsed) : "",
  };

  for (const { appId, job } of queue) {
    if (remaining <= 0) break;
    const company = job.company_name.toLowerCase();
    if (!appId && companiesApplied.has(company)) continue; // one auto-application per company per run
    const p = job.job_postings;
    const auto = canAutoSubmit({ ats: p.ats, verification_status: p.verification_status, apply_url: p.apply_url, url: p.url });
    const base = { user_id: u.id, job_id: job.id, posting_id: job.posting_id, apply_url: p.apply_url || p.url, ats: p.ats, fit_score: undefined as number | undefined };
    const applyUrl = p.apply_url || p.url;
    if (!auto) {
      const needsAccount = ACCOUNT_SITES.test(applyUrl);
      if (needsAccount) await ensurePortalLogin(sb, u.id, email, job.company_name, applyUrl);
      const why = needsAccount
        ? "This site needs an account. Your login for it is ready under Portal logins — create the account, then apply."
        : "Not an auto-submit site or not fully verified — apply yourself";
      await sb.from("applications").upsert({ ...base, status: "needs_user", error: why }, { onConflict: "user_id,job_id" });
      result.needs_user = (result.needs_user ?? 0) + 1;
      continue;
    }
    const key = siteKey(applyUrl);
    const host = hostOf(applyUrl);
    if (cooldowns.has(key) || cooldowns.has(host)) {
      result.cooling_down = (result.cooling_down ?? 0) + 1;
      continue; // retried after the cooldown ends
    }
    if ((hostCount[host] ?? 0) >= ATS_DAILY_CAP) {
      result.site_daily_cap = (result.site_daily_cap ?? 0) + 1;
      continue;
    }
    const dryRun = env("APPLY_DRY_RUN") === "true";
    if (submittedThisRun > 0 && !dryRun) {
      // Human pace between submissions instead of bursts.
      await sleep((PACE_MIN_S + Math.random() * Math.max(0, PACE_MAX_S - PACE_MIN_S)) * 1000);
    }
    const budget = await checkGemini(sb);
    if (!budget.allowed) {
      log(`stop applying: ${budget.reason}`);
      result.gemini_limit = 1;
      break;
    }

    let resumePath = original;
    let focus: string | null = null;
    if (u.resume_parsed?.experience?.length) {
      const tailored = tailorResume(u.resume_parsed, `${job.title}\n${p.description ?? ""}`);
      focus = resumeFocus(tailored.skills);
      const pdf = await renderResumePdf(tailored);
      resumePath = join(dir, `${(applicant.first_name + "_" + applicant.last_name).replace(/[^a-z0-9_]/gi, "")}_Resume.pdf`);
      writeFileSync(resumePath, pdf);
    }
    if (!resumePath) return { no_resume: 1 };

    const r = await applyToJob(browser, sb, {
      url: p.apply_url || p.url,
      ats: p.ats,
      applicant,
      resumePath,
      jobTitle: job.title,
      company: job.company_name,
      userId: u.id,
      dryRun,
    });
    log(`apply ${u.id.slice(0, 8)} → ${job.company_name} / ${job.title}: ${r.status} (${r.detail})`);
    const status = r.status === "closed" ? "closed" : r.status;
    await sb.from("applications").upsert(
      {
        ...base,
        status,
        error: r.status === "submitted" ? null : r.detail,
        answers: r.answers ?? {},
        submitted_at: r.status === "submitted" ? new Date().toISOString() : null,
        requested_by: appId ? "user" : "agent",
        resume_focus: focus,
        status_updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,job_id" }
    );
    // Back off from sites that push back, instead of retrying through them.
    if (/captcha/i.test(r.detail)) await coolDown(sb, key, 24, "CAPTCHA shown");
    else if (/\b(429|403)\b|too many|rate limit|blocked|access denied/i.test(r.detail)) {
      await coolDown(sb, key, 24, r.detail.slice(0, 120));
      await coolDown(sb, host, 6, "rate limited");
    }
    result[status] = (result[status] ?? 0) + 1;
    if (r.status === "submitted") {
      remaining--;
      submittedThisRun++;
      hostCount[host] = (hostCount[host] ?? 0) + 1;
      const { data: appRow } = await sb.from("applications").select("id").eq("user_id", u.id).eq("job_id", job.id).maybeSingle();
      if (appRow)
        await sb.from("application_events").insert({ user_id: u.id, application_id: appRow.id, kind: "submitted", source: "agent", detail: focus ? `Resume led with ${focus}` : null });
      companiesApplied.add(company);
      await bumpUsage(sb, "applications_submitted", 1);
      await bumpUsage(sb, "applications_submitted", 1, u.id);
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const sb = db();
  const limits = await freeTierSnapshot(sb);
  if (!limits.githubMinutes.allowed) {
    log(`Skipping run: ${limits.githubMinutes.reason}`);
    return;
  }

  const fresh = env("DISCOVER", "true") === "false" ? [] : await discover(sb);

  let usersQ = sb.from("profiles").select("*");
  if (env("ONLY_USER")) usersQ = usersQ.eq("id", env("ONLY_USER"));
  const [{ data: users }, { data: settings }] = await Promise.all([usersQ, sb.from("autopilot_settings").select("*")]);
  const settingsBy = new Map((settings ?? []).map((s) => [s.user_id as string, s as Settings]));

  let browser: import("playwright").Browser | null = null;
  for (const u of (users ?? []) as UserRow[]) {
    const s = settingsBy.get(u.id);
    if (!s || s.paused || s.emergency_stop) continue;
    if (!u.resume_parsed || !Object.keys(u.resume_parsed).length) continue;

    const { data: lastRun } = await sb.from("agent_runs").select("started_at").eq("user_id", u.id).eq("status", "completed").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: run } = await sb.from("agent_runs").insert({ user_id: u.id, status: "running", mock_mode: false }).select("id").single();
    const summary: Record<string, unknown> = {};
    try {
      summary.matched = await matchUser(sb, u, fresh, lastRun?.started_at ?? null);
      if (env("APPLY", "true") !== "false" && s.auto_submit_enabled) {
        if (!browser) {
          const { chromium } = await import("playwright");
          browser = await chromium.launch({ headless: true });
        }
        summary.applications = await applyForUser(sb, u, s, browser);
      }
      if (env("INBOX", "true") !== "false") summary.inbox = await scanInbox(sb, u as never, (m) => log(m));
      await sb.from("agent_runs").update({ status: "completed", ended_at: new Date().toISOString(), summary }).eq("id", run?.id);
      await sb.from("agent_logs").insert({ user_id: u.id, run_id: run?.id, level: "info", message: "Agent run completed", metadata: summary });
      log(`user ${u.id.slice(0, 8)}:`, JSON.stringify(summary));
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("agent_runs").update({ status: "failed", ended_at: new Date().toISOString(), summary: { ...summary, error: msg } }).eq("id", run?.id);
      await sb.from("agent_logs").insert({ user_id: u.id, run_id: run?.id, level: "error", message: msg });
      log(`user ${u.id.slice(0, 8)} failed:`, msg);
    }
  }
  if (browser) await browser.close();

  // Count this run's GitHub Actions minutes (+2 for setup steps) toward the free monthly budget.
  if (process.env.GITHUB_ACTIONS === "true") {
    const minutes = Math.ceil((Date.now() - startedAt) / 60000) + 2;
    await bumpUsage(sb, "github_actions_minutes", minutes);
  }
  log(`done in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch((e) => {
  console.error("[9to5] agent failed:", e);
  process.exit(1);
});
