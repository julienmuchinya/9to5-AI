import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, readUsage } from "./freeTier";

/**
 * Backup AI providers with free tiers, used when Gemini's daily quota runs out.
 * Both speak the OpenAI chat-completions format, so one client covers them.
 *  - Groq:       GROQ_API_KEY        (console.groq.com → API Keys; free, no card)
 *  - OpenRouter: OPENROUTER_API_KEY  (openrouter.ai → Keys; ":free" models cost nothing)
 * Model names change over time: each provider has a list to fall through, overridable with
 * GROQ_MODEL / OPENROUTER_MODEL.
 */
interface Provider {
  name: "groq" | "openrouter";
  url: string;
  key: string | undefined;
  models: string[];
  /** Our own daily stop, well under the provider's free limit. */
  perDay: number;
}

const providers = (): Provider[] => [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY,
    models: [process.env.GROQ_MODEL, "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"].filter(Boolean) as string[],
    perDay: Number(process.env.FREE_GROQ_RPD ?? 800),
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY,
    models: [process.env.OPENROUTER_MODEL, "meta-llama/llama-3.3-70b-instruct:free", "deepseek/deepseek-chat-v3-0324:free", "google/gemma-3-27b-it:free"].filter(Boolean) as string[],
    perDay: Number(process.env.FREE_OPENROUTER_RPD ?? 45),
  },
];

export const fallbackConfigured = () => providers().some((p) => p.key);
export const fallbackNames = () => providers().filter((p) => p.key).map((p) => p.name);

const dead = new Set<string>();

/** One JSON answer from the first backup provider that responds. Throws if none can. */
export async function fallbackJson(db: SupabaseClient, prompt: string, userId?: string): Promise<string> {
  let detail = "no backup AI configured (set GROQ_API_KEY or OPENROUTER_API_KEY)";
  for (const p of providers()) {
    if (!p.key) continue;
    const metric = `ai_${p.name}_requests` as const;
    const used = await readUsage(db, metric).catch(() => 0);
    if (used >= p.perDay) {
      detail = `${p.name} daily budget used (${used}/${p.perDay})`;
      continue;
    }
    for (const model of p.models) {
      if (dead.has(`${p.name}:${model}`)) continue;
      let res: Response;
      try {
        res = await fetch(p.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "Reply with one JSON object only. No prose, no code fences." },
              { role: "user", content: prompt },
            ],
          }),
          signal: AbortSignal.timeout(55_000),
        });
      } catch (e) {
        detail = `${p.name} network: ${(e as Error).message}`;
        continue;
      }
      if (!res.ok) {
        detail = `${p.name}/${model} → ${res.status}: ${(await res.text()).slice(0, 160)}`;
        if (res.status === 404 || res.status === 400) dead.add(`${p.name}:${model}`);
        if (res.status === 401 || res.status === 403) break; // bad key — next provider
        continue;
      }
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        detail = `${p.name}/${model} returned nothing`;
        continue;
      }
      await bumpUsage(db, metric, 1).catch(() => {});
      if (userId) await bumpUsage(db, metric, 1, userId).catch(() => {});
      return text;
    }
  }
  throw new Error(detail);
}
