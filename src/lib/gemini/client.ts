import { isMockModeEnv } from "@/lib/config/env";

export function isMockMode(): boolean {
  return isMockModeEnv();
}

/** True only when a real HTTP call to Gemini would be made */
export function usesRealGeminiApi(): boolean {
  return !isMockMode();
}

export async function callGemini(prompt: string): Promise<string> {
  if (isMockMode()) {
    throw new Error("GEMINI_SKIPPED_MOCK_MODE");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey ?? "" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
  return text;
}
