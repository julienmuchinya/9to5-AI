import type { Browser, Page } from "playwright";

/**
 * Where a job on an employer's own careers site (or any site the agent has no special support for) is really
 * applied to. Opens the page like a person: looks for an application form embedded in it (Greenhouse, Lever, Ashby,
 * Workable, Workday, Jobvite…), otherwise presses "Apply" and sees where that leads.
 *   - a known application system → apply there with its tested filler,
 *   - a plain application form (resume upload + email, no password) → the generic filler,
 *   - a sign-in / create-account wall → hand it to the user with that reason.
 */
export type ApplyTarget =
  | { kind: "ats"; url: string; ats: string }
  | { kind: "form"; url: string }
  | { kind: "account"; url: string; why: string }
  | { kind: "closed"; why: string }
  | { kind: "none"; why: string };

const KNOWN: { re: RegExp; ats: string }[] = [
  { re: /(job-boards|boards)\.greenhouse\.io\/(embed\/job_app\?[^"'\s<>]*|[^/"'\s<>]+\/jobs\/\d+[^"'\s<>]*)/i, ats: "greenhouse" },
  { re: /jobs\.lever\.co\/[^/"'\s<>]+\/[0-9a-f-]{36}[^"'\s<>]*/i, ats: "lever" },
  { re: /jobs\.ashbyhq\.com\/[^/"'\s<>]+\/[0-9a-f-]{36}[^"'\s<>]*/i, ats: "ashby" },
  { re: /apply\.workable\.com\/[^/"'\s<>]+\/j\/[A-Z0-9]+[^"'\s<>]*/i, ats: "other" },
  { re: /jobs\.jobvite\.com\/[^/"'\s<>]+\/job\/[^"'\s<>]+/i, ats: "other" },
  { re: /ats\.rippling\.com\/[^/"'\s<>]+\/jobs\/[^"'\s<>]+/i, ats: "other" },
  { re: /[a-z0-9-]+\.applytojob\.com\/apply\/[^"'\s<>]+/i, ats: "other" },
  { re: /[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/[^"'\s<>]+/i, ats: "workday" },
];
/** Sites that always need an account (or a big-company login) before applying. */
const ACCOUNT = /(icims\.com|taleo\.net|successfactors|sapsf|oraclecloud\.com|brassring\.com|ultipro\.com|ukg\.net|avature\.net|phenompeople\.com|paylocity\.com|adp\.com|dayforcehcm\.com|paycomonline\.net|amazon\.jobs|metacareers\.com|careers\.microsoft\.com|jobs\.apple\.com|lifeattiktok\.com|careers\.google\.com|tesla\.com|eightfold\.ai)/i;

/** Sites that can't be applied to without an account / big-company login (checked without opening them). */
export const needsAccountSite = (url: string) => ACCOUNT.test(url);

function knownIn(text: string): { url: string; ats: string } | null {
  for (const k of KNOWN) {
    const m = text.match(k.re);
    if (m) return { url: `https://${m[0].replace(/&amp;/g, "&").replace(/^https?:\/\//, "")}`, ats: k.ats };
  }
  return null;
}

async function scan(page: Page): Promise<ApplyTarget | null> {
  const url = page.url();
  const here = knownIn(url);
  if (here) return { kind: "ats", ...here };
  if (ACCOUNT.test(url)) return { kind: "account", url, why: `${new URL(url).hostname} needs an account to apply` };
  // Embedded forms (iframes) and links on the page.
  const srcs = await page.evaluate(() => [...Array.from(document.querySelectorAll("iframe")).map((f) => f.src), ...Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href)].join("\n")).catch(() => "");
  const inPage = knownIn(srcs);
  if (inPage) return { kind: "ats", ...inPage };
  // A sign-in wall: a password box, or "sign in / create an account to apply".
  const wall = await page
    .evaluate(() => {
      const pw = Array.from(document.querySelectorAll("input[type=password]")).some((e) => (e as HTMLElement).getBoundingClientRect().width > 0);
      return pw || /(sign in|log in|create (an )?account|register) to (apply|continue)/i.test(document.body?.innerText ?? "");
    })
    .catch(() => false);
  if (wall) return { kind: "account", url, why: `${new URL(url).hostname} asks you to sign in or create an account before applying` };
  // A plain application form right here: a resume upload and an email box.
  const form = await page
    .evaluate(() => {
      const shown = (e: Element) => (e as HTMLElement).getBoundingClientRect().width > 0 || (e as HTMLInputElement).type === "file";
      const file = Array.from(document.querySelectorAll("input[type=file]")).some(shown);
      const email = Array.from(document.querySelectorAll("input[type=email], input[name*=email i], input[id*=email i]")).some(shown);
      return file && email;
    })
    .catch(() => false);
  if (form) return { kind: "form", url };
  return null;
}

/** Never more than ~45 s per job: some careers sites never finish loading. */
export async function resolveApplyTarget(browser: Browser, startUrl: string): Promise<ApplyTarget> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<ApplyTarget>((r) => (timer = setTimeout(() => r({ kind: "none", why: "the careers site took too long to load" }), 45_000)));
  try {
    return await Promise.race([resolveOnce(browser, startUrl), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOnce(browser: Browser, startUrl: string): Promise<ApplyTarget> {
  if (ACCOUNT.test(startUrl)) return { kind: "account", url: startUrl, why: `${new URL(startUrl).hostname} needs an account to apply` };
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", viewport: { width: 1280, height: 1600 } });
  await context.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const res = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (res && [404, 410].includes(res.status())) return { kind: "closed", why: "the posting is gone (the job page no longer exists)" };
    if (!res || res.status() >= 400) return { kind: "none", why: `the job page didn't open (${res?.status() ?? "no response"})` };
    if (/(no longer (available|accepting|open)|position (has been )?(filled|closed)|job (is )?(closed|expired)|this job has expired)/i.test(((await page.innerText("body").catch(() => "")) ?? "").slice(0, 3000)))
      return { kind: "closed", why: "the employer says this job is closed" };
    await page.waitForTimeout(2500);
    const first = await scan(page);
    if (first) return first;
    // Press the page's Apply button; it may open a new tab.
    const apply = page.locator("a:visible, button:visible").filter({ hasText: /^\s*(apply( now| for this (job|position|role))?|start (your )?application|i('|’)m interested)\s*$/i }).first();
    if (!(await apply.count())) return { kind: "none", why: "no Apply button or application form on the job page" };
    const popup = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await apply.click().catch(() => {});
    const next = (await popup) ?? page;
    await next.waitForLoadState("domcontentloaded").catch(() => {});
    await next.waitForTimeout(3000);
    return (await scan(next)) ?? { kind: "none", why: `pressing Apply led to ${new URL(next.url()).hostname}, which shows no form the agent can fill` };
  } catch (e) {
    return { kind: "none", why: (e as Error).message.slice(0, 120) };
  } finally {
    await context.close().catch(() => {});
  }
}
