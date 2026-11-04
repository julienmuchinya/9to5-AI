# Gemini Setup — 9to5 AI

## 1. API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key.
3. Add to `.env.local` and GitHub secrets:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

## 2. Mock mode (default)

With `NEXT_PUBLIC_MOCK_MODE=true`, **no Gemini HTTP calls** are made.

## 3. Live mode

- Key is validated when AI features are enabled.
- Budget guard keeps **maxCostPerDay = $0**.
- Agent skips Gemini when cost risk is detected.
- Responses are cached in `ai_cache` when calls are allowed.

## 4. Disable AI

Keep mock mode on, or omit `GEMINI_API_KEY` and disable Gemini in Settings until you are ready.
