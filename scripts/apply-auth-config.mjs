// Applies 9to5 AI's Supabase Auth settings in one go:
//   • Site URL + redirect allow-list → the live Vercel site (fixes links going to localhost)
//   • Branded email templates + subjects (6-digit codes)
//   • Optional: Gmail SMTP so emails come from "9to5 AI" and the hourly limit goes up
//
// Usage (PowerShell), with a Supabase personal access token from
// https://supabase.com/dashboard/account/tokens :
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."            # never commit this
//   node scripts/apply-auth-config.mjs
// Optional Gmail sender (needs a Gmail app password):
//   $env:GMAIL_SMTP_USER = "you@gmail.com"; $env:GMAIL_SMTP_APP_PASSWORD = "abcd efgh ijkl mnop"
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SITE = "https://9to5-ai-julienmuchinyas-projects.vercel.app";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN first (https://supabase.com/dashboard/account/tokens).");
  process.exit(1);
}
const envFile = (() => {
  try {
    return readFileSync(".env.local", "utf8");
  } catch {
    return "";
  }
})();
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? envFile.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
const ref = supaUrl?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error("Couldn't find your Supabase project (NEXT_PUBLIC_SUPABASE_URL in .env.local).");
  process.exit(1);
}

execFileSync(process.execPath, ["scripts/build-email-templates.mjs"], { stdio: "inherit" });
const subjects = JSON.parse(readFileSync("supabase/templates/subjects.json", "utf8"));
const tpl = (n) => readFileSync(`supabase/templates/${n}.html`, "utf8");

const body = {
  site_url: SITE,
  uri_allow_list: `${SITE}/**,http://localhost:3000/**`,
  mailer_otp_length: 6,
  mailer_otp_exp: 3600,
};
for (const name of Object.keys(subjects)) {
  body[`mailer_subjects_${name}`] = subjects[name];
  body[`mailer_templates_${name}_content`] = tpl(name);
}
const gUser = process.env.GMAIL_SMTP_USER;
const gPass = process.env.GMAIL_SMTP_APP_PASSWORD?.replace(/\s+/g, "");
if (gUser && gPass) {
  Object.assign(body, {
    external_email_enabled: true,
    smtp_admin_email: gUser,
    smtp_sender_name: "9to5 AI",
    smtp_host: "smtp.gmail.com",
    smtp_port: "465",
    smtp_user: gUser,
    smtp_pass: gPass,
    smtp_max_frequency: 30,
    rate_limit_email_sent: 30,
  });
}

const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const res = await fetch(api, { method: "PATCH", headers, body: JSON.stringify(body) });
if (!res.ok) {
  console.error(`Supabase refused (${res.status}): ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
const now = await (await fetch(api, { headers })).json();
console.log("Site URL:        ", now.site_url);
console.log("Redirect URLs:   ", now.uri_allow_list);
console.log("Code length:     ", now.mailer_otp_length);
console.log("Reset subject:   ", now.mailer_subjects_recovery);
console.log("Sender:          ", now.smtp_host ? `${now.smtp_sender_name} via ${now.smtp_host}` : "Supabase default (noreply@mail.app.supabase.io)");
console.log("Done. Request a new code on the site to see the new email.");
