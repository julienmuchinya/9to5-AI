/**
 * Workday ("*.myworkdayjobs.com") applications. Every company runs the same product:
 *   job page → Apply → Apply Manually → Create Account / Sign In → 5–7 steps → Review → Submit.
 * The agent signs in with the saved portal login (or creates the account with it, confirming the
 * verification email through the connected Gmail), then fills each step with the same answer
 * pipeline as other sites. Never fills hidden bot-trap fields, never bypasses a CAPTCHA.
 */
import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryKey, type PendingQuestion } from "../../src/lib/v2/app-questions";
import { pickOption } from "../../src/lib/v2/app-questions";
import { SUCCESS, answerFields, captchaVisible, collectFields, fill, labelled, readComboboxOptions, type ApplyOpts, type ApplyResult } from "./apply";

const WD = (id: string) => `[data-automation-id="${id}"]`;
const AUTH_FORM = [WD("createAccountSubmitButton"), WD("signInSubmitButton"), WD("signInContent")].join(", ");
const NEXT = [WD("pageFooterNextButton"), WD("bottom-navigation-next-button"), "button:has-text('Save and Continue')", "button:has-text('Next')"].join(", ");
const ERRORS = [WD("errorMessage"), WD("errorBanner"), "[role=alert]"].join(", ");
/** "Sign in with email" on portals that lead with social logins (never use Google/LinkedIn/Apple sign-in). */
const EMAIL_SIGN_IN = [WD("SignInWithEmailButton"), WD("signInWithEmailButton"), "button:has-text('Sign in with email')", "a:has-text('Sign in with email')"].join(", ");
async function chooseEmailSignIn(page: Page) {
  if (!(await visible(page, EMAIL_SIGN_IN))) return;
  await mouseClick(page, EMAIL_SIGN_IN);
  await page.locator(`${WD("email")}, ${AUTH_FORM}`).first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Debug trace of the Workday flow (only with APPLY_DEBUG_DIR). */
async function trace(page: Page, what: string) {
  if (!process.env.APPLY_DEBUG_DIR) return;
  const st = await page
    .evaluate(() => {
      const vis = (sel: string) => Array.from(document.querySelectorAll(sel)).some((e) => (e as HTMLElement).getBoundingClientRect().width > 0);
      return `create=${vis('[data-automation-id="createAccountSubmitButton"]')} signin=${vis('[data-automation-id="signInSubmitButton"]')} next=${vis('[data-automation-id="pageFooterNextButton"], [data-automation-id="bottom-navigation-next-button"]')} step=${(document.querySelector('[data-automation-id="progressBarActiveStep"]')?.textContent ?? "").replace(/\s+/g, " ").slice(0, 40)}`;
    })
    .catch(() => "?");
  console.log(`[9to5]   wd: ${what} → ${st} ${page.url().replace(/^https:\/\/[^/]+/, "").slice(0, 70)}`);
}

const text = async (page: Page) => ((await page.innerText("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
/** Fill the visible match (Workday keeps hidden copies of the email/password inputs on the same page). */
async function fillVisible(page: Page, sel: string, value: string) {
  const all = page.locator(sel);
  const n = Math.min(await all.count().catch(() => 0), 6);
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value).catch(() => {});
      return;
    }
  }
}

/** True when ANY element matching `sel` is visible (the first match can be a hidden one). */
const visible = async (page: Page, sel: string) => {
  const all = page.locator(sel);
  const n = Math.min(await all.count().catch(() => 0), 10);
  for (let i = 0; i < n; i++) if (await all.nth(i).isVisible().catch(() => false)) return true;
  return false;
};

/**
 * Workday buttons sit under a transparent "click_filter" overlay and ignore synthetic clicks;
 * only a real mouse click at the button's position registers (verified on T-Mobile's portal).
 */
async function clickWd(page: Page, id: string, _label?: string) {
  const all = page.locator(WD(id));
  const n = Math.min(await all.count().catch(() => 0), 5);
  for (let i = 0; i < n; i++) {
    const btn = all.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    const box = await btn.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }
  await all.first().click({ force: true, timeout: 5000 }).catch(() => {});
}

/** Same real-mouse click for any locator (Workday's Save and Continue / Submit). */
async function mouseClick(page: Page, sel: string): Promise<boolean> {
  const all = page.locator(sel);
  const n = Math.min(await all.count().catch(() => 0), 8);
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return true;
    }
  }
  return false;
}

/** After a click that navigates: wait until Workday shows a known screen (form, step, or message). */
async function settle(page: Page, ms = 15000) {
  await page.waitForLoadState("domcontentloaded", { timeout: ms }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page
    .locator(`${AUTH_FORM}, ${NEXT}, ${WD("progressBarActiveStep")}, ${ERRORS}`)
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .catch(() => {});
  await page.waitForTimeout(1000);
}

async function errorsOnPage(page: Page): Promise<string> {
  const errs = (await page.locator(ERRORS).allTextContents().catch(() => [] as string[])).map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!errs.length) {
    const body = await text(page);
    for (const m of body.matchAll(/Error: ([^.]{3,160}\.)/g)) if (!errs.includes(m[1])) errs.push(m[1]);
  }
  return errs.join(" · ").slice(0, 400);
}

/** Remove the last picked item of a Workday multi-select: Backspace in its empty search box. */
async function removeLastPick(page: Page, inputSel: string) {
  const input = page.locator(inputSel).first();
  await input.click().catch(() => {});
  await input.fill("").catch(() => {});
  // First Backspace highlights the last pick, the second deletes it.
  await page.keyboard.press("Backspace").catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press("Backspace").catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Workday "prompt" fields (How Did You Hear About Us?, some locations): a search box that only takes
 * a value picked from its result list. Type, then click the first matching result (descending into
 * a category like "Job Board" if that's what comes up).
 */
async function fillPrompt(page: Page, sel: string, value: string, label = ""): Promise<boolean> {
  const isSource = /(hear|source|referr|learn about|find out about)/i.test(label);
  // The answer itself first; then neutral, honest sources if it isn't listed as such.
  const isMajor = /(field of study|major|discipline|area of study)/i.test(label);
  const tries = isSource
    ? [...new Set([value, "LinkedIn", "Job Board", "Company Website", "Website", "Other"])]
    : [...new Set([value, ...value.split(/[,/&]| and /).map((x) => x.trim()).filter(Boolean), ...(isMajor ? ["Computer Science", "Computer Engineering", "Software Engineering", "Computer and Information Science", "Engineering"] : [])])];
  // A field that already shows a selection (saved draft): keep it only if it IS the intended answer or one of
  // the honest fallbacks; otherwise remove it (e.g. "Alumni Referral" picked for "Referral") and pick again.
  const selected = await page
    .evaluate((s2) => {
      const field = document.querySelector(s2)?.closest("[data-automation-id^=formField]");
      if (!/([1-9]\d*) items? selected/i.test(field?.textContent ?? "")) return null;
      const item = field?.querySelector("[data-automation-id=selectedItem], [data-automation-id=selectedItemList] li");
      return ((item?.textContent ?? field?.textContent ?? "") as string).replace(/\s+/g, " ").trim();
    }, sel)
    .catch(() => null);
  if (selected) {
    const ok = tries.some((t) => new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c)}\\b`, "i").test(selected.replace(/^.*items? selected,?\s*/i, "")));
    if (ok) return true;
    const field = page.locator(sel).locator("xpath=ancestor::*[starts-with(@data-automation-id,'formField')][1]");
    const remove = field.locator(`${WD("DELETE_charm")}, [data-automation-id=removeSelectedItem], button[aria-label*=remove i], [data-automation-id=selectedItem] [role=button]`).first();
    const b = await remove.boundingBox().catch(() => null);
    if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    else await removeLastPick(page, sel);
    await page.waitForTimeout(600);
  }
  for (const [n, v] of tries.entries()) {
    await page.click(sel).catch(() => {});
    await page.fill(sel, "").catch(() => {});
    await page.keyboard.type(v, { delay: 30 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1800);
    for (let depth = 0; depth < 3; depth++) {
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
      const pool = page.locator(`${WD("promptOption")}, [data-automation-id="promptLeafNode"], [role=option]`);
      const exact = pool.filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`, "i") });
      const starts = pool.filter({ hasText: new RegExp(`^\\s*${esc}`, "i") });
      const contains = pool.filter({ hasText: new RegExp(esc.split(" ")[0], "i") });
      // For the user's own answer accept only an exact / starts-with match ("Referral" must not become
      // "Alumni Referral" or "Employee Referral"); the fallback sources may match loosely.
      const strict = isSource && n === 0 && depth === 0;
      const target = (await exact.count())
        ? exact.first()
        : (await starts.count())
          ? starts.first()
          : strict
            ? null
            : (await contains.count())
              ? contains.first()
              : pool.first();
      if (!target) break;
      if (!(await target.isVisible().catch(() => false))) break;
      const box = await target.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1200);
      const picked = await page
        .evaluate((s2) => {
          const el = document.querySelector(s2);
          const field = el?.closest("[data-automation-id^=formField]") ?? el?.parentElement?.parentElement;
          return /([1-9]\d*) items? selected/i.test(field?.textContent ?? "") || Boolean(field?.querySelector("[data-automation-id=selectedItem]"));
        }, sel)
        .catch(() => false);
      if (picked) {
        await page.keyboard.press("Escape").catch(() => {});
        return true;
      }
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

type AuthResult = { ok: true; created: boolean } | { ok: false; result: ApplyResult };

/** Gets past the Create Account / Sign In step. */
async function workdayAuth(page: Page, opts: ApplyOpts): Promise<AuthResult> {
  const portal = opts.applicant.portal;
  // Not the user's problem: the login is created on the next run, so this just retries.
  if (!portal) return { ok: false, result: { status: "failed", detail: "No saved login for this Workday site yet — it is created and tried again on the next run." } };
  const host = new URL(page.url()).host;

  const signIn = async (): Promise<"ok" | "bad_password" | "unverified" | "unknown"> => {
    await chooseEmailSignIn(page);
    if (!(await visible(page, WD("signInSubmitButton"))) && (await visible(page, WD("signInLink")))) {
      await clickWd(page, "signInLink");
      await page.waitForTimeout(1500);
      await chooseEmailSignIn(page);
      await trace(page, "after Sign In link");
    }
    await fillVisible(page, WD("email"), portal.email);
    await fillVisible(page, WD("password"), portal.password);
    await trace(page, "sign-in filled");
    await clickWd(page, "signInSubmitButton", "Sign In");
    await settle(page);
    await trace(page, "after sign-in click");
    if (!(await visible(page, AUTH_FORM)) && ((await visible(page, NEXT)) || (await visible(page, WD("progressBarActiveStep"))))) return "ok";
    if (!(await visible(page, AUTH_FORM))) {
      await settle(page);
      if (!(await visible(page, AUTH_FORM))) return "ok";
    }
    const t = `${await errorsOnPage(page)} ${await text(page)}`;
    if (/(verify|verification|activate|not (been )?(verified|activated))/i.test(t)) return "unverified";
    if (/(incorrect|invalid|wrong|doesn.t match|locked)/i.test(t)) return "bad_password";
    return "unknown";
  };

  /** Click the link Workday emails to confirm the account, then come back to the job. */
  const confirmByEmail = async (since: Date, waitMs = 45_000): Promise<boolean> => {
    if (!opts.emailLink) return false;
    const resend = page.locator("button:has-text('Resend'), a:has-text('Resend')").first();
    if (await resend.isVisible().catch(() => false)) await resend.click().catch(() => {});
    const link = await opts.emailLink(since, new RegExp(`workday|${host.split(".")[0]}|verify|confirm|activate|account`, "i"), host, waitMs).catch((e) => {
      console.log(`[9to5]   verification link lookup failed: ${(e as Error).message}`);
      return null;
    });
    if (!link) return false;
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await startApplication(page);
    return true;
  };

  /**
   * Saved password rejected → "Forgot your password?": request the reset email, open its link (or type its
   * code), set the password to the saved portal password, then come back to the job and sign in.
   */
  const resetPassword = async (): Promise<boolean> => {
    if (!opts.emailLink) return false;
    const forgot = `${WD("forgotPasswordLink")}, button:has-text('Forgot your password'), a:has-text('Forgot your password'), a:has-text('Forgot Password')`;
    if (!(await visible(page, forgot))) return false;
    await mouseClick(page, forgot);
    await page.waitForTimeout(1500);
    await fillVisible(page, `${WD("email")}, input[type=email]`, portal.email);
    const since = new Date();
    const send = `${WD("resetPasswordButton")}, ${WD("forgotPasswordSubmitButton")}, button:has-text('Reset'), button:has-text('Submit'), button:has-text('Send'), button:has-text('Continue')`;
    await mouseClick(page, send);
    await settle(page, 8000);
    await trace(page, "reset requested");
    const link = await opts
      .emailLink(since, new RegExp(`reset|password|workday|${host.split(".")[0]}`, "i"), host)
      .catch(() => null);
    if (link) {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await settle(page, 10000);
    } else if (opts.emailCode && (await visible(page, "input[autocomplete='one-time-code'], input[name*=code i], input[aria-label*=code i]"))) {
      const code = await opts.emailCode(since).catch(() => null);
      if (!code) return false;
      await fillVisible(page, "input[autocomplete='one-time-code'], input[name*=code i], input[aria-label*=code i]", code);
    } else return false;
    // New password + confirmation (Workday: password / verifyPassword; other pages: two password boxes).
    const boxes = page.locator("input[type=password]");
    const n = Math.min(await boxes.count().catch(() => 0), 4);
    let filledBoxes = 0;
    for (let i = 0; i < n; i++) {
      if (!(await boxes.nth(i).isVisible().catch(() => false))) continue;
      await boxes.nth(i).fill(portal.password).catch(() => {});
      filledBoxes++;
    }
    if (!filledBoxes) return false;
    await mouseClick(page, `${WD("resetPasswordSubmitButton")}, ${WD("changePasswordSubmitButton")}, button:has-text('Reset'), button:has-text('Change'), button:has-text('Save'), button:has-text('Submit'), button:has-text('Continue')`);
    await settle(page, 10000);
    await trace(page, "password reset submitted");
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    await startApplication(page);
    return true;
  };

  // Workday renders the sign-in form (or the first step, if already signed in) a few seconds after load.
  await page
    .locator(`${AUTH_FORM}, ${NEXT}, ${WD("signInLink")}, ${WD("createAccountLink")}, ${EMAIL_SIGN_IN}`)
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  // Some portals first offer "Sign in with Google / LinkedIn / Apple — OR — Sign in with email": always email.
  await chooseEmailSignIn(page);
  await trace(page, "auth start");
  const onAuth = (await visible(page, AUTH_FORM)) || ((await visible(page, WD("signInLink"))) && !(await visible(page, NEXT)));
  if (!onAuth) {
    const inFlow = (await visible(page, NEXT)) || (await visible(page, WD("progressBarActiveStep")));
    if (inFlow) return { ok: true, created: false }; // already signed in
    await startApplication(page);
    await trace(page, "retried opening the application");
    if (!(await visible(page, AUTH_FORM)) && !(await visible(page, WD("signInLink")))) {
      if ((await visible(page, NEXT)) || (await visible(page, WD("progressBarActiveStep")))) return { ok: true, created: false };
      return { ok: false, result: { status: "failed", detail: "Couldn't open the Workday application form — will retry next run" } };
    }
  }

  if (opts.accountExists) {
    const r = await signIn();
    if (r === "ok") return { ok: true, created: false };
    if (r === "unverified") {
      // Look back far enough to find the email sent when the account was created on an earlier run.
      // Looking back for an email from an earlier run: it is either there already or not — a quick look.
      if ((await confirmByEmail(new Date(Date.now() - 3 * 86400_000), 12_000)) && (await signIn()) === "ok") return { ok: true, created: false };
      return {
        ok: false,
        // With Gmail connected the agent looks again next run (the email is often late); after 3 tries it comes to the user.
        result: opts.emailLink
          ? { status: "failed", detail: `Workday account at ${host} isn't verified yet and the verification email hasn't been found in ${portal.email} — will retry next run` }
          : { status: "needs_user", detail: `Your Workday account at ${host} isn't verified yet. Click the link in the email Workday sent to ${portal.email} (or connect Gmail on the Autopilot page so the agent does it), then Retry.` },
      };
    }
    if (r === "bad_password" && (await resetPassword()) && (await signIn()) === "ok") return { ok: true, created: false };
    if (r === "bad_password")
      return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) rejected the saved password. Use "Forgot your password?" there and set it to the password shown under Portal logins, then click Retry.` } };
  }

  // Create the account with the saved login.
  if (!(await visible(page, WD("createAccountSubmitButton"))) && (await visible(page, WD("createAccountLink")))) {
    await clickWd(page, "createAccountLink");
    await page.waitForTimeout(1500);
  }
  if (await visible(page, WD("createAccountSubmitButton"))) {
    const since = new Date();
    await fillVisible(page, WD("email"), portal.email);
    await fillVisible(page, WD("password"), portal.password);
    await fillVisible(page, WD("verifyPassword"), portal.password);
    const agree = page.locator(WD("createAccountCheckbox")).first();
    if (await agree.isVisible().catch(() => false)) await agree.check({ force: true }).catch(() => agree.click({ force: true }));
    if (await captchaVisible(page)) return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) shows a CAPTCHA on account creation — create the account yourself with the login under Portal logins.` } };
    await clickWd(page, "createAccountSubmitButton", "Create Account");
    await settle(page);
    if (!(await visible(page, AUTH_FORM)) && ((await visible(page, NEXT)) || (await visible(page, WD("progressBarActiveStep"))))) return { ok: true, created: true };
    const t = `${await errorsOnPage(page)} ${await text(page)}`;
    if (/already (exists|in use|registered|been used)|account with this email/i.test(t)) {
      const r = await signIn();
      if (r === "ok") return { ok: true, created: false };
      if (r === "bad_password" && (await resetPassword()) && (await signIn()) === "ok") return { ok: true, created: false };
      if (r === "bad_password")
        return { ok: false, result: { status: "needs_user", detail: `You already have a Workday account at ${host} with a different password. Use "Forgot your password?" there and set it to the password under Portal logins, then click Retry.` } };
    }
    if (/(verify|verification|activate|check your (email|inbox)|sent .{0,40}email)/i.test(t)) {
      if (!(await confirmByEmail(since)))
        return {
          ok: false,
          result: opts.emailLink
            ? { status: "failed", detail: `Workday (${host}) account created; its verification email hadn't arrived yet — the agent clicks it on the next run`, accountCreated: true }
            : { status: "needs_user", detail: `Workday (${host}) emailed you a link to verify the new account. Connect Gmail on the Autopilot page so the agent can click it — or click it yourself, then Retry.`, accountCreated: true },
        };
      const r = await signIn();
      if (r === "ok") return { ok: true, created: true };
    }
    // Real error messages only: the page always prints its password rules ("must contain an uppercase…").
    const pwRule = /(password must|at least \d+ characters|special character|uppercase|lowercase)/i.exec(await errorsOnPage(page));
    if (pwRule) return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) didn't accept the generated password (${pwRule[0]}). Create the account yourself with a password it accepts.` } };
  }
  const r = await signIn();
  if (r === "ok") return { ok: true, created: false };
  // Sign-in failed without saying why (seen on T-Mobile, Ciena, Northrop): usually an unverified account or a
  // password that didn't stick. Try the verification email, then a password reset, before asking the user.
  if (r !== "bad_password" && (await confirmByEmail(new Date(Date.now() - 3 * 86400_000), 12_000)) && (await signIn()) === "ok") return { ok: true, created: false };
  if ((await resetPassword()) && (await signIn()) === "ok") return { ok: true, created: false };
  const why = (await errorsOnPage(page)) || "the sign-in didn't go through and the reset email didn't arrive";
  // Emails from Workday are often minutes late: with Gmail connected, try again next run before asking the user.
  return opts.emailLink
    ? { ok: false, result: { status: "failed", detail: `Couldn't sign in to Workday (${host}) yet: ${why} — will retry next run` } }
    : { ok: false, result: { status: "needs_user", detail: `Couldn't sign in to Workday (${host}): ${why}. Use the login under Portal logins, then click Retry.` } };
}

/** From the job posting to the application flow (Apply → Apply Manually). */
async function startApplication(page: Page) {
  const apply = page.locator(`${WD("adventureButton")}, a:has-text('Apply'), button:has-text('Apply')`).first();
  await apply.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  if (await apply.isVisible().catch(() => false)) await apply.click().catch(() => {});
  // The "Apply Manually / Autofill with Resume" pop-up can take a few seconds.
  const manual = page.locator(`${WD("applyManually")}, a:has-text('Apply Manually')`).first();
  await manual.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await manual.isVisible().catch(() => false)) await manual.click().catch(() => {});
  await page
    .locator(`${AUTH_FORM}, ${NEXT}, ${WD("progressBarActiveStep")}, ${WD("signInLink")}`)
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
}

/** Workday date pickers (e.g. the self-identification signature date) want today's date in MM / DD / YYYY boxes. */
/** "January 2026" / "Jan 2023" / "2025-06" / "06/2025" / "2024" → { mm, yyyy }; "Present" → null. */
export function parseMonthYear(s: string | null | undefined): { mm: string; yyyy: string } | null {
  if (!s || /present|current|now/i.test(s)) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const y = s.match(/(19|20)\d\d/)?.[0];
  if (!y) return null;
  const name = months.findIndex((m) => new RegExp(`\\b${m}`, "i").test(s));
  const num = s.match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(19|20)\d\d\b|\b(19|20)\d\d\s*[/-]\s*(0?[1-9]|1[0-2])\b/);
  let mm = name >= 0 ? name + 1 : 1;
  if (name < 0 && num) mm = Number(num[1] ?? num[4]);
  return { mm: String(mm).padStart(2, "0"), yyyy: y };
}

/**
 * Workday date boxes. Work-history "From"/"To" come from the resume's jobs (in order; "Present" ticks
 * "I currently work here"); any other date (e.g. the self-identification signature date) is today.
 */
async function fillDates(page: Page, jobs: { start?: string | null; end?: string | null }[], schools: { graduation?: string | null; degree?: string | null }[] = []) {
  // Each Workday date is a wrapper with a (hidden) month input and a visible "display" box on top.
  const wrappers = page.locator(WD("dateInputWrapper"));
  const n = await wrappers.count().catch(() => 0);
  const now = new Date();
  let job = -1;
  for (let i = 0; i < n; i++) {
    const w = wrappers.nth(i);
    if (!(await w.isVisible().catch(() => false))) continue;
    const info = await w
      .evaluate((el) => {
        const field = el.closest("[data-automation-id^=formField]");
        const fid = field?.getAttribute("data-automation-id") ?? "";
        const label = (field?.querySelector("label, legend")?.textContent ?? "").replace(/\s+/g, " ").trim();
        const month = el.querySelector("[data-automation-id=dateSectionMonth-input]") as HTMLInputElement | null;
        const inEducation = Boolean(el.closest("[data-automation-id*=education i], [data-automation-id*=Education]")) || /attended|graduat|education/i.test(fid + " " + label);
        return {
          fid,
          label,
          inEducation,
          hasMonth: Boolean(el.querySelector("[data-automation-id=dateSectionMonth-input]")),
          hasDay: Boolean(el.querySelector("[data-automation-id=dateSectionDay-input]")),
          filled: Boolean(month?.value && !/^m+$/i.test(month.value)) || /\d{1,2}\s*\/\s*\d{4}/.test(el.textContent ?? ""),
        };
      })
      .catch(() => ({ fid: "", label: "", inEducation: false, hasMonth: true, hasDay: true, filled: false }));
    const isFrom = /startDate|fromDate|firstYear/i.test(info.fid) || /^(from|start)/i.test(info.label);
    const isTo = /endDate|toDate|lastYear/i.test(info.fid) || /^(to|end)\b/i.test(info.label);
    if (isFrom && !info.inEducation) job++;
    if (info.filled) continue;
    let typed: string | null = null;
    if (info.inEducation && (isFrom || isTo)) {
      // Education: "To (Actual or Expected)" = graduation; "From" ≈ 4 years earlier for a bachelor's, 2 for a master's.
      const s0 = schools[0];
      const grad = parseMonthYear(s0?.graduation) ?? parseMonthYear(String(new Date().getFullYear() + 1));
      if (grad) {
        const years = isFrom ? (/master|m\.?s\b/i.test(s0?.degree ?? "") ? 2 : 4) : 0;
        const y = String(Number(grad.yyyy) - years);
        const mm = isFrom ? "08" : grad.mm;
        typed = !info.hasMonth ? y : info.hasDay ? `${mm}01${y}` : `${mm}${y}`;
      }
    } else if (isFrom || isTo) {
      const j = jobs[Math.max(0, job)];
      const d = parseMonthYear(isFrom ? j?.start : j?.end);
      if (!d && isTo && j && /present|current/i.test(j.end ?? "")) {
        // "I currently work here" instead of an end date.
        const cb = page.locator(`${WD("formField-currentlyWorkHere")} input[type=checkbox], ${WD("currentlyWorkHere")}`).nth(Math.max(0, job));
        if ((await cb.count()) && !(await cb.isChecked().catch(() => true))) {
          const b = await cb.boundingBox().catch(() => null);
          if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
          else await cb.check({ force: true }).catch(() => {});
        }
        continue;
      }
      if (d) typed = info.hasDay ? `${d.mm}01${d.yyyy}` : `${d.mm}${d.yyyy}`;
    } else {
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      typed = info.hasDay ? `${mm}${String(now.getDate()).padStart(2, "0")}${now.getFullYear()}` : `${mm}${now.getFullYear()}`;
    }
    if (!typed) continue;
    // Click the visible first part (month, or year for year-only boxes) — the input itself is hidden — then type.
    const display = w.locator(`${WD("dateSectionMonth-display")}, ${WD("dateSectionMonth-input")}, ${WD("dateSectionYear-display")}, ${WD("dateSectionYear-input")}`).first();
    const box = await display.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await w.locator(WD("dateSectionMonth-input")).focus().catch(() => {});
    await page.keyboard.type(typed, { delay: 60 });
    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(300);
  }
  // Mark the day/year parts too so the generic reader leaves them alone.
  await page.evaluate(() => {
    document.querySelectorAll("[data-automation-id^=dateSection]").forEach((e) => e.setAttribute("data-9to5-skip", "1"));
  });
}

/** Work Experience N → the N-th job on the resume: Job Title and Company, when Workday left them empty. */
async function fillWorkHistory(page: Page, jobs: { title: string; company: string }[], schools: { school?: string | null }[] = []) {
  // Education 1 → the first school on the resume, when Workday left it empty (it's a search-and-pick field).
  const school = schools[0]?.school;
  if (school) {
    const box = page.locator('[data-automation-id="formField-schoolItem"] input, [data-automation-id="formField-school"] input').first();
    if ((await box.isVisible().catch(() => false)) && !/item selected/i.test((await box.locator("xpath=ancestor::*[starts-with(@data-automation-id,'formField')][1]").textContent().catch(() => "")) ?? "")) {
      const id = await box.getAttribute("id").catch(() => null);
      if (id) await fillPrompt(page, `[id="${id}"]`, school, "School");
      else await box.fill(school).catch(() => {});
    }
  }
  // Field of Study: once something is picked Workday hides the search box, so a wrong pick ("Accounting")
  // must be removed here and the resume's major chosen instead.
  const major = (schools[0] as { field?: string | null } | undefined)?.field;
  const fos = page.locator('[data-automation-id="formField-fieldOfStudy"], [data-automation-id="formField-field-of-study"], [data-automation-id="formField-major"]').first();
  if (major && (await fos.isVisible().catch(() => false))) {
    const txt = ((await fos.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    const pickedOk = /(software|computer|electrical|engineering|information|data|math|science)/i.test(txt.replace(/field of study\*?/i, ""));
    if (/item selected/i.test(txt) && !pickedOk) {
      const del = fos.locator('[data-automation-id="DELETE_charm"], [data-automation-id*="delete" i], [aria-label*="delete" i], [aria-label*="remove" i]').first();
      const b = await del.boundingBox().catch(() => null);
      if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      else await removeLastPick(page, '[data-automation-id="formField-fieldOfStudy"] input');
      await page.waitForTimeout(700);
    }
    const input = fos.locator("input").first();
    if ((await input.isVisible().catch(() => false)) && !/item selected/i.test(((await fos.textContent().catch(() => "")) ?? ""))) {
      const id = await input.getAttribute("id").catch(() => null);
      if (id) await fillPrompt(page, `[id="${id}"]`, major, "Field of Study");
    }
  }
  if (!jobs.length) return;
  for (const [field, key] of [
    ["jobTitle", "title"],
    ["companyName", "company"],
  ] as const) {
    const inputs = page.locator(`[data-automation-id="formField-${field}"] input`);
    const n = Math.min(await inputs.count().catch(() => 0), jobs.length);
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if ((await el.inputValue().catch(() => "")).trim()) continue;
      await el.fill(jobs[i][key]).catch(() => {});
    }
  }
}

export async function applyWorkday(page: Page, db: SupabaseClient, opts: ApplyOpts): Promise<ApplyResult> {
  let aiCalls = 0;
  const allAnswers: Record<string, string> = {};
  const learned: { label: string; answer: string }[] = [];
  let accountCreated = false;
  try {
    const res = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3500);
    const first = await text(page);
    if ((res && res.status() === 404) || /(no longer (accepting|available)|job (posting )?(is )?(closed|not found|no longer)|page you are looking for doesn.t exist)/i.test(first.slice(0, 4000)))
      return { status: "closed", detail: "Posting is closed" };
    await startApplication(page);

    const auth = await workdayAuth(page, opts);
    if (!auth.ok) return { ...auth.result, aiCalls };
    accountCreated = auth.created;
    // Signing in sometimes lands on the job page or "Use my last application" again.
    if (!(await visible(page, NEXT))) await startApplication(page);

    let lastStep = "";
    let sameStepTries = 0;
    let reloads = 0;
    let submittedClick = false;
    for (let step = 0; step < 14; step++) {
      await page.waitForTimeout(2500);
      let body = await text(page);
      // Workday's own transient error page: refresh like a person would (progress is saved per step).
      if (/something went wrong/i.test(body) && /refresh the page|try again/i.test(body)) {
        if (reloads++ >= 2) return { status: "failed", detail: "Workday kept showing \"Something went wrong\" — will retry next run", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await settle(page);
        sameStepTries = 0;
        body = await text(page);
      }
      // Before our own Submit click, only an explicit "already applied" notice counts — welcome text such as
      // "Thank you for your interest in …" on the first step is not a confirmation (Highmark false positive).
      if (/you('|’)ve already applied|already applied (for|to) this (job|position)|you have already applied/i.test(body))
        return { status: "submitted", detail: "Already applied to this job on Workday", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      if (step > 0 && submittedClick && SUCCESS.test(body))
        return { status: "submitted", detail: "Application submitted on Workday", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      if (await captchaVisible(page)) return { status: "needs_user", detail: "Workday shows a CAPTCHA — please finish this one yourself", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };

      if (await visible(page, AUTH_FORM)) {
        const msg = (await errorsOnPage(page)) || "Workday asked to sign in again";
        return { status: "needs_user", detail: `Workday sign-in didn't stick: ${msg}. If it says to verify your account, click the link Workday emailed you, then Retry.`, answers: allAnswers, learned, aiCalls, accountCreated };
      }
      const rawStep = ((await page.locator(WD("progressBarActiveStep")).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (!rawStep && !(await visible(page, NEXT))) {
        await settle(page);
        if (!(await visible(page, NEXT)) && !(await visible(page, WD("progressBarActiveStep")))) {
          const msg = (await errorsOnPage(page)) || (await text(page)).slice(0, 160);
          return { status: "needs_user", detail: `Workday showed an unexpected page: ${msg}`, answers: allAnswers, learned, aiCalls, accountCreated };
        }
      }
      const stepName = rawStep.replace(/^current step \d+ of \d+/i, "").trim() || `step ${step + 1}`;
      if (stepName === lastStep) sameStepTries++;
      else sameStepTries = 0;
      lastStep = stepName;
      if (sameStepTries >= 2) {
        const errs = await errorsOnPage(page);
        // Required questions the agent had NO answer for (e.g. a GPA that isn't on the resume): ask the user once —
        // the answer is remembered for every later application — instead of failing the same way 3 times.
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const answered = Object.keys(allAnswers).map(norm);
        const unanswered = [...errs.matchAll(/The field (.{2,240}?) is required and must have a value/g)]
          .map((m) => m[1].trim())
          .filter((l) => !answered.some((a) => a && (a.includes(norm(l).slice(0, 40)) || norm(l).includes(a.slice(0, 40)))));
        if (unanswered.length) {
          const pending: PendingQuestion[] = [...new Set(unanswered)].map((l) => ({ key: memoryKey(l), label: l, kind: "text", options: [], required: true }));
          return {
            status: "needs_user",
            detail: `Waiting on your answer to ${pending.length} question${pending.length === 1 ? "" : "s"} (Workday "${stepName}") — answer once on this page and the agent reapplies`,
            answers: allAnswers,
            learned,
            aiCalls,
            pending,
            usedPortalLogin: true,
            accountCreated,
          };
        }
        // Often a slow page or a resume still parsing: the run loop retries it (up to 3 tries) before it goes to the user.
        return { status: "failed", detail: `Workday stopped at "${stepName}"${errs ? `: ${errs}` : ""} — will retry next run`, answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      }

      // Resume upload (My Experience). Workday parses it and pre-fills work history.
      const fileInput = page.locator(`${WD("file-upload-input-ref")}, input[type=file]`).first();
      const hasResume = /\.pdf\b/i.test(body) && /(uploaded|successfully|resume|cv)/i.test(body);
      if ((await fileInput.count()) && !hasResume) {
        await fileInput.setInputFiles(opts.resumePath).catch(() => {});
        await page.waitForTimeout(6000);
      }
      await fillDates(page, opts.applicant.experience ?? [], opts.applicant.education ?? []);
      await fillWorkHistory(page, opts.applicant.experience ?? [], opts.applicant.education ?? []);

      const isReview = /review/i.test(stepName) || (await page.locator("button:has-text('Submit')").first().isVisible().catch(() => false));
      if (!isReview) {
        const fields = (await collectFields(page)).filter((f) => f.kind !== "file");
        await readComboboxOptions(page, fields);
        if (process.env.APPLY_DEBUG_DIR)
          for (const f of fields) console.log(`[9to5]   wd field: ${f.kind} req=${f.required} filled=${f.filled} "${f.label.slice(0, 90)}" opts=${f.options.length}`);
        const ans = await answerFields(db, fields, opts);
        aiCalls += ans.aiCalls;
        if (ans.quota) return { status: "needs_user", detail: "AI quota used up today — it retries tomorrow", answers: allAnswers, aiCalls, accountCreated };
        learned.push(...ans.learned);
        const missing = fields.filter((f) => f.required && !ans.answers[f.id] && !f.filled);
        if (missing.length) {
          const pending: PendingQuestion[] = missing.map((m) => ({
            key: memoryKey(m.label || m.id),
            label: m.label || "(unlabelled question)",
            kind: m.kind,
            options: m.kind === "checkbox" ? ["Yes", "No"] : m.options.slice(0, 60),
            required: true,
          }));
          return {
            status: "needs_user",
            detail: `Waiting on your answer to ${pending.length} question${pending.length === 1 ? "" : "s"} (Workday "${stepName}") — answer once on this page and the agent reapplies`,
            answers: { ...allAnswers, ...labelled(fields, ans.answers) },
            learned,
            aiCalls,
            pending,
            accountCreated,
          };
        }
        for (const f of fields) {
          const v = ans.answers[f.id];
          // Keep what Workday pre-filled unless we have a definite answer for a choice field.
          if (!v || (f.filled && (f.kind === "text" || f.kind === "textarea"))) continue;
          const sel = `[data-9to5="${f.id}"]`;
          const isPrompt = await page
            .evaluate((s2) => {
              const el = document.querySelector(s2);
              return Boolean(el && (el.closest("[data-automation-id=multiselectInputContainer]") || el.getAttribute("data-uxi-widget-type") === "selectinput" || el.getAttribute("data-automation-id") === "searchBox"));
            }, sel)
            .catch(() => false);
          if (isPrompt) {
            await fillPrompt(page, sel, v, f.label);
            continue;
          }
          if (f.kind === "radio" || f.kind === "checkboxes") {
            const wanted = f.kind === "radio" ? [v] : v.split(/\s*[,;|]\s*/).filter(Boolean);
            for (const w of wanted) {
              const hit = pickOption(w, f.options);
              const idx = hit ? f.options.indexOf(hit) : -1;
              if (idx < 0) continue;
              const target = `[data-9to5="${f.id}_${idx}"]`;
              const already = await page.locator(target).isChecked().catch(() => false);
              if (already) continue;
              // Click the visible label for the choice (the input itself is often a styled 0-size element).
              const id = await page.getAttribute(target, "id").catch(() => null);
              const ok = (id && (await mouseClick(page, `label[for="${id}"]`))) || (await mouseClick(page, target));
              if (!ok) await page.check(target, { force: true }).catch(() => {});
              await page.waitForTimeout(200);
            }
            continue;
          }
          // Workday has its own country-code field: the number itself must be digits only.
          const value = /phone number|phone$/i.test(f.label) && f.kind === "text" ? v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : v;
          await fill(page, f, value, opts.resumePath).catch(() => {});
          await page.waitForTimeout(150);
        }
        // A GPA typed on an earlier attempt (or guessed by the site) is removed when the resume has none.
        for (const f of fields)
          if (f.filled && f.kind === "text" && /\bgpa\b|grade point|overall result/i.test(f.label) && !opts.applicant.gpa)
            await page.fill(`[data-9to5="${f.id}"]`, "").catch(() => {});
        Object.assign(allAnswers, labelled(fields, ans.answers));
        await page.waitForTimeout(800);
        await page.keyboard.press("Escape").catch(() => {});
        const info = await page
          .evaluate(
            (sel) =>
              Array.from(document.querySelectorAll(sel))
                .filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0)
                .map((e) => `${e.tagName}[${e.getAttribute("data-automation-id")}] ${(e.textContent ?? "").trim().slice(0, 20)}`)
                .join(" | "),
            NEXT
          )
          .catch(() => "?");
        await trace(page, `next buttons: ${info}`);
        const stepBefore = rawStep;
        await mouseClick(page, NEXT);
        await settle(page, 8000);
        await trace(page, "after Save and Continue");
        const stepNow = ((await page.locator(WD("progressBarActiveStep")).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
        if (stepNow === stepBefore && !(await errorsOnPage(page))) {
          // The first click may only have closed an open picker: press the button via the keyboard, then directly.
          const btn = page.locator(NEXT).last();
          await btn.focus().catch(() => {});
          await page.keyboard.press("Enter").catch(() => {});
          await settle(page, 8000);
          const stepAfter = ((await page.locator(WD("progressBarActiveStep")).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
          if (stepAfter === stepBefore) await btn.click({ timeout: 4000 }).catch(() => {});
          await trace(page, "after Save and Continue (retry)");
        }
        continue;
      }

      // Review → Submit.
      if (opts.dryRun) return { status: "needs_user", detail: "Dry run: Workday application filled up to Review, not submitted", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      submittedClick = true;
      if (!(await mouseClick(page, `${WD("pageFooterNextButton")}, button:has-text('Submit')`))) return { status: "needs_user", detail: "Couldn't find Workday's Submit button", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      await page.waitForTimeout(6000);
      const after = await text(page);
      if (SUCCESS.test(after) || /application (was )?submitted|you('|’)ve applied|congratulations/i.test(after))
        return { status: "submitted", detail: "Application submitted on Workday", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
    }
    return { status: "needs_user", detail: `Workday flow didn't finish (last step "${lastStep}") — open the application to check`, answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
  } catch (e) {
    return { status: "failed", detail: `Workday: ${(e as Error).message.slice(0, 280)}`, answers: allAnswers, aiCalls, accountCreated };
  }
}
