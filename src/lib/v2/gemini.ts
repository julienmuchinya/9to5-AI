import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, checkGemini, FREE_LIMITS } from "./freeTier";
import { fallbackConfigured, fallbackJson } from "./fallback-ai";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * Models to try, in order. Google retires model names without warning (gemini-2.5-flash
 * now returns 404 for new keys) and busy models return 503, so we fall through the list
 * and remember whichever one answered.
 */
const MODEL_CHAIN = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];
const deadModels = new Set<string>();
/** Models whose free daily quota ran out in this process (429). */
const exhausted = new Set<string>();
let preferred: string | null = null;
export function geminiModels(): string[] {
  const list = [preferred, process.env.GEMINI_MODEL, ...MODEL_CHAIN].filter((m): m is string => Boolean(m));
  return [...new Set(list)].filter((m) => !deadModels.has(m));
}
export const geminiModel = () => geminiModels()[0] ?? MODEL_CHAIN[0];

export class FreeTierLimitError extends Error {}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  thought?: boolean;
  thoughtSignature?: string;
}
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface GeminiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Keep this process under the per-minute free limit.
let lastCallAt = 0;
async function pace() {
  const gap = Math.ceil(60000 / FREE_LIMITS.geminiRequestsPerMinute) + 250;
  const wait = lastCallAt + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** One Gemini request, counted against the free-tier budget. `db` must be a service client. */
export async function geminiGenerate(
  db: SupabaseClient,
  opts: {
    contents: GeminiContent[];
    system?: string;
    tools?: GeminiTool[];
    json?: boolean;
    temperature?: number;
    userId?: string;
  }
): Promise<{ parts: GeminiPart[]; text: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const budget = await checkGemini(db);
  if (!budget.allowed) throw new FreeTierLimitError(budget.reason);

  await pace();
  const body: Record<string, unknown> = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.tools?.length) body.tools = [{ functionDeclarations: opts.tools }];

  let res: Response | null = null;
  let detail = "no response";
  let saw429 = false;
  let saw5xx = false;
  const models = geminiModels();
  outer: for (let round = 0; round < 2; round++) {
    for (const model of models) {
      if (deadModels.has(model) || exhausted.has(model)) continue;
      try {
        res = await fetch(`${API}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(55_000),
        });
      } catch (e) {
        res = null;
        saw5xx = true;
        detail = `network: ${(e as Error).message}`;
        continue;
      }
      if (res.ok) {
        preferred = model;
        break outer;
      }
      detail = `${model} → ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status === 404) deadModels.add(model); // retired name — never try again in this process
      else if (res.status === 429) {
        // Free quota is per model per day: that model is done for this process, try the next one.
        saw429 = true;
        exhausted.add(model);
      } else if (res.status >= 500) saw5xx = true;
      else break outer; // bad request — another model won't help
    }
    // A second pass only helps when a model was busy (5xx/network), never for used-up quotas.
    if (!saw5xx) break;
    saw5xx = false;
    await new Promise((r) => setTimeout(r, 3000));
  }
  // Count only requests Google actually served. Rejected tries (404 retired / 429 quota) cost nothing
  // on Google's side; counting them used to burn our own daily budget twice as fast (216 counted vs 112 real).
  if (res?.ok) {
    await bumpUsage(db, "gemini_requests", 1);
    if (opts.userId) await bumpUsage(db, "gemini_requests", 1, opts.userId);
  }

  if (!res || !res.ok) {
    if (saw429 || res?.status === 429) throw new FreeTierLimitError(`Gemini's free quota is used up for now. It resets daily. (${detail})`);
    if (res && res.status >= 500) throw new Error(`Google's AI is overloaded right now — try again in a few minutes. (${detail})`);
    throw new Error(`AI request failed: ${detail}`);
  }
  const data = await res.json();
  const tokens = Number(data?.usageMetadata?.totalTokenCount ?? 0);
  if (tokens) await bumpUsage(db, "gemini_tokens", tokens);
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  // Newer models can return "thought" parts — those are reasoning, not the answer.
  const text = parts.filter((p) => !(p as { thought?: boolean }).thought).map((p) => p.text ?? "").join("");
  return { parts, text };
}

const parseJson = <T,>(text: string): T => JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as T;

/**
 * Ask for JSON and parse it. Uses Gemini first; when Gemini's free quota is used up (or Google is down)
 * and a backup provider is configured (GROQ_API_KEY / OPENROUTER_API_KEY), the same prompt goes there.
 * `prefer: "fallback"` sends text-only work to the backup first, to save Gemini for PDFs and chat.
 * PDFs (inlineData) need Gemini — the backups only read text.
 */
export async function geminiJson<T>(
  db: SupabaseClient,
  prompt: string,
  extraParts: GeminiPart[] = [],
  userId?: string,
  opts: { prefer?: "gemini" | "fallback" | "fallback-only" } = {}
): Promise<T> {
  const textOnly = extraParts.every((p) => !p.inlineData);
  const canFallback = textOnly && fallbackConfigured();
  const viaFallback = async () => parseJson<T>(await fallbackJson(db, [...extraParts.map((p) => p.text ?? ""), prompt].join("\n\n"), userId));
  if (opts.prefer === "fallback-only") {
    if (!canFallback) throw new Error("No backup AI configured");
    return viaFallback();
  }
  if (canFallback && opts.prefer === "fallback") {
    try {
      return await viaFallback();
    } catch {
      // fall through to Gemini
    }
  }
  try {
    const { text } = await geminiGenerate(db, {
      contents: [{ role: "user", parts: [...extraParts, { text: prompt }] }],
      json: true,
      temperature: 0.1,
      userId,
    });
    return parseJson<T>(text);
  } catch (e) {
    if (!canFallback || opts.prefer === "fallback") throw e;
    const quotaOrOutage = e instanceof FreeTierLimitError || /overloaded|network|GEMINI_API_KEY/i.test((e as Error).message);
    if (!quotaOrOutage) throw e;
    try {
      return await viaFallback();
    } catch (f) {
      throw e instanceof FreeTierLimitError ? new FreeTierLimitError(`${e.message} Backup AI also failed: ${(f as Error).message}`) : e;
    }
  }
}

/** Is any AI available right now (Gemini under budget, or a backup provider)? */
export async function aiAvailable(db: SupabaseClient): Promise<{ allowed: boolean; reason?: string; gemini: boolean }> {
  const g = await checkGemini(db);
  if (g.allowed) return { allowed: true, gemini: true };
  if (fallbackConfigured()) return { allowed: true, gemini: false };
  return { allowed: false, gemini: false, reason: g.reason };
}
