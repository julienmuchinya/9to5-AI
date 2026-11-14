import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, checkGemini, FREE_LIMITS } from "./freeTier";
import { fallbackAvailable, fallbackChat, fallbackConfigured, fallbackJson, type ChatMessage } from "./fallback-ai";

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
 * Ask for JSON and parse it.
 *  prefer "gemini" (default): Gemini first; the backup (Groq / OpenRouter) when Gemini's quota is used up or Google is down.
 *  prefer "fallback": the backup first — it has ~10x Gemini's free daily requests — and Gemini only when the
 *    backup can't (prompt too big for Groq's per-minute token limit, or its budget is used up). Use this for
 *    agent work so Gemini stays free for reading PDFs and for chat, which only Gemini can do.
 *  prefer "fallback-only": never spend Gemini (nice-to-have work like resume rewording).
 * PDFs (inlineData) always need Gemini — the backups only read text.
 */
export async function geminiJson<T>(
  db: SupabaseClient,
  prompt: string,
  extraParts: GeminiPart[] = [],
  userId?: string,
  opts: { prefer?: "gemini" | "fallback" | "fallback-only"; maxTokens?: number } = {}
): Promise<T> {
  const textOnly = extraParts.every((p) => !p.inlineData);
  const canFallback = textOnly && fallbackConfigured();
  const viaFallback = async () =>
    parseJson<T>(await fallbackJson(db, [...extraParts.map((p) => p.text ?? ""), prompt].join("\n\n"), userId, { maxTokens: opts.maxTokens }));
  if (opts.prefer === "fallback-only") {
    if (!canFallback) throw new Error("No backup AI configured");
    return viaFallback();
  }
  let backupError: Error | null = null;
  if (canFallback && opts.prefer === "fallback") {
    try {
      return await viaFallback();
    } catch (f) {
      backupError = f as Error; // fall through to Gemini
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
    if (backupError) {
      // Both tried: report a quota stop only if Gemini's was a quota stop.
      throw e instanceof FreeTierLimitError ? new FreeTierLimitError(`${e.message} Backup AI: ${backupError.message}`) : e;
    }
    if (!canFallback) throw e;
    const quotaOrOutage = e instanceof FreeTierLimitError || /overloaded|network|GEMINI_API_KEY/i.test((e as Error).message);
    if (!quotaOrOutage) throw e;
    try {
      return await viaFallback();
    } catch (f) {
      throw e instanceof FreeTierLimitError ? new FreeTierLimitError(`${e.message} Backup AI also failed: ${(f as Error).message}`) : e;
    }
  }
}

/** Is any AI available right now (Gemini under budget, or a backup provider under its own budget)? */
export async function aiAvailable(db: SupabaseClient): Promise<{ allowed: boolean; reason?: string; gemini: boolean }> {
  const g = await checkGemini(db);
  if (g.allowed) return { allowed: true, gemini: true };
  if (fallbackConfigured() && (await fallbackAvailable(db))) return { allowed: true, gemini: false };
  return { allowed: false, gemini: false, reason: fallbackConfigured() ? `${g.reason}; backup AI's daily budget is used up too` : g.reason };
}

/** Gemini-format conversation → OpenAI-format messages (for the backup AI). Exported for tests. */
export function toChatMessages(contents: GeminiContent[], system?: string): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: "system", content: system }] : [];
  let lastIds: string[] = [];
  contents.forEach((c, i) => {
    if (c.role === "model") {
      const calls = c.parts.filter((p) => p.functionCall);
      lastIds = calls.map((p, k) => p.functionCall!.id || `call_${i}_${k}`);
      const text = c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((p, k) => ({ id: lastIds[k], type: "function" as const, function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) } })) }
          : {}),
      });
      return;
    }
    const responses = c.parts.filter((p) => p.functionResponse);
    responses.forEach((p, k) => out.push({ role: "tool", tool_call_id: p.functionResponse!.id || lastIds[k] || `call_${i}_${k}`, content: JSON.stringify(p.functionResponse!.response).slice(0, 6000) }));
    const text = c.parts.filter((p) => p.text).map((p) => p.text).join("\n\n");
    if (text) out.push({ role: "user", content: text });
  });
  return out;
}

/**
 * Chat turn with tools: Gemini first; when Gemini's quota is used up (or Google is down) and a backup
 * is configured, the same conversation goes to Groq in OpenAI format. Returns Gemini-shaped parts.
 */
/** One chat turn through the backup (Groq / OpenRouter) models, in Gemini's part format. */
async function backupGenerate(db: SupabaseClient, opts: { contents: GeminiContent[]; system?: string; tools?: GeminiTool[]; userId?: string; deadline?: number }): Promise<{ parts: GeminiPart[]; text: string; via: "backup" }> {
  const msg: ChatMessage = await fallbackChat(db, toChatMessages(opts.contents, opts.system), {
    userId: opts.userId,
    deadline: opts.deadline,
    maxTokens: 1200,
    tools: opts.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
  });
  const parts: GeminiPart[] = [];
  if (msg.content) parts.push({ text: msg.content });
  for (const c of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function.arguments || "{}");
    } catch {
      // leave empty
    }
    parts.push({ functionCall: { id: c.id, name: c.function.name, args } });
  }
  return { parts, text: msg.content ?? "", via: "backup" };
}

/**
 * A chat turn with tools. Gemini first, backup on quota/outage — or, with `prefer: "backup"`, the fast backup
 * first (the chat page: Gemini's free tier is paced to ~6 s between calls, so a 4-tool reply took over a minute).
 */
/**
 * Gemini's thinking models reject earlier tool calls that carry no thought signature — the case when the
 * backup AI made them and Gemini takes over mid-reply (it answered 400 and the chat failed). Such calls and
 * their results are passed as plain text instead.
 */
export function forGemini(contents: GeminiContent[]): GeminiContent[] {
  if (!contents.some((c) => c.parts.some((p) => p.functionCall && !p.thoughtSignature))) return contents;
  return contents.map((c) => ({
    role: c.role,
    parts: c.parts.map((p) =>
      p.functionCall
        ? { text: `(called ${p.functionCall.name} ${JSON.stringify(p.functionCall.args ?? {})})` }
        : p.functionResponse
          ? { text: `(result of ${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response).slice(0, 6000)})` }
          : p
    ),
  }));
}

export async function chatGenerate(
  db: SupabaseClient,
  opts: { contents: GeminiContent[]; system?: string; tools?: GeminiTool[]; userId?: string; prefer?: "gemini" | "backup"; deadline?: number }
): Promise<{ parts: GeminiPart[]; text: string; via: "gemini" | "backup" }> {
  // Gemini is paced (~6 s between calls) and can be slow: skip it when the caller is out of time.
  const geminiTime = () => !opts.deadline || opts.deadline - Date.now() > 15_000;
  if (opts.prefer === "backup" && fallbackConfigured()) {
    try {
      return await backupGenerate(db, opts);
    } catch {
      // the backup is out of quota or down: Gemini below
    }
  }
  if (!geminiTime()) throw new Error("AI is busy right now (out of time for this reply)");
  try {
    return { ...(await geminiGenerate(db, { ...opts, contents: forGemini(opts.contents) })), via: "gemini" };
  } catch (e) {
    const quotaOrOutage = e instanceof FreeTierLimitError || /overloaded|network/i.test((e as Error).message);
    if (!quotaOrOutage || !fallbackConfigured() || opts.prefer === "backup") throw e;
    try {
      return await backupGenerate(db, opts);
    } catch (f) {
      throw e instanceof FreeTierLimitError ? new FreeTierLimitError(`${e.message} Backup AI also failed: ${(f as Error).message}`) : e;
    }
  }
}
