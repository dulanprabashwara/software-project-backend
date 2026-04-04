// src/services/email.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Email Service — Phase 3b
//
// Sends two types of emails after every scraping session:
//   1. sendErrorAlert()             — only if critical errors detected (success rate < 70%)
//   2. sendCompletionNotification() — always sent at session end
//
// Recipients: ALL users with role = "ADMIN" in the User table.
//
// Email provider: nodemailer + SMTP (Gmail or any SMTP service).
//
// SETUP — add to your .env:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=your_gmail@gmail.com
//   SMTP_PASS=your_app_password        ← Gmail: Account → Security → App Passwords
//   SMTP_FROM=noreply@easyblogger.com
//
// For Gmail App Password:
//   1. Enable 2FA on your Google account
//   2. Google Account → Security → "App passwords"
//   3. Generate password for "Mail" / "Other device"
//   4. Use that 16-character password as SMTP_PASS
// ─────────────────────────────────────────────────────────────────────────────

const nodemailer = require("nodemailer");
const prisma     = require("../config/prisma");

// ── createTransporter ─────────────────────────────────────────────────────────
// Builds the nodemailer SMTP transporter from .env config.

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // false = STARTTLS (port 587). Set true only for port 465.
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // allow self-signed certs in development
    },
  });
}

// ── getAdminEmails ─────────────────────────────────────────────────────────────
// Queries the User table for all users with role = "ADMIN".
// Returns array of email strings: ["admin1@x.com", "admin2@x.com"].

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

// ── buildCompletionEmailHtml ───────────────────────────────────────────────────
// Generates the full HTML report email body.

function buildCompletionEmailHtml(report) {
  const statusColor = report.criticalErrors ? "#e74c3c" : "#1abc9c";
  const statusLabel = report.criticalErrors
    ? "⚠️ Completed with Critical Errors"
    : "✅ Completed Successfully";

  const duration = report.durationMinutes != null
    ? `${report.durationMinutes.toFixed(1)} minutes`
    : "N/A";

  // Per-category breakdown rows
  const categoryRows = (report.keywordStats || []).map((s) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 12px;">${s.category}</td>
      <td style="padding:8px 12px;text-align:center;">${s.urlsProcessed}</td>
      <td style="padding:8px 12px;text-align:center;color:#1abc9c;">${s.successCount}</td>
      <td style="padding:8px 12px;text-align:center;color:#e67e22;">${s.duplicateCount}</td>
      <td style="padding:8px 12px;text-align:center;color:#e74c3c;">${s.failureCount}</td>
    </tr>
  `).join("");

  // Top 10 keywords with most articles
  const topKeywords = (report.keywordsWithContent || []).slice(0, 10);
  const topKeywordRows = topKeywords.map((k) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:6px 12px;">${k.keyword}</td>
      <td style="padding:6px 12px;text-align:center;color:#1abc9c;font-weight:bold;">${k.articleCount}</td>
    </tr>
  `).join("");

  // Keywords with no content this session (first 20)
  const emptyKeywords = (report.keywordsWithoutContent || []).slice(0, 20);
  const emptySection  = emptyKeywords.length > 0
    ? `<p style="margin-top:8px;font-size:13px;color:#999;">
        Keywords with no reference content this session (showing first 20 of ${report.totalKeywordsEmpty}):
        <br><em>${emptyKeywords.join(", ")}</em>
       </p>`
    : "";

  // Token usage
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
    <h1 style="margin:0;font-size:20px;">🤖 Easy Blogger — Weekly Content Scraping Report</h1>
    <p style="margin:6px 0 0;opacity:0.9;">${statusLabel}</p>
  </div>

  <div style="background:#f9f9f9;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">

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

// ── buildErrorAlertHtml ────────────────────────────────────────────────────────
// Simpler urgent alert for critical error situations.

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

// ── sendCompletionNotification ─────────────────────────────────────────────────
// Sends the full session report to all admin email addresses.
// Called at the end of every session regardless of outcome.

async function sendCompletionNotification(report) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails.length) return;

  const transporter = createTransporter();
  const subject = report.criticalErrors
    ? `⚠️ [Easy Blogger] Weekly Scraping — Issues (${report.successRate}% success)`
    : `✅ [Easy Blogger] Weekly Scraping Done — ${report.successCount} articles saved`;

  await transporter.sendMail({
    from:    `"Easy Blogger System" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to:      adminEmails.join(", "),
    subject,
    html:    buildCompletionEmailHtml(report),
  });

  console.log(`[Email] Report sent to: ${adminEmails.join(", ")}`);
}

// ── sendErrorAlert ─────────────────────────────────────────────────────────────
// Sends an urgent alert ONLY when critical errors are detected.
// Sent BEFORE the full completion notification.

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

module.exports = {
  sendCompletionNotification,
  sendErrorAlert,
};
