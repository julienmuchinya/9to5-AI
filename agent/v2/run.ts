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
import { decryptSecret, encryptSecret, generatePortalPassword } from "../../src/lib/v2/vault";
import { COMPANY_DAILY_CAP, companyKey, planQueue } from "../../src/lib/v2/priority";
import { rememberAnswers, type AppAnswers } from "../../src/lib/v2/app-questions";

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
const PACE_MIN_S = Number(env("PACE_MIN_S", "20"));
const PACE_MAX_S = Number(env("PACE_MAX_S", "45"));
const ATS_DAILY_CAP = Number(env("ATS_DAILY_CAP", "80")); // per ATS host, all users combined
const COMPANY_CAP = Number(env("COMPANY_DAILY_CAP", String(COMPANY_DAILY_CAP))); // per company, per user, per day
const MAX_DAILY_CAP = 100;
// Stop starting new applications after this many minutes, so the run ends before the workflow timeout.
const RUN_BUDGET_MS = Number(env("RUN_BUDGET_MIN", "40")) * 60_000;
const timeLeft = () => RUN_BUDGET_MS - (Date.now() - startedAt);

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
  await sb.from("application_accounts").upsert(
    {
      user_id: userId,
      company_name: company,
      portal_host: host,
      portal_name: host,
      login_url: `https://${host}`,
      email_used: email,
      password_enc: encryptSecret(generatePortalPassword()),
      created_by: "agent",
      account_created: false,
    },
    { onConflict: "user_id,portal_host", ignoreDuplicates: true }
  );
}

/** The saved login for this portal, decrypted, if there is one. */
async function portalLogin(sb: SupabaseClient, userId: string, url: string): Promise<{ email: string; password: string } | null> {
  const host = hostOf(url);
  if (!host) return null;
  const { data } = await sb.from("application_accounts").select("email_used,password_enc").eq("user_id", userId).eq("portal_host", host).maybeSingle();
  if (!data?.password_enc) return null;
  try {
    return { email: data.email_used, password: decryptSecret(data.password_enc) };
  } catch {
    return null;
  }
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
  application_answers?: AppAnswers | null;
  answer_memory?: AppAnswers | null;
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
type JobRow = {
  id: string;
  title: string;
  company_name: string;
  url: string;
  fit_score: number | null;
  posting_id: string;
  job_postings: { ats: string; apply_url: string; url: string; verification_status: string; description: string; posted_at: string | null };
};
const JOB_COLS = "id,title,company_name,url,fit_score,posting_id, job_postings!inner(ats,apply_url,url,verification_status,description,posted_at)";

async function applyForUser(sb: SupabaseClient, u: UserRow, s: Settings, browser: import("playwright").Browser): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const bump = (k: string) => (result[k] = (result[k] ?? 0) + 1);
  const dryRun = env("APPLY_DRY_RUN") === "true";
  const cap = Math.max(0, Math.min(MAX_DAILY_CAP, s.daily_apply_cap ?? 5));
  const startOfDay = `${today()}T00:00:00Z`;

  // Today's submissions for this user, overall and per company (max COMPANY_CAP per company per day).
  const { data: todayApps } = await sb.from("applications").select("status, jobs(company_name)").eq("user_id", u.id).gte("submitted_at", startOfDay);
  const perCompanyToday: Record<string, number> = {};
  for (const a of (todayApps ?? []) as unknown as { jobs: { company_name: string } | null }[]) {
    const k = companyKey(a.jobs?.company_name);
    if (k) perCompanyToday[k] = (perCompanyToday[k] ?? 0) + 1;
  }
  let remaining = cap - (todayApps ?? []).length;
  if (remaining <= 0) return { cap_reached: 1 };
  if (!u.resume_parsed?.experience && !u.resume_path) return { no_resume: 1 };
  const email = u.job_email;
  const [first, ...rest] = (u.full_name ?? "").trim().split(/\s+/);
  const firstName = u.first_name || first;
  const lastName = u.last_name || rest.join(" ");
  if (!email || !firstName || !lastName) return { missing_contact: 1 };

  // Candidates: everything the user queued + the agent's best verified matches.
  const { data: queued } = await sb.from("applications").select("id,job_id").eq("user_id", u.id).eq("status", "queued").order("created_at").limit(400);
  const { data: existing } = await sb.from("applications").select("job_id").eq("user_id", u.id);
  const taken = new Set((existing ?? []).map((a) => a.job_id));
  const minFit = s.min_fit_score ?? 65;
  const { data: best } = await sb
    .from("jobs")
    .select(JOB_COLS)
    .eq("user_id", u.id)
    .eq("dismissed", false)
    .gte("fit_score", minFit)
    .eq("job_postings.verification_status", "verified")
    .in("job_postings.ats", ["greenhouse", "lever", "ashby"])
    .order("fit_score", { ascending: false })
    .limit(200);

  type Item = { appId?: string; job: JobRow; company: string; fit: number; postedAt: string | null; userRequested: boolean };
  const items: Item[] = [];
  const appByJob = new Map((queued ?? []).map((q) => [q.job_id as string, q.id as string]));
  for (const part of chunk([...appByJob.keys()], 100)) {
    const { data: qJobs } = await sb.from("jobs").select(JOB_COLS).in("id", part);
    for (const j of (qJobs ?? []) as unknown as JobRow[])
      items.push({ appId: appByJob.get(j.id), job: j, company: j.company_name, fit: j.fit_score ?? 50, postedAt: j.job_postings.posted_at, userRequested: true });
  }
  for (const j of (best ?? []) as unknown as JobRow[])
    if (!taken.has(j.id)) items.push({ job: j, company: j.company_name, fit: j.fit_score ?? 50, postedAt: j.job_postings.posted_at, userRequested: false });

  // Freshest + best-fitting first; at most COMPANY_CAP per company per day.
  const { picked, skippedForCompanyCap } = planQueue(items, { appliedToday: perCompanyToday, perCompany: COMPANY_CAP });
  for (const x of skippedForCompanyCap) {
    bump("company_daily_cap");
    if (x.appId && !dryRun)
      await sb.from("applications").update({ error: `Waiting: ${COMPANY_CAP} applications to ${x.company} already planned today — goes on a later day` }).eq("id", x.appId);
  }

  // Pacing data: cooldowns and today's per-site volume (all users).
  const cooldowns = await activeCooldowns(sb);
  const { data: todayAll } = await sb.from("applications").select("apply_url").eq("status", "submitted").gte("submitted_at", startOfDay);
  const hostCount: Record<string, number> = {};
  for (const a of todayAll ?? []) {
    const h = hostOf(a.apply_url ?? "");
    hostCount[h] = (hostCount[h] ?? 0) + 1;
  }
  let submittedThisRun = 0;
  let memory: AppAnswers = { ...(u.answer_memory ?? {}) };
  let memoryChanged = false;

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
    relocation: u.relocation,
    resume_text: u.resume_parsed ? resumeToText(u.resume_parsed) : "",
    answers: u.application_answers ?? {},
    memory,
  };
  const save = async (row: Record<string, unknown>) => {
    if (dryRun) return; // dry runs never change the user's applications
    const { error } = await sb.from("applications").upsert({ ...row, status_updated_at: new Date().toISOString() }, { onConflict: "user_id,job_id" });
    if (error) log(`application save error: ${error.message}`);
  };

  const attemptLimit = Number(env("APPLY_LIMIT", "0")) || Infinity; // for testing: try at most N forms
  let attempts = 0;
  for (const { appId, job } of picked) {
    if (remaining <= 0 || attempts >= attemptLimit) break;
    if (timeLeft() < 4 * 60_000) {
      log("run time budget used; leaving the rest of the queue for the next run");
      result.time_budget = 1;
      break;
    }
    const company = companyKey(job.company_name);
    if ((perCompanyToday[company] ?? 0) >= COMPANY_CAP) {
      bump("company_daily_cap");
      continue;
    }
    const p = job.job_postings;
    const applyUrl = p.apply_url || p.url;
    const auto = canAutoSubmit({ ats: p.ats, verification_status: p.verification_status, apply_url: p.apply_url, url: p.url });
    const base = { user_id: u.id, job_id: job.id, posting_id: job.posting_id, apply_url: applyUrl, ats: p.ats, requested_by: appId ? "user" : "agent" };
    if (!auto) {
      const needsAccount = ACCOUNT_SITES.test(applyUrl);
      if (needsAccount && !dryRun) await ensurePortalLogin(sb, u.id, email, job.company_name, applyUrl);
      const why = needsAccount
        ? "This site needs an account. The email and password to use are on this card and under Portal logins — create the account, then apply."
        : "The agent can only submit verified Greenhouse, Lever and Ashby jobs — open this one and apply yourself";
      await save({ ...base, status: "needs_user", error: why });
      bump("needs_user");
      continue;
    }
    const key = siteKey(applyUrl);
    const host = hostOf(applyUrl);
    if (cooldowns.has(key) || cooldowns.has(host)) {
      bump("cooling_down");
      if (appId && !dryRun) await sb.from("applications").update({ error: `Waiting: ${host} asked us to slow down — retrying after the cooldown` }).eq("id", appId);
      continue;
    }
    if ((hostCount[host] ?? 0) >= ATS_DAILY_CAP) {
      bump("site_daily_cap");
      continue;
    }
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

    attempts++;
    applicant.portal = await portalLogin(sb, u.id, applyUrl);
    applicant.memory = memory;
    const t0 = Date.now();
    const r = await applyToJob(browser, sb, { url: applyUrl, ats: p.ats, applicant, resumePath, jobTitle: job.title, company: job.company_name, userId: u.id, dryRun });
    log(`apply ${u.id.slice(0, 8)} → ${job.company_name} / ${job.title}: ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s, ${r.aiCalls ?? 0} AI call(s) (${r.detail})`);
    if (dryRun && r.answers) log("  answers:", JSON.stringify(r.answers).slice(0, 1500));
    if (r.aiCalls) result.ai_calls = (result.ai_calls ?? 0) + r.aiCalls;
    if (r.learned?.length) {
      memory = rememberAnswers(memory, r.learned.map((x) => ({ ...x, company: job.company_name })));
      memoryChanged = true;
    }
    // A timeout or crash on a queued job goes back in the queue (up to 3 tries) instead of being lost.
    let status: string = r.status;
    if (r.status === "failed" && appId && !dryRun) {
      const { data: row } = await sb.from("applications").select("attempts").eq("id", appId).maybeSingle();
      const attempts = (row?.attempts ?? 0) + 1;
      await sb.from("applications").update({ attempts }).eq("id", appId);
      if (attempts < 3) status = "queued";
    }
    await save({
      ...base,
      status,
      error: r.status === "submitted" ? null : r.detail,
      answers: r.answers ?? {},
      submitted_at: r.status === "submitted" ? new Date().toISOString() : null,
      resume_focus: focus,
    });
    if (r.usedPortalLogin && !dryRun)
      await sb.from("application_accounts").update({ account_created: true, notes: `Used on the ${job.title} application` }).eq("user_id", u.id).eq("portal_host", host);
    // Back off from sites that push back, instead of retrying through them.
    if (!dryRun) {
      if (/captcha/i.test(r.detail)) await coolDown(sb, key, 24, "CAPTCHA shown");
      else if (/\b(429|403)\b|too many|rate limit|blocked|access denied/i.test(r.detail)) {
        await coolDown(sb, key, 24, r.detail.slice(0, 120));
        await coolDown(sb, host, 6, "rate limited");
      }
    }
    bump(r.status);
    if (r.status === "submitted") {
      remaining--;
      submittedThisRun++;
      hostCount[host] = (hostCount[host] ?? 0) + 1;
      perCompanyToday[company] = (perCompanyToday[company] ?? 0) + 1;
      if (!dryRun) {
        const { data: appRow } = await sb.from("applications").select("id").eq("user_id", u.id).eq("job_id", job.id).maybeSingle();
        if (appRow)
          await sb.from("application_events").insert({ user_id: u.id, application_id: appRow.id, kind: "submitted", source: "agent", detail: focus ? `Resume led with ${focus}` : null });
        await bumpUsage(sb, "applications_submitted", 1);
        await bumpUsage(sb, "applications_submitted", 1, u.id);
      }
    }
  }
  if (memoryChanged && !dryRun) {
    const { error } = await sb.from("profiles").update({ answer_memory: memory }).eq("id", u.id);
    if (error) log(`couldn't save remembered answers: ${error.message}`);
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

  // Runs killed by a timeout stay "running" forever; close them so the app doesn't show them as live.
  await sb
    .from("agent_runs")
    .update({ status: "failed", ended_at: new Date().toISOString(), summary: { error: "Run was cut off (timeout); the next run picks up where it stopped" } })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 90 * 60_000).toISOString());

  const fresh = env("DISCOVER", "true") === "false" ? [] : await discover(sb);

  let usersQ = sb.from("profiles").select("*");
  if (env("ONLY_USER")) usersQ = usersQ.eq("id", env("ONLY_USER"));
  const [{ data: users }, { data: settings }] = await Promise.all([usersQ, sb.from("autopilot_settings").select("*")]);
  const settingsBy = new Map((settings ?? []).map((s) => [s.user_id as string, s as Settings]));

  let browser: import("playwright").Browser | null = null;
  for (const u of (users ?? []) as UserRow[]) {
    const s = settingsBy.get(u.id);
    const skip = !s
      ? "no autopilot settings row"
      : s.paused
        ? "paused by you"
        : s.emergency_stop
          ? "emergency stop is on"
          : !u.resume_parsed || !Object.keys(u.resume_parsed).length
            ? "resume not uploaded or not read yet"
            : null;
    if (skip) {
      log(`user ${u.id.slice(0, 8)} skipped: ${skip}`);
      await sb.from("agent_logs").insert({ user_id: u.id, level: "warn", message: `Agent skipped your account: ${skip}`, metadata: { area: "agent" } });
      continue;
    }
    if (!s) continue;

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
      await sb.from("agent_logs").insert({ user_id: u.id, run_id: run?.id, level: "info", message: "Agent run completed", metadata: { area: "agent", ...summary } });
      log(`user ${u.id.slice(0, 8)}:`, JSON.stringify(summary));
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("agent_runs").update({ status: "failed", ended_at: new Date().toISOString(), summary: { ...summary, error: msg } }).eq("id", run?.id);
      await sb.from("agent_logs").insert({ user_id: u.id, run_id: run?.id, level: "error", message: `Agent run failed: ${msg}`, metadata: { area: "agent" } });
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
