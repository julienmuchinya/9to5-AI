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
import { SUCCESS, answerFields, captchaVisible, collectFields, fill, labelled, readComboboxOptions, type ApplyOpts, type ApplyResult } from "./apply";

const WD = (id: string) => `[data-automation-id="${id}"]`;
const AUTH_FORM = [WD("createAccountSubmitButton"), WD("signInSubmitButton"), WD("signInContent")].join(", ");
const NEXT = [WD("pageFooterNextButton"), WD("bottom-navigation-next-button"), "button:has-text('Save and Continue')", "button:has-text('Next')"].join(", ");
const ERRORS = [WD("errorMessage"), WD("errorBanner"), "[role=alert]"].join(", ");

const text = async (page: Page) => ((await page.textContent("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
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

async function errorsOnPage(page: Page): Promise<string> {
  const errs = await page.locator(ERRORS).allTextContents().catch(() => [] as string[]);
  return errs.map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ").slice(0, 300);
}

type AuthResult = { ok: true; created: boolean } | { ok: false; result: ApplyResult };

/** Gets past the Create Account / Sign In step. */
async function workdayAuth(page: Page, opts: ApplyOpts): Promise<AuthResult> {
  const portal = opts.applicant.portal;
  if (!portal) return { ok: false, result: { status: "needs_user", detail: "No saved login for this Workday site yet — it will be created on the next run." } };
  const host = new URL(page.url()).host;

  const signIn = async (): Promise<"ok" | "bad_password" | "unverified" | "unknown"> => {
    if (!(await visible(page, WD("signInSubmitButton"))) && (await visible(page, WD("signInLink")))) {
      await clickWd(page, "signInLink");
      await page.waitForTimeout(1500);
    }
    await page.fill(WD("email"), portal.email).catch(() => {});
    await page.fill(WD("password"), portal.password).catch(() => {});
    await clickWd(page, "signInSubmitButton", "Sign In");
    await page.waitForTimeout(5000);
    if (!(await visible(page, AUTH_FORM))) return "ok";
    const t = `${await errorsOnPage(page)} ${await text(page)}`;
    if (/(verify|verification|activate|not (been )?(verified|activated))/i.test(t)) return "unverified";
    if (/(incorrect|invalid|wrong|doesn.t match|locked)/i.test(t)) return "bad_password";
    return "unknown";
  };

  /** Click the link Workday emails to confirm the account, then come back to the job. */
  const confirmByEmail = async (since: Date): Promise<boolean> => {
    if (!opts.emailLink) return false;
    const resend = page.locator("button:has-text('Resend'), a:has-text('Resend')").first();
    if (await resend.isVisible().catch(() => false)) await resend.click().catch(() => {});
    const link = await opts.emailLink(since, new RegExp(`workday|${host.split(".")[0]}|verify|confirm|activate|account`, "i")).catch((e) => {
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

  // Workday renders the sign-in form (or the first step, if already signed in) a few seconds after load.
  await page
    .locator(`${AUTH_FORM}, ${NEXT}, ${WD("signInLink")}, ${WD("createAccountLink")}`)
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  const onAuth = (await visible(page, AUTH_FORM)) || ((await visible(page, WD("signInLink"))) && !(await visible(page, NEXT)));
  if (!onAuth) return { ok: true, created: false }; // already signed in

  if (opts.accountExists) {
    const r = await signIn();
    if (r === "ok") return { ok: true, created: false };
    if (r === "unverified") {
      // Look back far enough to find the email sent when the account was created on an earlier run.
      if ((await confirmByEmail(new Date(Date.now() - 3 * 86400_000))) && (await signIn()) === "ok") return { ok: true, created: false };
      return {
        ok: false,
        result: { status: "needs_user", detail: `Your Workday account at ${host} isn't verified yet. Click the link in the email Workday sent to ${portal.email} (or connect Gmail so the agent does it), then Retry.` },
      };
    }
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
    await page.fill(WD("email"), portal.email).catch(() => {});
    await page.fill(WD("password"), portal.password).catch(() => {});
    await page.fill(WD("verifyPassword"), portal.password).catch(() => {});
    const agree = page.locator(WD("createAccountCheckbox")).first();
    if (await agree.isVisible().catch(() => false)) await agree.check({ force: true }).catch(() => agree.click({ force: true }));
    if (await captchaVisible(page)) return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) shows a CAPTCHA on account creation — create the account yourself with the login under Portal logins.` } };
    await clickWd(page, "createAccountSubmitButton", "Create Account");
    await page.waitForTimeout(6000);
    if (!(await visible(page, AUTH_FORM))) return { ok: true, created: true };
    const t = `${await errorsOnPage(page)} ${await text(page)}`;
    if (/already (exists|in use|registered|been used)|account with this email/i.test(t)) {
      const r = await signIn();
      if (r === "ok") return { ok: true, created: false };
      if (r === "bad_password")
        return { ok: false, result: { status: "needs_user", detail: `You already have a Workday account at ${host} with a different password. Use "Forgot your password?" there and set it to the password under Portal logins, then click Retry.` } };
    }
    if (/(verify|verification|activate|check your (email|inbox)|sent .{0,40}email)/i.test(t)) {
      if (!(await confirmByEmail(since)))
        return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) emailed you a link to verify the new account. Connect Gmail on the Autopilot page so the agent can click it — or click it yourself, then Retry.`, accountCreated: true } };
      const r = await signIn();
      if (r === "ok") return { ok: true, created: true };
    }
    const pwRule = /(password must|at least \d+ characters|special character|uppercase|lowercase)/i.exec(t);
    if (pwRule) return { ok: false, result: { status: "needs_user", detail: `Workday (${host}) didn't accept the generated password (${pwRule[0]}). Create the account yourself with a password it accepts.` } };
  }
  const r = await signIn();
  if (r === "ok") return { ok: true, created: false };
  return { ok: false, result: { status: "needs_user", detail: `Couldn't sign in to Workday (${host}): ${(await errorsOnPage(page)) || "unknown sign-in screen"}. Use the login under Portal logins, then click Retry.` } };
}

/** From the job posting to the application flow (Apply → Apply Manually). */
async function startApplication(page: Page) {
  const apply = page.locator(`${WD("adventureButton")}, a:has-text('Apply'), button:has-text('Apply')`).first();
  if (await apply.isVisible().catch(() => false)) {
    await apply.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  const manual = page.locator(`${WD("applyManually")}, a:has-text('Apply Manually')`).first();
  if (await manual.isVisible().catch(() => false)) {
    await manual.click().catch(() => {});
    await page.waitForTimeout(3500);
  }
}

/** Workday date pickers (e.g. the self-identification signature date) want today's date in MM / DD / YYYY boxes. */
async function fillDates(page: Page) {
  const months = page.locator(`${WD("dateSectionMonth-input")}`);
  const n = await months.count();
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const m = months.nth(i);
    if (!(await m.isVisible().catch(() => false))) continue;
    const box = m.locator("xpath=ancestor::*[@data-automation-id='dateInputWrapper' or contains(@data-automation-id,'formField')][1]");
    const value = await m.inputValue().catch(() => "");
    if (value && value !== "MM") continue;
    await m.click().catch(() => {});
    await page.keyboard.type(`${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${now.getFullYear()}`, { delay: 40 });
    await box.evaluate((el) => el.setAttribute("data-9to5-skip", "1")).catch(() => {});
  }
  // Mark the day/year parts too so the generic reader leaves them alone.
  await page.evaluate(() => {
    document.querySelectorAll("[data-automation-id^=dateSection]").forEach((e) => e.setAttribute("data-9to5-skip", "1"));
  });
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
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(2500);
      const body = await text(page);
      if (SUCCESS.test(body) || /application (was )?submitted|you('|’)ve applied/i.test(body))
        return { status: "submitted", detail: "Application submitted on Workday", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      if (await captchaVisible(page)) return { status: "needs_user", detail: "Workday shows a CAPTCHA — please finish this one yourself", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };

      const stepName = ((await page.locator(WD("progressBarActiveStep")).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim() || `step ${step + 1}`;
      if (stepName === lastStep) sameStepTries++;
      else sameStepTries = 0;
      lastStep = stepName;
      if (sameStepTries >= 2) {
        const errs = await errorsOnPage(page);
        return { status: "needs_user", detail: `Workday stopped at "${stepName}"${errs ? `: ${errs}` : ""} — open the application to finish it.`, answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
      }

      // Resume upload (My Experience). Workday parses it and pre-fills work history.
      const fileInput = page.locator(`${WD("file-upload-input-ref")}, input[type=file]`).first();
      const hasResume = /\.pdf\b/i.test(body) && /(uploaded|successfully|resume|cv)/i.test(body);
      if ((await fileInput.count()) && !hasResume) {
        await fileInput.setInputFiles(opts.resumePath).catch(() => {});
        await page.waitForTimeout(6000);
      }
      await fillDates(page);

      const isReview = /review/i.test(stepName) || (await page.locator("button:has-text('Submit')").first().isVisible().catch(() => false));
      if (!isReview) {
        const fields = (await collectFields(page)).filter((f) => f.kind !== "file");
        await readComboboxOptions(page, fields);
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
          await fill(page, f, v, opts.resumePath).catch(() => {});
          await page.waitForTimeout(150);
        }
        Object.assign(allAnswers, labelled(fields, ans.answers));
        await page.waitForTimeout(800);
        await mouseClick(page, NEXT);
        continue;
      }

      // Review → Submit.
      if (opts.dryRun) return { status: "needs_user", detail: "Dry run: Workday application filled up to Review, not submitted", answers: allAnswers, learned, aiCalls, usedPortalLogin: true, accountCreated };
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
