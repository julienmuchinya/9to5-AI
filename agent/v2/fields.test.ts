/**
 * Form-reading regression tests on markup copied from real Lever / Ashby / Greenhouse forms.
 * Runs a real headless Chromium (Playwright) against static HTML — no network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { collectFields } from "./apply";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
  page = await ctx.newPage();
}, 60_000);
afterAll(async () => browser?.close());

const read = async (html: string) => {
  await page.setContent(`<!doctype html><html><body><form>${html}</form></body></html>`);
  return collectFields(page);
};

describe("reading real form markup", () => {
  it("Lever: question text from .application-label, radio choices are options", async () => {
    const f = await read(`
      <li class="application-question custom-question"><div><div class="application-label full-width multiple-choice"><div class="text">Will you require a reasonable accommodation?<span class="required">✱</span></div></div>
      <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
        <li><label><input type="radio" name="cards[a][field0]" value="Yes"><span class="application-answer-alternative">Yes</span></label></li>
        <li><label><input type="radio" name="cards[a][field0]" value="No"><span class="application-answer-alternative">No</span></label></li>
      </ul></div></div></li>`);
    expect(f).toHaveLength(1);
    expect(f[0].label).toMatch(/^Will you require a reasonable accommodation\?/);
    expect(f[0].kind).toBe("radio");
    expect(f[0].options).toEqual(["Yes", "No"]);
    expect(f[0].required).toBe(true);
  });

  it("Lever: a checkbox list is ONE multi-choice question", async () => {
    const f = await read(`
      <li class="application-question custom-question"><div><div class="application-label"><div class="text">Which teams interest you?<span class="required">✱</span></div></div>
      <div class="application-field"><ul data-qa="checkboxes">
        <li><label><input type="checkbox" name="cards[b][field1]" value="iOS"><span>iOS</span></label></li>
        <li><label><input type="checkbox" name="cards[b][field1]" value="Backend"><span>Backend</span></label></li>
        <li><label><input type="checkbox" name="cards[b][field1]" value="Android"><span>Android</span></label></li>
      </ul></div></div></li>`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "checkboxes", label: expect.stringMatching(/^Which teams interest you\?/), options: ["iOS", "Backend", "Android"] });
  });

  it("Lever: a select gets its question, not its internal name", async () => {
    const f = await read(`
      <li class="application-question custom-question"><div><div class="application-label"><div class="text">Where did you first hear about this job?<span class="required">✱</span></div></div>
      <div class="application-field required-field"><select name="cards[c][field0]" required><option value="">Select...</option><option>LinkedIn - Job Posting</option><option>Other</option></select></div></div></li>`);
    expect(f[0].label).toMatch(/^Where did you first hear about this job\?/);
    expect(f[0].options).toEqual(["LinkedIn - Job Posting", "Other"]);
  });

  it("ignores tooltip text inside a label", async () => {
    const f = await read(`<label for="race">Race <span class="tooltip" role="tooltip">Hispanic or Latino: a person of Cuban, Mexican… origin</span></label>
      <select id="race"><option>Select ...</option><option>White</option><option>Black or African American</option></select>`);
    expect(f[0].label).toBe("Race");
  });

  it("Ashby: Yes/No button pairs are a question; their hidden checkbox is skipped; CSS-starred titles are required", async () => {
    const f = await read(`
      <style>._required_x::after { content: "*"; } .hid { position:absolute; opacity:0; width:1px; height:1px; }</style>
      <div data-field-path="q1"><label class="_heading_x _required_x" for="q1">Are you legally authorized to work in that country?</label>
        <div><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button><input type="checkbox" class="hid" tabindex="-1" name="q1"></div></div>
      <fieldset><label class="_heading_x _required_x" for="q2">What is your preferred programming language?</label>
        <div><span><input type="radio" id="r0" name="q2" style="opacity:0"></span><label for="r0">C++</label></div>
        <div><span><input type="radio" id="r1" name="q2" style="opacity:0"></span><label for="r1">Python</label></div></fieldset>`);
    const yn = f.find((x) => /authorized/.test(x.label));
    expect(yn).toMatchObject({ kind: "radio", options: ["Yes", "No"], required: true });
    expect(f.filter((x) => x.kind === "checkbox")).toHaveLength(0);
    const lang = f.find((x) => /programming language/.test(x.label));
    expect(lang).toMatchObject({ kind: "radio", options: ["C++", "Python"], required: true });
  });

  it("skips honeypot fields", async () => {
    const f = await read(`<label for="w">Enter website. This input is for robots only</label><input id="w" data-automation-id="beecatcher" name="website">
      <label for="e">Email</label><input id="e" type="email">`);
    expect(f.map((x) => x.label)).toEqual(["Email"]);
  });

  it("reports pre-filled values", async () => {
    const f = await read(`<label for="n">Full name</label><input id="n" value="Ada Lovelace"><label for="p">Phone</label><input id="p">`);
    expect(f.map((x) => x.filled)).toEqual([true, false]);
  });

  it("generic date parts get their section", async () => {
    const f = await read(`<h3>Education</h3><label for="s1">Start Date</label><select id="s1"><option>Month...</option><option>January</option></select>
      <label for="s2">Start Date</label><select id="s2"><option>Year...</option><option>2026</option></select>`);
    expect(f.map((x) => x.label)).toEqual(["Education — Start Date (month)", "Education — Start Date (year)"]);
  });
});
