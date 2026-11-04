import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, checkGemini, FREE_LIMITS } from "./freeTier";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

export class FreeTierLimitError extends Error {}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
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
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API}/${geminiModel()}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  await bumpUsage(db, "gemini_requests", 1);
  if (opts.userId) await bumpUsage(db, "gemini_requests", 1, opts.userId);

  if (!res || !res.ok) {
    const detail = res ? (await res.text()).slice(0, 300) : "no response";
    if (res?.status === 429) throw new FreeTierLimitError(`Gemini free quota reached: ${detail}`);
    throw new Error(`Gemini error ${res?.status}: ${detail}`);
  }
  const data = await res.json();
  const tokens = Number(data?.usageMetadata?.totalTokenCount ?? 0);
  if (tokens) await bumpUsage(db, "gemini_tokens", tokens);
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return { parts, text };
}

/** Ask for JSON and parse it. */
export async function geminiJson<T>(
  db: SupabaseClient,
  prompt: string,
  extraParts: GeminiPart[] = [],
  userId?: string
): Promise<T> {
  const { text } = await geminiGenerate(db, {
    contents: [{ role: "user", parts: [...extraParts, { text: prompt }] }],
    json: true,
    temperature: 0.1,
    userId,
  });
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned) as T;
}
