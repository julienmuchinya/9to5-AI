import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { SECURITY_QUESTIONS_LIST } from "./questions";

/**
 * Server-only secrets helpers.
 * - Portal passwords and inbox app passwords: AES-256-GCM with VAULT_KEY (64 hex chars).
 * - Security answers: scrypt hashes (one-way; never decryptable).
 */

function vaultKey(): Buffer {
  const hex = (process.env.VAULT_KEY ?? "").trim();
  if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  // Fallback so the app still works before VAULT_KEY is configured. Rotating the
  // service-role key would make old entries unreadable, so set VAULT_KEY.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base) throw new Error("VAULT_KEY is not set");
  return Buffer.from(hkdfSync("sha256", base, "9to5-ai", "vault-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, body] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable secret");
  const d = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** Strong password that passes typical career-portal rules (upper, lower, digit, symbol). */
export function generatePortalPassword(length = 18): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ── Security questions ────────────────────────────────────────────────────
export const SECURITY_QUESTIONS = SECURITY_QUESTIONS_LIST;

/** Lowercase, trim, drop punctuation and extra spaces so "Fluffy!" == " fluffy ". */
export function normalizeAnswer(a: string): string {
  return a.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

export function hashAnswer(answer: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(normalizeAnswer(answer), salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1:${salt.toString("base64")}:${h.toString("base64")}`;
}

export function checkAnswer(answer: string, stored: string): boolean {
  const [v, salt, hash] = stored.split(":");
  if (v !== "s1" || !salt || !hash) return false;
  const h = scryptSync(normalizeAnswer(answer), Buffer.from(salt, "base64"), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hash, "base64");
  return want.length === h.length && timingSafeEqual(h, want);
}

/** Stable decoy questions for unknown emails, so the form can't be used to discover who has an account. */
export function decoyQuestions(emailLc: string): string[] {
  const seed = createHmac("sha256", vaultKey()).update(emailLc).digest();
  const pool = [...SECURITY_QUESTIONS];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) out.push(pool.splice(seed[i] % pool.length, 1)[0]);
  return out;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
