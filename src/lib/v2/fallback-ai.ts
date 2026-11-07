import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, readUsage, SAFETY_RATIO } from "./freeTier";

/**
 * Backup AI providers with free tiers. Both speak the OpenAI chat-completions format.
 *  - Groq:       GROQ_API_KEY        (console.groq.com → API Keys; free, no card)
 *  - OpenRouter: OPENROUTER_API_KEY  (openrouter.ai → Keys; ":free" models cost nothing)
 *
 * Groq's free tier (measured from its x-ratelimit headers, Nov 2026) is PER MODEL:
 *   1,000 requests/day — refilled gradually (one back every ~86 s), not at midnight
 *   8,000 tokens/minute — prompt + answer; this is the limit that actually bites
 * So each model gets the same guard rails as Gemini: a daily stop at SAFETY_RATIO (85%) of its own
 * limit, a per-minute token pacer, and Groq's own "remaining" headers trusted over our counters
 * (the website and the agent share one key).
 */
interface Model {
  id: string;
  /** Extra body fields (reasoning models think in tokens that count against the per-minute limit). */
  extra?: Record<string, unknown>;
}
interface Provider {
  name: "groq" | "openrouter";
  url: string;
  key: string | undefined;
  models: Model[];
  /** Provider's free requests per day, per model. */
  rpd: number;
  /** Provider's free tokens per minute, per model (0 = not limited by tokens). */
  tpm: number;
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const groqModels = (): Model[] => {
  const list: Model[] = [
    { id: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
    { id: "qwen/qwen3.8-27b", extra: { reasoning_effort: "none" } },
    { id: "openai/gpt-oss-20b", extra: { reasoning_effort: "low" } },
  ];
  const pick = process.env.GROQ_MODEL;
  return pick ? [{ id: pick, extra: list.find((m) => m.id === pick)?.extra }, ...list.filter((m) => m.id !== pick)] : list;
};

const providers = (): Provider[] => [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY,
    models: groqModels(),
    rpd: num(process.env.FREE_GROQ_RPD, 1000),
    tpm: num(process.env.FREE_GROQ_TPM, 8000),
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY,
    models: [process.env.OPENROUTER_MODEL, "meta-llama/llama-3.3-70b-instruct:free", "deepseek/deepseek-chat-v3-0324:free", "google/gemma-3-27b-it:free"]
      .filter((m): m is string => Boolean(m))
      .map((id) => ({ id })),
    // OpenRouter's free models: 50 requests/day for the whole account (not per model).
    rpd: num(process.env.FREE_OPENROUTER_RPD, 50),
    tpm: 0,
  },
];

export const fallbackConfigured = () => providers().some((p) => p.key);
export const fallbackNames = () => providers().filter((p) => p.key).map((p) => p.name);

/** Rough token count (≈3.5 characters per token for English + JSON). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

// ── Per-process state ─────────────────────────────────────────────────────
const dead = new Set<string>(); // retired / unknown model names
/** Model can't be used before this time (rate limited, or its daily stop was reached). */
const blockedUntil = new Map<string, number>();
/** Tokens sent in the last minute, per model. */
const window = new Map<string, { at: number; tokens: number }[]>();

const keyOf = (p: Provider, m: Model) => `${p.name}:${m.id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ms until `tokens` more fit under this model's per-minute budget (0 = now). */
function tokenWait(k: string, tokens: number, tpm: number): number {
  if (!tpm) return 0;
  const cap = Math.floor(tpm * SAFETY_RATIO);
  const now = Date.now();
  const recent = (window.get(k) ?? []).filter((e) => now - e.at < 60_000);
  window.set(k, recent);
  let used = recent.reduce((s, e) => s + e.tokens, 0);
  if (used + tokens <= cap) return 0;
  // Wait until enough old entries fall out of the 60 s window.
  for (const e of recent) {
    used -= e.tokens;
    if (used + tokens <= cap) return e.at + 60_000 - now + 250;
  }
  return 60_000;
}

/** "1m26.4s" / "577ms" / "7.66s" → ms */
export function parseDuration(s: string | null): number {
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000; // retry-after: seconds
  let ms = 0;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) ms += Number(n) * (u === "ms" ? 1 : u === "s" ? 1000 : u === "m" ? 60_000 : 3_600_000);
  return ms;
}

export interface FallbackStatus {
  name: string;
  /** Requests our counters saw today, all models. */
  used: number;
  /** Our daily stop, all models together (85% of the free limit). */
  stopAt: number;
  limit: number;
  models: number;
  tokensPerMinute: number;
}

/** Today's backup-AI usage for the Usage page. */
export async function fallbackStatus(db: SupabaseClient): Promise<FallbackStatus[]> {
  const out: FallbackStatus[] = [];
  for (const p of providers()) {
    if (!p.key) continue;
    const n = p.name === "groq" ? p.models.length : 1;
    out.push({
      name: p.name,
      used: await readUsage(db, `ai_${p.name}_requests`).catch(() => 0),
      limit: p.rpd * n,
      stopAt: Math.floor(p.rpd * SAFETY_RATIO) * n,
      models: n,
      tokensPerMinute: p.tpm,
    });
  }
  return out;
}

/** Is at least one backup model under its daily stop? (Cheap: counters only.) */
export async function fallbackAvailable(db: SupabaseClient): Promise<boolean> {
  for (const p of providers()) {
    if (!p.key) continue;
    if (p.name === "groq") {
      for (const m of p.models) {
        if (dead.has(keyOf(p, m)) || (blockedUntil.get(keyOf(p, m)) ?? 0) > Date.now() + 10 * 60_000) continue;
        const used = await readUsage(db, "ai_groq_requests", `model:${m.id}`).catch(() => 0);
        if (used < Math.floor(p.rpd * SAFETY_RATIO)) return true;
      }
    } else if ((await readUsage(db, "ai_openrouter_requests").catch(() => 0)) < Math.floor(p.rpd * SAFETY_RATIO)) return true;
  }
  return false;
}

export class PromptTooLargeError extends Error {}

/**
 * One JSON answer from the first backup model that can take it. Throws if none can.
 * `maxTokens` caps the answer (it counts against Groq's per-minute token limit too).
 */
export async function fallbackJson(db: SupabaseClient, prompt: string, userId?: string, opts: { maxTokens?: number } = {}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 2000;
  const system = "Reply with one JSON object only. No prose, no code fences.";
  const need = estimateTokens(system + prompt) + maxTokens;
  let detail = "no backup AI configured (set GROQ_API_KEY or OPENROUTER_API_KEY)";
  let tooLarge = false;

  for (const p of providers()) {
    if (!p.key) continue;
    if (p.tpm && need > p.tpm * SAFETY_RATIO) {
      tooLarge = true;
      detail = `${p.name}: prompt ~${need} tokens is over its ${p.tpm}/minute limit`;
      continue;
    }
    const daily = Math.floor(p.rpd * SAFETY_RATIO);
    if (p.name === "openrouter") {
      const used = await readUsage(db, "ai_openrouter_requests").catch(() => 0);
      if (used >= daily) {
        detail = `openrouter daily budget used (${used}/${p.rpd}, paused at ${Math.round(SAFETY_RATIO * 100)}%)`;
        continue;
      }
    }

    // Groq: the model that can take this prompt soonest, among those under their own daily stop.
    const candidates: { m: Model; wait: number }[] = [];
    for (const m of p.models) {
      const k = keyOf(p, m);
      if (dead.has(k)) continue;
      if (p.name === "groq") {
        const used = await readUsage(db, "ai_groq_requests", `model:${m.id}`).catch(() => 0);
        if (used >= daily) {
          detail = `groq ${m.id} daily budget used (${used}/${p.rpd}, paused at ${Math.round(SAFETY_RATIO * 100)}%)`;
          continue;
        }
      }
      const blocked = Math.max(0, (blockedUntil.get(k) ?? 0) - Date.now());
      candidates.push({ m, wait: Math.max(blocked, tokenWait(k, need, p.tpm)) });
    }
    candidates.sort((a, b) => a.wait - b.wait);

    for (const { m } of candidates) {
      const k = keyOf(p, m);
      for (let attempt = 0; attempt < 2; attempt++) {
        const wait = Math.max(Math.max(0, (blockedUntil.get(k) ?? 0) - Date.now()), tokenWait(k, need, p.tpm));
        if (wait > 65_000) break; // this model is out for longer than a minute — try the next one
        if (wait) await sleep(wait);
        window.set(k, [...(window.get(k) ?? []), { at: Date.now(), tokens: need }]);

        let res: Response;
        try {
          res = await fetch(p.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
            body: JSON.stringify({
              model: m.id,
              temperature: 0.1,
              max_tokens: maxTokens,
              response_format: { type: "json_object" },
              ...(m.extra ?? {}),
              messages: [
                { role: "system", content: system },
                { role: "user", content: prompt },
              ],
            }),
            signal: AbortSignal.timeout(55_000),
          });
        } catch (e) {
          detail = `${p.name} network: ${(e as Error).message}`;
          break;
        }

        // Groq says exactly what's left — trust it over our counters (the website shares the key).
        const remainingReq = res.headers.get("x-ratelimit-remaining-requests");
        const limitReq = res.headers.get("x-ratelimit-limit-requests");
        if (remainingReq != null && limitReq != null && Number(remainingReq) < Number(limitReq) * (1 - SAFETY_RATIO)) {
          // Down to the last 15% of today's requests: rest this model until enough have refilled.
          blockedUntil.set(k, Date.now() + Math.max(parseDuration(res.headers.get("x-ratelimit-reset-requests")), 30 * 60_000));
        }
        const remainingTok = res.headers.get("x-ratelimit-remaining-tokens");
        if (remainingTok != null && Number(remainingTok) < need) {
          blockedUntil.set(k, Math.max(blockedUntil.get(k) ?? 0, Date.now() + parseDuration(res.headers.get("x-ratelimit-reset-tokens"))));
        }

        if (res.ok) {
          const data = await res.json();
          const text: string = data?.choices?.[0]?.message?.content ?? "";
          const real = Number(data?.usage?.total_tokens ?? 0);
          if (real) {
            const list = window.get(k) ?? [];
            if (list.length) list[list.length - 1].tokens = real; // replace the estimate with the real count
          }
          if (!text.trim()) {
            detail = `${p.name}/${m.id} returned nothing`;
            break;
          }
          const metric = `ai_${p.name}_requests` as const;
          await bumpUsage(db, metric, 1).catch(() => {});
          if (p.name === "groq") await bumpUsage(db, metric, 1, `model:${m.id}`).catch(() => {});
          if (userId) await bumpUsage(db, metric, 1, userId).catch(() => {});
          return text;
        }

        const body = (await res.text()).slice(0, 200);
        detail = `${p.name}/${m.id} → ${res.status}: ${body}`;
        if (res.status === 404 || /model_(not_found|decommissioned)|does not exist/i.test(body)) {
          dead.add(k);
          break;
        }
        if (res.status === 401 || res.status === 403) break; // bad key
        if (res.status === 413 || /too large|context_length|reduce the length/i.test(body)) {
          tooLarge = true;
          break;
        }
        if (res.status === 429) {
          const retry = parseDuration(res.headers.get("retry-after")) || 20_000;
          blockedUntil.set(k, Date.now() + retry);
          if (retry > 25_000) break; // daily limit or a long wait — next model
          continue; // short per-minute wait — retry once
        }
        if (res.status === 400) {
          // Usually a parameter this model doesn't accept; don't keep paying for it in this process.
          dead.add(k);
          break;
        }
        // 5xx: one short retry
        await sleep(2000);
      }
    }
  }
  if (tooLarge) throw new PromptTooLargeError(detail);
  throw new Error(detail);
}
