// Generates the Supabase Auth email templates in supabase/templates/.
// Run: node scripts/build-email-templates.mjs   — then paste each file into
// Supabase → Authentication → Emails (see supabase/templates/README.md).
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = "https://9to5-ai-julienmuchinyas-projects.vercel.app";
const BRAND = "9to5 AI";

const codeBox = `
          <div style="margin:24px 0;padding:18px 0;background:#f3f4ff;border:1px solid #e0e1fb;border-radius:10px;text-align:center;">
            <div style="font-size:12px;letter-spacing:1px;color:#6b7280;text-transform:uppercase;">Your code</div>
            <div style="margin-top:6px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#111827;">{{ .Token }}</div>
          </div>`;

const button = (href, label) => `
          <div style="margin:24px 0;text-align:center;">
            <a href="${href}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${label}</a>
          </div>`;

const layout = ({ preheader, heading, body, footerNote }) => `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <div style="font-size:20px;font-weight:800;color:#6366f1;">${BRAND}</div>
                <div style="font-size:12px;color:#6b7280;">Your AI job agent</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px;font-size:15px;line-height:1.6;">
          <h1 style="margin:16px 0 8px;font-size:20px;">${heading}</h1>
${body}
          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">${footerNote}</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${BRAND} · <a href="${SITE}" style="color:#9ca3af;">${SITE.replace("https://", "")}</a><br />This is an automatic message — replies aren’t read.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const T = {
  recovery: {
    subject: `${BRAND}: your password reset code`,
    html: layout({
      preheader: "Your 6-digit code to reset your 9to5 AI password.",
      heading: "Reset your password",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">We got a request to reset the password for your ${BRAND} account (<b>{{ .Email }}</b>). Enter this code on the reset page:</p>${codeBox}
          <p style="margin:0;">The code works for <b>1 hour</b> and only once. If you asked for several codes, use the newest one.</p>`,
      footerNote: "Didn’t ask for this? You can ignore this email — your password stays the same. Never share this code with anyone; 9to5 AI will never ask for it.",
    }),
  },
  confirmation: {
    subject: `${BRAND}: confirm your email`,
    html: layout({
      preheader: "Your 6-digit code to finish creating your 9to5 AI account.",
      heading: "Welcome to 9to5 AI",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">Thanks for signing up. To confirm <b>{{ .Email }}</b> is yours, enter this code on the sign-up screen:</p>${codeBox}
          <p style="margin:0;">The code works for <b>1 hour</b>. Next, you’ll upload your resume and your agent starts finding jobs.</p>`,
      footerNote: "Didn’t create an account? Ignore this email and nothing will happen.",
    }),
  },
  magic_link: {
    subject: `${BRAND}: your sign-in code`,
    html: layout({
      preheader: "Your 6-digit code to sign in to 9to5 AI.",
      heading: "Your sign-in code",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">Use this code to sign in to ${BRAND}:</p>${codeBox}
          <p style="margin:0;">It works for <b>1 hour</b> and only once.</p>`,
      footerNote: "Didn’t try to sign in? Ignore this email. Never share this code with anyone.",
    }),
  },
  email_change: {
    subject: `${BRAND}: confirm your new email`,
    html: layout({
      preheader: "Confirm the new email address for your 9to5 AI account.",
      heading: "Confirm your new email",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">You asked to change your ${BRAND} login from <b>{{ .Email }}</b> to <b>{{ .NewEmail }}</b>. Your confirmation code:</p>${codeBox}
          <p style="margin:0;">Or confirm with one click:</p>${button(`${SITE}/auth/callback?token_hash={{ .TokenHash }}&type=email_change&next=/account`, "Confirm new email")}`,
      footerNote: "Didn’t ask for this? Ignore this email and change your password on the Account & security page.",
    }),
  },
  invite: {
    subject: `You’re invited to ${BRAND}`,
    html: layout({
      preheader: "You’ve been invited to 9to5 AI.",
      heading: "You’re invited",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">You’ve been invited to create a ${BRAND} account for <b>{{ .Email }}</b>.</p>${button(`${SITE}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/account`, "Accept invite")}
          <p style="margin:0;">After accepting, set a password on the Account & security page.</p>`,
      footerNote: "Not expecting this? Ignore this email.",
    }),
  },
  reauthentication: {
    subject: `${BRAND}: confirm it’s you`,
    html: layout({
      preheader: "Your 9to5 AI security code.",
      heading: "Confirm it’s you",
      body: `          <p style="margin:0;">Hi,</p>
          <p style="margin:12px 0 0;">Enter this code to finish a sensitive change on your ${BRAND} account:</p>${codeBox}`,
      footerNote: "Didn’t do this? Change your password right away on the Account & security page.",
    }),
  },
};

mkdirSync("supabase/templates", { recursive: true });
for (const [name, t] of Object.entries(T)) writeFileSync(`supabase/templates/${name}.html`, t.html);
writeFileSync(
  "supabase/templates/subjects.json",
  JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.subject])), null, 2) + "\n"
);
console.log("wrote", Object.keys(T).length, "templates");
