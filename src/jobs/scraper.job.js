// src/jobs/scraper.job.js
// ─────────────────────────────────────────────────────────────────────────────
// Cron Job Scheduler — Phase 1 trigger
//
// Registers one weekly job that fires every Saturday at 06:00 UTC.
// Cron expression: "0 6 * * 6"
//   0 = minute 0
//   6 = hour 6 (6 AM)
//   * = any day of month
//   * = any month
//   6 = Saturday (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
//
// Called from src/index.js inside server.listen() callback:
//   const { startScrapingJobs } = require("./jobs/scraper.job");
//   server.listen(PORT, () => { startScrapingJobs(); });
// ─────────────────────────────────────────────────────────────────────────────

const cron = require("node-cron");
const { runScrapingSession } = require("../services/scraper.service");

function startScrapingJobs() {
  cron.schedule(
    "0 6 * * 6",     // Every Saturday at 06:00
    async () => {
      console.log(`\n[Cron] ⏰ Weekly scraping triggered at ${new Date().toISOString()}`);

      await runScrapingSession().catch((err) => {
        // Log but don't crash the server — next Saturday it fires again
        console.error(`[Cron] ❌ Session failed: ${err.message}`);
      });
    },
    {
      scheduled: true,
      timezone:  "UTC",
    }
  );

  console.log("[Cron] ✅ Weekly scraping scheduled: Every Saturday at 06:00 UTC");
  console.log(`[Cron]    Next run: ${getNextSaturdayUTC()}`);
}

function getNextSaturdayUTC() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const diff = (6 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + diff);
  next.setUTCHours(6, 0, 0, 0);
  return next.toUTCString();
}

module.exports = { startScrapingJobs };
