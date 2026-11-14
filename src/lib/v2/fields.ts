import { ROLE_CATALOG } from "./role-catalog";
import { WORKDAY_BOARDS } from "./discovery/workday";

/**
 * "The oil and gas sector", "healthcare", "minerals" → does this job belong there? Used by the chat to answer
 * questions about a whole field: by title (the field's typical roles and words) or by employer (the sector of
 * the employers the agent searches).
 */
const FIELD_WORDS: { re: RegExp; sector?: string; catalog?: string; words: RegExp }[] = [
  {
    re: /oil|gas|petrol|offshore|drill|mineral|mining|energy|pipeline|refin/i,
    sector: "energy",
    catalog: "Oil, gas & energy",
    words: /oil|gas|petrol|offshore|subsea|drill|rig\b|roustabout|floorhand|roughneck|derrick|lease operator|field operator|pipeline|refin|lng|well ?site|completions|reservoir|frac|wireline|mining|mine\b|mineral|metallurg|energy/i,
  },
  { re: /health|medic|nurs|hospital|clinic|pharma/i, sector: "healthcare", catalog: "Healthcare", words: /nurse|medical|patient|clinical|pharma|health|phlebot|care (tech|coordinator)/i },
  { re: /bank|financ|insur|account/i, sector: "finance", catalog: "Finance & accounting", words: /account|financ|bank|teller|loan|credit|audit|underwrit|claims|insurance|payroll/i },
  { re: /retail|store|hospitality/i, sector: "retail", catalog: "Retail & hospitality", words: /store|retail|cashier|sales associate|shift supervisor|front desk/i },
  { re: /tech|software|it\b|data|cyber/i, sector: "tech", catalog: "Software & IT", words: /software|developer|engineer|data|it support|help desk|cyber|security analyst|devops|cloud/i },
  { re: /trade|technician|electric|mechanic|weld|hvac|field service/i, catalog: "Skilled trades & field", words: /technician|electrician|mechanic|welder|hvac|maintenance|field service|instrument/i },
  { re: /government|defense|federal/i, sector: "government", words: /clearance|federal|defense|government/i },
];

export function fieldMatcher(term: string): ((title: string, company: string) => boolean) | null {
  const f = FIELD_WORDS.find((x) => x.re.test(term));
  if (!f) return null;
  const companies = new Set(WORKDAY_BOARDS.filter((b) => b.sector === f.sector || (f.sector === "energy" && (b.sector === "mining" || b.sector === "utilities"))).map((b) => b.company.toLowerCase()));
  const roles = (ROLE_CATALOG.find((g) => g.field === f.catalog)?.roles ?? []).map((r) => r.toLowerCase());
  return (title, company) => {
    const t = title.toLowerCase();
    return f.words.test(title) || roles.some((r) => t.includes(r)) || companies.has(company.toLowerCase());
  };
}
