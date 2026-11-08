/**
 * Well-known tech employers' public job boards (Greenhouse / Lever / Ashby), scanned in addition to the
 * companies the agent learns from the curated lists and its own database. A wrong or retired board name
 * just returns nothing, so this list can grow freely.
 */
export const EXTRA_BOARDS: { ats: "greenhouse" | "lever" | "ashby"; board: string }[] = [
  ...[
    "stripe", "airbnb", "databricks", "robinhood", "coinbase", "figma", "discord", "dropbox", "reddit", "instacart",
    "lyft", "roblox", "cloudflare", "datadog", "mongodb", "asana", "twilio", "brex", "anthropic", "scaleai",
    "spacex", "pinterest", "gitlab", "duolingo", "squarespace", "affirm", "chime", "gusto", "samsara", "verkada",
    "nuro", "flexport", "faire", "airtable", "okta", "elastic", "toast", "andurilindustries", "doordashusa", "block",
    "mercury", "plaidinc", "cockroachlabs", "grafanalabs", "hashicorp", "confluent", "snowflake", "rubrik", "carta", "benchling",
  ].map((board) => ({ ats: "greenhouse" as const, board })),
  ...["palantir", "plaid", "kraken", "zoox", "shieldai", "applied", "spotify", "mistral"].map((board) => ({ ats: "lever" as const, board })),
  ...["openai", "ramp", "notion", "linear", "vercel", "retool", "replit", "cohere", "perplexity", "deel", "supabase", "posthog"].map((board) => ({ ats: "ashby" as const, board })),
];
