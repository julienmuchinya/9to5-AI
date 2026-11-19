/**
 * A short, readable brief of a job posting, without AI (free, instant): what the job is, what it asks for,
 * what's nice to have, and the facts people look for first (years of experience, degree, clearance, visa).
 * Works on the plain text the job sources give (one paragraph or bullet per line).
 */

export interface JobBrief {
  summary: string;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  facts: string[];
}

const HEAD = {
  requirements: /^(requirements?|(minimum|basic|required|key) qualifications?|qualifications?|what (you.ll|you will) (need|bring)|what we.re looking for|who you are|you (have|bring|might be a fit)|must[- ]haves?|skills( and|&) experience|experience( and|&) skills|about you|your (profile|background|experience)|required skills|education( and|&) experience)\b/i,
  nice: /^(preferred( qualifications| skills)?|nice[- ]to[- ]haves?|bonus( points)?|pluses|it.s a plus|desired( skills| qualifications)?|additional qualifications)\b/i,
  resp: /^(responsibilities|(key |your |main )?(duties|responsibilities)|what (you.ll|you will) do|the role|in this role|day[- ]to[- ]day|your impact|what you.ll be doing|job duties|essential (duties|functions))\b/i,
  stop: /^(benefits|perks|what we offer|compensation|pay (range|transparency)|salary|about (us|the company|the team)|why (join|work)|equal (opportunity|employment)|eeo|our (commitment|values|culture)|how to apply|location|work environment|physical (demands|requirements)|disclaimer)\b/i,
};

const clean = (l: string) => l.replace(/^[\s•·*\-–—▪◦●○■□➢✓✔>]+/, "").replace(/\s+/g, " ").trim();
const isHeading = (l: string) => l.length <= 70 && !/[.]$/.test(l) && (/:$/.test(l) || Object.values(HEAD).some((re) => re.test(l)));

function factsOf(text: string): string[] {
  const out: string[] = [];
  const years = /(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*(\d{1,2})?\s*\+?\s*years?(?:'|’)?\s*(?:of\s+)?(?:professional\s+|relevant\s+|related\s+|hands-on\s+)?(?:experience|exp\b)/i.exec(text);
  if (years) out.push(`${years[1]}${years[2] ? `–${years[2]}` : "+"} years of experience`);
  const degree = /\b(bachelor'?s|master'?s|ph\.?d|associate'?s|b\.?s\.?|m\.?s\.?|high school diploma|ged|rn license|bsn|mba)\b[^.\n]{0,60}/i.exec(text);
  if (degree) out.push(degree[0].replace(/\s+/g, " ").trim().slice(0, 90));
  if (/\b(security clearance|secret clearance|top secret|ts\/sci|public trust)\b/i.test(text)) out.push("Security clearance mentioned");
  if (/\b(no|not|unable to|cannot|will not) (provide |offer )?(visa )?sponsor/i.test(text)) out.push("No visa sponsorship");
  else if (/\bvisa sponsorship (is )?(available|provided|offered)|will sponsor\b/i.test(text)) out.push("Visa sponsorship offered");
  if (/\b(us citizen(ship)?|u\.s\. citizen(ship)?) (is )?required|must be a (us|u\.s\.) citizen/i.test(text)) out.push("US citizenship required");
  const lic = /\b(license|licensure|certification|certified)\b[^.\n]{0,60}(required|must)/i.exec(text);
  if (lic) out.push(lic[0].replace(/\s+/g, " ").trim().slice(0, 90));
  return [...new Set(out)].slice(0, 6);
}

export function jobBrief(description: string | null | undefined): JobBrief {
  const text = (description ?? "").replace(/\r/g, "").trim();
  const brief: JobBrief = { summary: "", responsibilities: [], requirements: [], niceToHave: [], facts: factsOf(text) };
  if (!text) return brief;
  // Some sources send one long line with inline bullets ("• Python • SQL"): split those too.
  const lines = text
    .split(/\n|(?<=\S)\s+[•·▪●]\s+/)
    .map(clean)
    .filter(Boolean);
  let section: "intro" | "requirements" | "nice" | "resp" | "other" = "intro";
  const intro: string[] = [];
  for (const l of lines) {
    const head = l.replace(/:$/, "");
    if (isHeading(l)) {
      section = HEAD.nice.test(head) ? "nice" : HEAD.requirements.test(head) ? "requirements" : HEAD.resp.test(head) ? "resp" : HEAD.stop.test(head) ? "other" : section === "intro" ? "intro" : "other";
      continue;
    }
    // "Requirements: 3+ years of Python" on one line.
    const inline = /^([^:]{3,45}):\s+(.{8,})$/.exec(l);
    if (inline && (HEAD.requirements.test(inline[1]) || HEAD.nice.test(inline[1]))) {
      (HEAD.nice.test(inline[1]) ? brief.niceToHave : brief.requirements).push(inline[2].slice(0, 240));
      continue;
    }
    const item = l.slice(0, 240);
    if (section === "intro") intro.push(l);
    else if (section === "requirements") brief.requirements.push(item);
    else if (section === "nice") brief.niceToHave.push(item);
    else if (section === "resp") brief.responsibilities.push(item);
  }
  // No headed sections: take requirement-like sentences from anywhere.
  if (!brief.requirements.length) {
    const sentences = text.split(/(?<=[.!?])\s+|\n/).map(clean);
    brief.requirements = sentences.filter((s) => s.length > 15 && s.length < 240 && /(experience (with|in)|proficien|knowledge of|familiar(ity)? with|ability to|degree|years|must (have|be)|required|certif|licens)/i.test(s)).slice(0, 8);
  }
  // Summary: the first couple of real sentences, skipping company boilerplate where possible.
  const prose = (intro.length ? intro : lines).join(" ");
  const sents = prose.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  const aboutRole = sents.filter((s) => /\b(you|role|position|team|we.re (looking|seeking|hiring)|seeking|responsible)\b/i.test(s));
  brief.summary = (aboutRole.length ? aboutRole : sents).slice(0, 3).join(" ").slice(0, 600);
  const cap = (a: string[], n: number) => [...new Set(a)].filter((x) => x.length > 3).slice(0, n);
  brief.requirements = cap(brief.requirements, 10);
  brief.niceToHave = cap(brief.niceToHave, 6);
  brief.responsibilities = cap(brief.responsibilities, 8);
  return brief;
}
