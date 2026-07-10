//@ts-nocheck
// src/services/email.service.js
// Phase 3b — Sends session completion and critical error emails to all admin users.

const nodemailer = require("nodemailer");
const prisma     = require("../config/prisma");

// ── CONSTANTS ───────────────────────────────────────────────────────────────

// Email configuration
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_HOST = "smtp.gmail.com";

// Email content limits
const TOP_KEYWORDS_LIMIT = 10;
const EMPTY_KEYWORDS_LIMIT = 20;

// Creates the nodemailer SMTP transporter from environment config.
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || DEFAULT_SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || DEFAULT_SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });
}

// Fetches all admin users from the database and returns their email addresses.
async function getAdminEmails() {
  const admins = await prisma.user.findMany({
    where:  { role: "ADMIN" },
    select: { email: true },
  });

  const emails = admins.map((a) => a.email).filter(Boolean);

  if (!emails.length) {
    console.warn("[Email] No admin users found in User table. Report not sent.");
  }

  return emails;
}

// Builds the full HTML body for the session completion report email.
function buildCompletionEmailHtml(report) {
  const isInterrupted      = report.isInterrupted      || false;
  const isManualEnrichment = report.isManualEnrichment || false;
  const isCrashed          = report.isCrashed          || false;

  const statusColor = (report.criticalErrors || isInterrupted || isCrashed) ? "#e74c3c" : "#1abc9c";

  let statusLabel;
  if (isCrashed)                   statusLabel = "💥 Session Crashed — Needs Attention";
  else if (isInterrupted)          statusLabel = "🛑 Session Interrupted — Partial Report";
  else if (report.criticalErrors)  statusLabel = "⚠️ Completed with Critical Errors";
  else                             statusLabel = "✅ Completed Successfully";

  const interruptedBanner = isInterrupted
    ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:16px;margin-bottom:20px;">
        <strong style="color:#856404;">⚠️ This session was interrupted before completion.</strong><br>
        <span style="color:#856404;font-size:13px;">
          The backend process was killed (terminal closed, server restarted, or nodemon reload)
          mid-scrape. Stats below reflect only the work completed before shutdown.
          Run a manual scrape or wait until next Saturday to complete the remaining sources.
        </span>
       </div>`
    : "";

  const crashedBanner = isCrashed
    ? `<div style="background:#fde8e8;border:1px solid #e74c3c;border-radius:6px;padding:16px;margin-bottom:20px;">
        <strong style="color:#c0392b;">💥 The scraping session crashed due to an unhandled error.</strong><br>
        <span style="color:#c0392b;font-size:13px;">
          Error: <code>${report.crashReason || "Unknown error"}</code><br>
          Stats below reflect only what was completed before the crash.
          Check the server logs for the full stack trace.
          Run a manual scrape or wait until next Saturday to re-run.
        </span>
       </div>`
    : "";

  const duration = report.durationMinutes != null
    ? `${report.durationMinutes.toFixed(1)} minutes`
    : "N/A";

  // Per-category breakdown rows
  const categoryRows = (report.categoryStats || []).map((s) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 12px;">${s.category}</td>
      <td style="padding:8px 12px;text-align:center;">${s.urlsProcessed}</td>
      <td style="padding:8px 12px;text-align:center;color:#1abc9c;">${s.successCount}</td>
      <td style="padding:8px 12px;text-align:center;color:#e67e22;">${s.duplicateCount}</td>
      <td style="padding:8px 12px;text-align:center;color:#e74c3c;">${s.failureCount}</td>
    </tr>
  `).join("");

  const topKeywords    = (report.keywordsWithContent || []).slice(0, TOP_KEYWORDS_LIMIT);
  const topKeywordRows = topKeywords.map((k) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:6px 12px;">${k.keyword}</td>
      <td style="padding:6px 12px;text-align:center;color:#1abc9c;font-weight:bold;">${k.articleCount}</td>
    </tr>
  `).join("");

  const emptyKeywords = (report.keywordsWithoutContent || []).slice(0, EMPTY_KEYWORDS_LIMIT);
  const emptySection  = emptyKeywords.length > 0
    ? `<p style="margin-top:8px;font-size:13px;color:#999;">
        Keywords with no reference content this session (showing first ${EMPTY_KEYWORDS_LIMIT} of ${report.totalKeywordsEmpty}):
        <br><em>${emptyKeywords.join(", ")}</em>
       </p>`
    : "";

  const tokenSection = report.aiTokenUsage
    ? `<tr><td style="padding:10px 16px;font-weight:bold;">AI Tokens Used</td>
         <td style="padding:10px 16px;">
           Input: ${report.aiTokenUsage.inputTokens.toLocaleString()} |
           Output: ${report.aiTokenUsage.outputTokens.toLocaleString()}
           ${report.aiTokenUsage.estimatedCostUSD > 0
             ? ` | Est. cost: $${report.aiTokenUsage.estimatedCostUSD}`
             : " (free models — no cost)"}
         </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:720px;margin:0 auto;padding:24px;">

  <div style="background:${statusColor};color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:20px;">Easy Blogger — ${
      isManualEnrichment ? "Manual Enrichment Report" :
      isCrashed          ? "Scraping Session Crashed" :
      isInterrupted      ? "Scraping Interrupted — Partial Report" :
                           "Weekly Content Scraping Report"
    }</h1>
    <p style="margin:6px 0 0;opacity:0.9;">${statusLabel}</p>
  </div>

  <div style="background:#f9f9f9;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">

    ${interruptedBanner}
    ${crashedBanner}

    <h2 style="margin-top:0;">Session Overview</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;">
      <tr><td style="padding:10px 16px;font-weight:bold;width:40%;">Session ID</td>
          <td style="padding:10px 16px;font-size:12px;color:#666;">${report.sessionId}</td></tr>
      <tr style="background:#f5f5f5;">
          <td style="padding:10px 16px;font-weight:bold;">Started At</td>
          <td style="padding:10px 16px;">${new Date(report.startedAt).toLocaleString()}</td></tr>
      <tr><td style="padding:10px 16px;font-weight:bold;">Duration</td>
          <td style="padding:10px 16px;">${duration}</td></tr>
      <tr style="background:#f5f5f5;">
          <td style="padding:10px 16px;font-weight:bold;">Sources Processed</td>
          <td style="padding:10px 16px;">${report.totalSources}</td></tr>
      <tr><td style="padding:10px 16px;font-weight:bold;">Article Links Found</td>
          <td style="padding:10px 16px;">${report.totalUrlsFound}</td></tr>
      <tr style="background:#f5f5f5;">
          <td style="padding:10px 16px;font-weight:bold;color:#1abc9c;">Articles Saved</td>
          <td style="padding:10px 16px;color:#1abc9c;font-weight:bold;">${report.successCount}</td></tr>
      <tr><td style="padding:10px 16px;font-weight:bold;color:#e67e22;">Duplicates Skipped</td>
          <td style="padding:10px 16px;color:#e67e22;">${report.duplicateCount}</td></tr>
      <tr style="background:#f5f5f5;">
          <td style="padding:10px 16px;font-weight:bold;color:#e74c3c;">Failures</td>
          <td style="padding:10px 16px;color:#e74c3c;">${report.failureCount}</td></tr>
      <tr><td style="padding:10px 16px;font-weight:bold;">Success Rate</td>
          <td style="padding:10px 16px;">
            <strong style="color:${statusColor};">${report.successRate != null ? report.successRate + "%" : "N/A"}</strong>
          </td></tr>
      <tr style="background:#f5f5f5;">
          <td style="padding:10px 16px;font-weight:bold;">Articles Enriched (AI)</td>
          <td style="padding:10px 16px;">${report.enrichedCount} enriched | ${report.enrichmentFailed || 0} failed</td></tr>
      <tr><td style="padding:10px 16px;font-weight:bold;">Keywords Coverage</td>
          <td style="padding:10px 16px;">
            <span style="color:#1abc9c;">${report.totalKeywordsCovered} keywords</span> have reference content |
            <span style="color:#e74c3c;">${report.totalKeywordsEmpty} keywords</span> have none
          </td></tr>
      ${tokenSection}
    </table>

    ${categoryRows ? `
    <h2 style="margin-top:28px;">Per-Category Breakdown</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;">
      <thead>
        <tr style="background:#2d3748;color:#fff;">
          <th style="padding:10px 12px;text-align:left;">Category</th>
          <th style="padding:10px 12px;">URLs</th>
          <th style="padding:10px 12px;">Saved</th>
          <th style="padding:10px 12px;">Dupes</th>
          <th style="padding:10px 12px;">Failed</th>
        </tr>
      </thead>
      <tbody>${categoryRows}</tbody>
    </table>` : ""}

    ${topKeywordRows ? `
    <h2 style="margin-top:28px;">Top Keywords by Article Count</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;max-width:400px;">
      <thead>
        <tr style="background:#2d3748;color:#fff;">
          <th style="padding:8px 12px;text-align:left;">Keyword</th>
          <th style="padding:8px 12px;">Articles</th>
        </tr>
      </thead>
      <tbody>${topKeywordRows}</tbody>
    </table>` : ""}

    ${emptySection}

    <p style="margin-top:28px;font-size:13px;color:#999;border-top:1px solid #eee;padding-top:16px;">
      This is an automated report from Easy Blogger's weekly content scraping system.<br>
      Next scraping run: every Saturday at 06:00 UTC.
    </p>
  </div>
</body>
</html>`;
}

// Builds the HTML body for the urgent critical-error alert email.
function buildErrorAlertHtml(report, criticalIssues) {
  const issuesList = criticalIssues.map((i) => `<li style="margin-bottom:8px;">${i}</li>`).join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#e74c3c;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:20px;">⚠️ Scraping Issues Detected</h1>
    <p style="margin:4px 0 0;opacity:0.9;">Easy Blogger — Weekly Scraping Alert</p>
  </div>
  <div style="background:#fff5f5;padding:24px;border:1px solid #f5c6cb;border-top:none;border-radius:0 0 8px 8px;">
    <p>The weekly scraping session (ID: <strong>${report.sessionId}</strong>) completed with critical issues:</p>
    <ul style="background:#fff;padding:16px 16px 16px 32px;border-radius:6px;border:1px solid #f5c6cb;">
      ${issuesList}
    </ul>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td style="padding:6px 0;font-weight:bold;width:40%;">Success Rate:</td>
          <td style="padding:6px 0;color:#e74c3c;">${report.successRate}%</td></tr>
      <tr><td style="padding:6px 0;font-weight:bold;">Articles Saved:</td>
          <td style="padding:6px 0;">${report.successCount}</td></tr>
      <tr><td style="padding:6px 0;font-weight:bold;">Failures:</td>
          <td style="padding:6px 0;color:#e74c3c;">${report.failureCount}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:13px;color:#999;">
      Please check the scraping logs at <strong>GET /api/scraper/sessions</strong> for full details.
    </p>
  </div>
</body>
</html>`;
}

// Sends the full session report to all admin email addresses.
async function sendCompletionNotification(report) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails.length) return;

  const transporter = createTransporter();

  let subject;
  if (report.isCrashed)            subject = `💥 [Easy Blogger] Scraping Session Crashed — Action Required`;
  else if (report.isInterrupted)   subject = `🛑 [Easy Blogger] Scraping Interrupted — ${report.successCount} articles saved before shutdown`;
  else if (report.isManualEnrichment) subject = `📝 [Easy Blogger] Manual Enrichment — ${report.enrichedCount} articles enriched`;
  else if (report.criticalErrors)  subject = `⚠️ [Easy Blogger] Weekly Scraping — Issues (${report.successRate}% success)`;
  else                             subject = `✅ [Easy Blogger] Weekly Scraping Done — ${report.successCount} articles saved`;

  await transporter.sendMail({
    from:    `"Easy Blogger System" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to:      adminEmails.join(", "),
    subject,
    html:    buildCompletionEmailHtml(report),
  });

  console.log(`[Email] Report sent to: ${adminEmails.join(", ")}`);
}

// Sends a short urgent alert email when critical errors are detected (sent before the full report).
async function sendErrorAlert(report, criticalIssues) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails.length) return;

  const transporter = createTransporter();

  await transporter.sendMail({
    from:    `"Easy Blogger System" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to:      adminEmails.join(", "),
    subject: `🚨 [Easy Blogger] Scraping Critical Issues — Action Required`,
    html:    buildErrorAlertHtml(report, criticalIssues),
  });

  console.log(`[Email] Critical alert sent to: ${adminEmails.join(", ")}`);
}

module.exports = { sendCompletionNotification, sendErrorAlert, getAdminEmails };