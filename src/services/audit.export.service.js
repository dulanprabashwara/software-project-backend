const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const prisma = new PrismaClient();

//transporter using the existing system keys
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }
});

//Core Pipeline logic
const runWeeklyAuditExport = async () => {
  try {
    console.log("[Audit Export] Starting weekly CSV generation...");

    //Find all admins who opted in to receive the export
    const subscribedAdmins = await prisma.user.findMany({
      where: { 
        role: "ADMIN",
        receiveWeeklyExport: true 
      },
      select: { email: true }
    });

    if (subscribedAdmins.length === 0) {
      console.log("[Audit Export] No admins subscribed. Skipping.");
      return;
    }

    //Calculate date range (Last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    //Fetch the logs
    const logs = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      include: {
        admin: { select: { displayName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    //Generate the CSV file in memory
    const csvHeaders = ['Date', 'Admin', 'Action', 'Target Type', 'Target ID', 'IP Address', 'Details'];
    
    const csvRows = logs.map(log => {
      const adminName = log.admin?.displayName || log.admin?.username || 'System';
      // Escape quotes and wrap fields in quotes to prevent internal commas from breaking the CSV layout
      const cleanDetails = log.details ? `"${log.details.replace(/"/g, '""')}"` : '""';
      
      return [
        `"${log.createdAt.toISOString()}"`,
        `"${adminName}"`,
        `"${log.action}"`,
        `"${log.targetType || ''}"`,
        `"${log.targetId || ''}"`,
        `"${log.ipAddress || ''}"`,
        cleanDetails
      ].join(',');
    });

    const csvString = [csvHeaders.join(','), ...csvRows].join('\n');
    const buffer = Buffer.from(csvString, 'utf-8');

    //Dispatch the Email with the Attachment
    const adminEmails = subscribedAdmins.map(a => a.email).join(', ');
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    await transporter.sendMail({
      from: `"EasyBlogger Security" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: adminEmails,
      subject: `🛡️ Weekly Audit Log Export (${formattedStartDate} to ${formattedEndDate})`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Weekly Administrative Audit Log</h2>
          <p>Attached is the automated export of all system actions for the past 7 days.</p>
          <p><strong>Total Actions Recorded:</strong> ${logs.length}</p>
          <p style="font-size: 12px; color: #666; margin-top: 20px;">
            You are receiving this because you have 'Weekly Export' enabled in your profile governance settings.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `audit_logs_${formattedEndDate}.csv`,
          content: buffer
        }
      ]
    });

    console.log(`[Audit Export] Successfully emailed CSV to ${subscribedAdmins.length} admins.`);

  } catch (error) {
    console.error("[Audit Export] Pipeline failed:", error);
  }
};

//The Scheduler (Runs every Friday at 11:59 PM Sri Lanka Time)
const initAuditCronJob = () => {
  // '59 23 * * 5' means 23:59 (11:59 PM) on day 5 (Friday)
  cron.schedule('59 23 * * 5', runWeeklyAuditExport, {
    timezone: "Asia/Colombo"
  });
  console.log("[Audit Export] Cron job scheduled for Fridays at 11:59 PM (IST).");
};

module.exports = { initAuditCronJob, runWeeklyAuditExport };