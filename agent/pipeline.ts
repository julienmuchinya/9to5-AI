import { scoreJobFit } from "../src/lib/engines/job-fit";
import { scoreCompanyTrust } from "../src/lib/engines/company-trust";
import { runScamCheck } from "../src/lib/engines/scam-check";
import { makeDecision } from "../src/lib/engines/decision";
import { pickBestResume } from "../src/lib/engines/resume-selector";
import {
  pickBestCoverLetter,
  shouldReuseCoverLetter,
} from "../src/lib/engines/cover-letter-selector";
import { validateClaimsAgainstEvidence } from "../src/lib/engines/truth-filter";
import { getJdHash, findCacheHit } from "../src/lib/engines/ai-cache";
import {
  scanJobAlertEmails,
  getDefaultEmailFilterSettings,
} from "../src/lib/email/jobAlertScanner";
import { isGmailMockMode } from "../src/lib/email/gmailClient";
import { scanCompanies } from "../src/lib/company/companyScanner";
import { normalizeJob, type RawJobInput } from "../src/lib/jobs/jobNormalizer";
import { checkDuplicate, touchDuplicateJob } from "../src/lib/jobs/jobDeduplicator";
import { callGemini, isMockMode as isGeminiMock, usesRealGeminiApi } from "../src/lib/gemini/client";
import {
  evaluateSetupChecklist,
  isSetupComplete,
} from "../src/lib/setup-checklist";
import { isMockModeEnv } from "../src/lib/config/env";
import { evaluateLiveRunGuard } from "../src/lib/agent/liveRunGuard";
import { getStorageAdapter } from "../src/lib/storage/storageAdapter";
import { isSponsorshipQuestionUnanswered } from "../src/lib/engines/sponsorship-guard";
import {
  checkBudgetBeforeAction,
  shouldAllowGeminiCall,
} from "../src/lib/agent/budgetGuard";
import {
  createUsageCounters,
  applyUsageCounters,
  emptyUsageSnapshot,
} from "../src/lib/agent/usageTracker";
import {
  shouldDelayCompanyScan,
  shouldDelayEmailBatch,
  recordCompanyScan,
  recordEmailBatch,
  assertNoOutreachOrApply,
  type HumanLikeGuardState,
} from "../src/lib/agent/humanLikeActivityGuard";
import type { LocalStore } from "../src/lib/store/default-store";
import type { EvidenceItem, JobIntakeDecision, UsageLimits } from "../src/lib/types";
import { DEFAULT_USAGE_LIMITS } from "../src/lib/constants";

export interface PipelineResult {
  store: LocalStore;
  runId: string;
  summary: Record<string, unknown>;
}

export interface PipelineOptions {
  agentSecret?: string | null;
  scanEmail?: boolean;
  scanCompanies?: boolean;
}

function mapToIntakeDecision(
  decision: string
): JobIntakeDecision {
  if (decision === "AUTO_APPLY" || decision === "AUTO_APPLY_READY") return "AUTO_APPLY_READY";
  if (decision === "REVIEW" || decision === "REVIEW_ONLY") return "REVIEW_ONLY";
  if (decision === "BLOCKED" || decision === "EMERGENCY_STOP") return "BLOCKED";
  return "SKIP";
}

export async function runAgentPipeline(
  inputStore?: LocalStore,
  options?: PipelineOptions
): Promise<PipelineResult> {
  const adapter = getStorageAdapter();
  const store = inputStore
    ? structuredClone(inputStore)
    : structuredClone(await adapter.load());
  const settings = store.autopilot_settings;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const stepStarted: Record<string, number> = {};
  const logs: LocalStore["agent_logs"] = [];
  const usage = emptyUsageSnapshot();
  const mockMode = isMockModeEnv() || settings.mock_mode || isGeminiMock();

  const logStep = (
    step: string,
    level: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ) => {
    const durationMs = stepStarted[step] ? Date.now() - stepStarted[step] : undefined;
    logs.push({
      id: crypto.randomUUID(),
      run_id: runId,
      level,
      message,
      metadata: { step, durationMs, ...metadata },
      created_at: new Date().toISOString(),
    });
  };

  const beginStep = (step: string) => {
    stepStarted[step] = Date.now();
  };

  // Step 1: Start agent run
  beginStep("start");
  logStep("start", "info", "9to5 AI agent run started", {
    mock: mockMode,
    dry_run: settings.dry_run,
    gmail_mock: isGmailMockMode(),
  });

  const usageLimits: UsageLimits = {
    maxApplicationsPerDay: store.agent_usage_limits.maxApplicationsPerDay,
    maxOutreachPerDay: store.agent_usage_limits.maxOutreachPerDay,
    maxFollowupsPerDay: store.agent_usage_limits.maxFollowupsPerDay,
    maxJobsAnalyzedPerDay: store.agent_usage_limits.maxJobsAnalyzedPerDay,
    maxCompaniesScannedPerDay: store.agent_usage_limits.maxCompaniesScannedPerDay,
    maxAiCallsPerDay: store.agent_usage_limits.maxAiCallsPerDay,
    maxDbWritesPerDay: store.agent_usage_limits.maxDbWritesPerDay,
    maxDbReadsPerDay: store.agent_usage_limits.maxDbReadsPerDay,
    maxCostPerDay: store.agent_usage_limits.maxCostPerDay ?? DEFAULT_USAGE_LIMITS.maxCostPerDay,
  };

  let counters = createUsageCounters(store);
  let humanState: HumanLikeGuardState = { companyScanCount: 0, emailBatchCount: 0 };

  // Step 2: Emergency stop
  beginStep("emergency_stop");
  if (settings.emergency_stop) {
    logStep("emergency_stop", "warn", "Emergency stop enabled — all agent actions blocked");
    store.agent_runs.unshift({
      id: runId,
      status: "completed",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      summary: { emergency_stop: true, actions_blocked: true },
      mock_mode: mockMode,
    });
    store.agent_logs = [...logs, ...store.agent_logs];
    await adapter.save(store);
    return { store, runId, summary: { emergency_stop: true, actions_blocked: true } };
  }

  // Step 3: Live run guard + setup
  beginStep("live_guard");
  const liveGuard = evaluateLiveRunGuard({
    store,
    agentSecretHeader: options?.agentSecret ?? null,
  });
  if (!liveGuard.allowed && !mockMode) {
    logStep("live_guard", "warn", "Live agent blocked", {
      reasons: liveGuard.reasons.map((r) => r.code),
    });
    for (const r of liveGuard.reasons) {
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        reason_code: r.code,
        reason_detail: r.message,
        suggested_action: "Complete setup before live runs",
        resolved: false,
        created_at: new Date().toISOString(),
      });
    }
    store.agent_runs.unshift({
      id: runId,
      status: "completed",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      summary: { live_blocked: true, reasons: liveGuard.reasons, processed: 0 },
      mock_mode: mockMode,
    });
    store.agent_logs = [...logs, ...store.agent_logs];
    await adapter.save(store);
    return { store, runId, summary: { live_blocked: true, reasons: liveGuard.reasons } };
  }

  beginStep("setup");
  const checklist = evaluateSetupChecklist({
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    schemaInstalled: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    geminiOrMock: isGeminiMock() || Boolean(process.env.GEMINI_API_KEY),
    gmailConnected: isGmailMockMode() || Boolean(process.env.GMAIL_REFRESH_TOKEN),
    jobEmailSet: Boolean(store.profile.job_email),
    profileComplete: Boolean(store.profile.full_name),
    companyCount: store.companies.length,
    activeResumeCount: store.resume_templates.filter((t) => t.is_active).length,
    coverLetterCount: store.cover_letter_templates.length,
    evidenceCount: store.evidence_bank.filter((e) => e.approved).length,
    limitsConfigured: true,
    lastAgentRunOk: true,
    emergencyStopVisible: true,
  });
  const setupComplete = isSetupComplete(checklist, { mockMode });
  if (!setupComplete && !mockMode) {
    logStep("setup", "warn", "Setup checklist incomplete — live run stopped");
    store.agent_runs.unshift({
      id: runId,
      status: "completed",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      summary: { setup_incomplete: true, processed: 0 },
      mock_mode: mockMode,
    });
    store.agent_logs = [...logs, ...store.agent_logs];
    await adapter.save(store);
    return { store, runId, summary: { setup_incomplete: true } };
  }
  logStep("setup", "info", "Setup checklist evaluated", { setupComplete, mockMode });

  // Part 3: never submit applications or send outreach
  const noApply = assertNoOutreachOrApply();
  logStep("safety", "info", noApply.reason);

  const scanEmail = options?.scanEmail !== false && settings.email_scanning_enabled;
  const scanCo = options?.scanCompanies !== false && settings.company_scanning_enabled;

  const rawJobs: RawJobInput[] = [];

  // Step 4–5: Budget + Gmail scan
  if (scanEmail) {
    beginStep("gmail_scan");
    const emailBudget = checkBudgetBeforeAction(
      counters,
      usageLimits,
      "jobsAnalyzed",
      "email_scan"
    );
    if (!emailBudget.allowed) {
      logStep("gmail_scan", "warn", "Budget guard blocked email scan", { ...emailBudget });
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        reason_code: "BUDGET_LIMIT",
        reason_detail: "Email scan blocked by daily limits",
        suggested_action: "Wait until tomorrow or adjust limits",
        resolved: false,
        created_at: new Date().toISOString(),
      });
    } else {
      const emailDelay = shouldDelayEmailBatch(humanState);
      if (emailDelay.shouldDelay) {
        logStep("gmail_scan", "info", emailDelay.reason, { delayMs: emailDelay.delayMs });
        await new Promise((r) => setTimeout(r, emailDelay.delayMs));
      }
      humanState = recordEmailBatch(humanState);

      if (isGmailMockMode()) {
        logStep("gmail_scan", "info", "Gmail: mock mode — no Gmail API call");
      }

      const emailSettings = getDefaultEmailFilterSettings({
        allowedSenders: settings.allowed_job_alert_senders,
        blockedSenders: settings.blocked_job_alert_senders,
        allowedKeywords: settings.allowed_role_keywords,
        blockedKeywords: settings.blocked_keywords,
        scanUnreadOnly: settings.scan_unread_only,
        lookbackDays: settings.scan_email_lookback_days,
        maxEmailsPerRun: settings.max_job_alert_emails_per_run,
      });

      const emailResult = await scanJobAlertEmails({
        settings: emailSettings,
        markAsRead: settings.mark_processed_emails,
      });
      usage.emailsScanned = emailResult.scanned;
      usage.jobsFound += emailResult.alerts.length;
      logStep("gmail_scan", "info", `Scanned ${emailResult.scanned} job alert email(s)`, {
        source: emailResult.source,
        parsed: emailResult.alerts.length,
      });

      for (const a of emailResult.alerts) {
        rawJobs.push({
          title: a.title,
          companyName: a.companyName,
          url: a.url,
          location: a.location,
          remoteType: a.remoteType,
          source: a.source,
          description: a.description,
          shortDescription: a.shortDescription,
          dateFound: a.dateFound,
          rawEmailRef: a.rawEmailRef,
        });
      }
    }
  }

  // Step 6: Company career scan
  if (scanCo) {
    beginStep("company_scan");
    const coBudget = checkBudgetBeforeAction(
      counters,
      usageLimits,
      "companiesScanned",
      "company_scan"
    );
    if (!coBudget.allowed) {
      logStep("company_scan", "warn", "Budget guard blocked company scan", { ...coBudget });
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        reason_code: "BUDGET_LIMIT",
        reason_detail: "Company scan daily limit reached",
        suggested_action: "Wait until tomorrow",
        resolved: false,
        created_at: new Date().toISOString(),
      });
    } else {
      const coResult = await scanCompanies(store.companies, {
        maxCompaniesPerRun: settings.max_company_pages_per_run,
        delayMsBetweenScans: 500,
        onDelay: (name, ms) => {
          const d = shouldDelayCompanyScan(humanState, ms);
          if (d.shouldDelay) {
            logStep("company_scan", "info", d.reason, { company: name, delayMs: d.delayMs });
          }
          humanState = recordCompanyScan(humanState);
        },
      });
      usage.companiesScanned = coResult.companiesScanned;
      counters.companiesScanned += coResult.companiesScanned;
      usage.jobsFound += coResult.jobs.length;
      logStep("company_scan", "info", `Company scan complete`, {
        companies: coResult.companiesScanned,
        jobs: coResult.jobs.length,
      });

      for (const j of coResult.jobs) {
        rawJobs.push({
          title: j.title,
          companyName: j.companyName,
          url: j.url,
          location: j.location,
          source: j.source,
          description: j.description ?? "",
          department: j.department,
          dateFound: j.dateFound,
        });
      }

      for (const b of coResult.blockedReasons) {
        store.blocked_actions.unshift({
          id: crypto.randomUUID(),
          reason_code: b.reason,
          reason_detail: `Company scan blocked: ${b.company}`,
          suggested_action: "Review career URL or scan manually",
          resolved: false,
          created_at: new Date().toISOString(),
        });
        logStep("company_scan", "warn", "Company scan blocked", b);
      }
    }
  }

  // Steps 7–20: normalize, dedupe, analyze, save
  const evidence: EvidenceItem[] = store.evidence_bank
    .filter((e) => e.approved)
    .map((e) => ({
      category: e.category,
      title: e.title,
      content: e.content,
      skills: e.skills,
      tools: e.tools,
      proof: e.proof,
      approved: e.approved,
    }));

  const userSkills = store.profile.skills ?? [];
  const profile = store.profile as { sponsorship_needed?: boolean };
  const bestAnswers: { question_pattern: string; answer: string }[] = [];

  let processed = 0;
  let skipped = 0;
  let review = 0;
  let blocked = 0;
  let duplicates = 0;
  let autoApplyReady = 0;

  beginStep("job_processing");
  for (const raw of rawJobs) {
    const analyzeBudget = checkBudgetBeforeAction(
      counters,
      usageLimits,
      "jobsAnalyzed",
      "job_analyze"
    );
    if (!analyzeBudget.allowed) {
      logStep("job_processing", "warn", "Daily job analysis limit reached — stopping");
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        reason_code: "BUDGET_LIMIT",
        reason_detail: "Max jobs analyzed per day reached",
        suggested_action: "Wait until tomorrow",
        resolved: false,
        created_at: new Date().toISOString(),
      });
      break;
    }
    counters.jobsAnalyzed++;

    // Step 7: Normalize
    const normalized = normalizeJob(raw);

    // Step 8: Deduplicate
    const existingRecords = store.jobs.map((j) => ({
      id: j.id,
      idempotency_key: j.idempotency_key,
      url: j.url,
      company_name: j.company_name,
      title: j.title,
      description_hash: j.description_hash,
      last_seen_at: j.last_seen_at,
    }));
    const dedupe = checkDuplicate(normalized, existingRecords);
    if (dedupe.isDuplicate && dedupe.existingJobId) {
      store.jobs = touchDuplicateJob(store.jobs, dedupe.existingJobId);
      duplicates++;
      usage.duplicatesSkipped++;
      logStep("job_processing", "info", `Duplicate job skipped: ${normalized.normalizedTitle}`, {
        matchType: dedupe.matchType,
        idempotencyKey: dedupe.idempotencyKey,
      });
      skipped++;
      continue;
    }

    const existingApp = store.applications.find((a) => {
      const j = store.jobs.find((job) => job.id === a.job_id);
      return j?.idempotency_key === dedupe.idempotencyKey;
    });
    if (existingApp) {
      duplicates++;
      usage.duplicatesSkipped++;
      logStep("job_processing", "info", "Duplicate application risk — skipped", {
        title: normalized.normalizedTitle,
      });
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        reason_code: "DUPLICATE_APPLICATION",
        reason_detail: `Already have application for ${normalized.normalizedTitle}`,
        suggested_action: "Review existing application",
        resolved: false,
        created_at: new Date().toISOString(),
      });
      skipped++;
      continue;
    }

    logStep("job_processing", "info", `Analyzing: ${normalized.normalizedTitle} at ${normalized.normalizedCompany}`);

    // Step 10–16: Engines
    const jdHash = getJdHash(normalized.description);
    const cacheHit = findCacheHit(
      normalized.description,
      store.ai_cache.map((c) => ({
        jdHash: c.jd_hash,
        output: c.output,
        fitScore: c.fit_score,
        createdAt: "",
      }))
    );

    let fitScore: number;
    if (cacheHit?.fitScore != null) {
      fitScore = cacheHit.fitScore;
      usage.cacheHits++;
      logStep("job_processing", "info", "Fit score from AI cache", { fitScore, cache: true });
    } else {
      const fit = scoreJobFit(
        normalized.description,
        userSkills,
        evidence.flatMap((e) => e.skills ?? [])
      );
      fitScore = fit.score;
      logStep("job_processing", "info", "Fit score computed (rules engine)", {
        fitScore,
        breakdown: fit.breakdown as unknown as Record<string, unknown>,
      });
    }

    const trust = scoreCompanyTrust(
      normalized.normalizedCompany,
      normalized.normalizedCompany.toLowerCase().replace(/\s/g, "") + ".com",
      undefined,
      normalized.normalizedUrl
    );
    const scam = runScamCheck(normalized.description, normalized.normalizedUrl);
    const resumeMatch = pickBestResume(
      normalized.description,
      store.resume_templates.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        content: t.content,
        skills: t.skills,
        is_active: t.is_active,
      }))
    );
    const coverMatch = pickBestCoverLetter(
      normalized.description,
      store.cover_letter_templates,
      normalized.normalizedTitle
    );
    const resumeContent = resumeMatch
      ? store.resume_templates.find((t) => t.id === resumeMatch.templateId)?.content ?? ""
      : "";
    const truth = validateClaimsAgainstEvidence(resumeContent, evidence);
    const sponsorshipUnanswered = isSponsorshipQuestionUnanswered(
      normalized.description,
      profile.sponsorship_needed,
      bestAnswers
    );

    const geminiGate = shouldAllowGeminiCall(
      counters,
      usageLimits,
      mockMode,
      settings.use_gemini && settings.gemini_enabled,
      Boolean(process.env.GEMINI_API_KEY)
    );

    if (!cacheHit && geminiGate.allowed && !settings.dry_run) {
      counters.aiCalls++;
      usage.aiCallsUsed++;
      try {
        logStep("job_processing", "info", "Calling Gemini API");
        const aiOut = await callGemini(
          `Analyze job fit for intern role. Title: ${normalized.normalizedTitle}. JD: ${normalized.description.slice(0, 500)}`
        );
        store.ai_cache.unshift({
          id: crypto.randomUUID(),
          jd_hash: jdHash,
          fit_score: fitScore,
          output: { raw: aiOut.slice(0, 2000) },
        });
        logStep("job_processing", "info", "Gemini response cached");
      } catch (e) {
        logStep("job_processing", "error", `Gemini failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    } else if (!cacheHit) {
      logStep("job_processing", "info", geminiGate.reason, {
        mock: mockMode,
        cache: Boolean(cacheHit),
      });
    }

    const decision = makeDecision({
      fitScore,
      trustScore: trust.score,
      scamPassed: scam.passed,
      resumeMatchScore: resumeMatch?.score ?? 0,
      coverLetterMatchScore: coverMatch?.score ?? 0,
      emergencyStop: false,
      autoApplyEnabled: false,
      setupComplete,
      duplicateJob: false,
      duplicateApplication: false,
      truthFilterPassed: truth.passed,
      costRisk: false,
      captchaDetected: false,
      requiresLying: false,
      sponsorshipQuestionUnanswered: sponsorshipUnanswered,
    });

    const intakeDecision = mapToIntakeDecision(decision.decision);
    logStep("job_processing", "info", `Decision: ${intakeDecision}`, {
      reasonCode: decision.reasonCode,
      reason: decision.reason,
    });

    const jobId = crypto.randomUUID();
    store.jobs.unshift({
      id: jobId,
      title: normalized.normalizedTitle,
      company_name: normalized.normalizedCompany,
      description: normalized.description,
      url: normalized.url,
      location: normalized.normalizedLocation,
      remote_type: normalized.remoteType,
      status: intakeDecision === "SKIP" ? "skipped" : "analyzed",
      fit_score: fitScore,
      trust_score: trust.score,
      source: normalized.normalizedSource,
      idempotency_key: dedupe.idempotencyKey,
      decision: intakeDecision,
      scam_passed: scam.passed,
      scam_score: scam.score,
      resume_template: resumeMatch?.templateName,
      cover_letter_template: coverMatch?.templateName,
      decision_reason: decision.reason,
      decision_reason_code: decision.reasonCode,
      duplicate_status: "new",
      description_hash: normalized.descriptionHash,
      date_found: normalized.dateFound,
      last_seen_at: new Date().toISOString(),
      raw_email_ref: normalized.rawEmailRef,
      department: normalized.department,
    });

    usage.jobsSaved++;
    counters.dbWrites++;

    if (intakeDecision === "BLOCKED") {
      blocked++;
      store.blocked_actions.unshift({
        id: crypto.randomUUID(),
        job_id: jobId,
        reason_code: decision.reasonCode,
        reason_detail: decision.reason,
        suggested_action: "Review job manually in dashboard",
        resolved: false,
        created_at: new Date().toISOString(),
      });
    } else if (intakeDecision === "SKIP") {
      skipped++;
    } else if (intakeDecision === "REVIEW_ONLY") {
      review++;
    } else if (intakeDecision === "AUTO_APPLY_READY") {
      autoApplyReady++;
      review++;
      logStep("job_processing", "info", "Job marked AUTO_APPLY_READY — not submitted (Part 3)", {
        jobId,
      });
    }

    processed++;
  }

  applyUsageCounters(store, counters, usage);

  const summary = {
    processed,
    skipped,
    review,
    blocked,
    duplicates,
    auto_apply_ready: autoApplyReady,
    mock: mockMode,
    setup_complete: setupComplete,
    applications_submitted: 0,
    outreach_sent: 0,
    emails_scanned: usage.emailsScanned,
    companies_scanned: usage.companiesScanned,
    jobs_found: usage.jobsFound,
    jobs_saved: usage.jobsSaved,
    cache_hits: usage.cacheHits,
    ai_calls: usage.aiCallsUsed,
    gemini_api_used: usage.aiCallsUsed > 0 && !mockMode,
    gmail_api_used: !isGmailMockMode() && usage.emailsScanned > 0,
  };

  beginStep("complete");
  logStep("complete", "info", "9to5 AI agent run completed", summary);

  store.agent_runs.unshift({
    id: runId,
    status: "completed",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    summary,
    mock_mode: mockMode,
  });
  store.agent_logs = [...logs, ...store.agent_logs];

  await adapter.save(store);
  return { store, runId, summary };
}
