// tests/scraptests/email.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for email.service.js
//
// What is tested:
//   1. getAdminEmails — correctly fetches admin user emails from DB
//   2. HTML report building — report contains correct data fields
//   3. sendCompletionNotification — calls sendMail with right subject and recipients
//   4. sendErrorAlert — fires only on critical errors, correct subject
//   5. Edge cases — no admins in DB, empty keyword arrays, zero token usage
//
// What is NOT tested (intentionally):
//   Real email delivery — we never send real emails in tests.
//   nodemailer's createTransport is mocked so no SMTP connection is made.
//
// Mocking strategy:
//   - prisma is mocked to return fake admin users
//   - nodemailer is mocked to capture what sendMail was called with
//   - No real network connections are made
// ─────────────────────────────────────────────────────────────────────────────
jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));
 
// ── FIX: variable name starts with "mock" so Jest hoisting allows it ─────────
const mockSendMail = jest.fn().mockResolvedValue({ messageId: "test-message-id" });
 
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,   // ← now valid: mockSendMail starts with "mock"
  })),
}));
// ─────────────────────────────────────────────────────────────────────────────
 
const nodemailer = require("nodemailer");
const prisma     = require("../../src/config/prisma");
 
const {
  sendCompletionNotification,
  sendErrorAlert,
} = require("../../src/services/email.service");
 
// ── Sample report builder ─────────────────────────────────────────────────
 
function makeSampleReport(overrides = {}) {
  return {
    sessionId:            "sess-test-123",
    startedAt:            new Date("2025-04-05T06:00:00Z").toISOString(),
    completedAt:          new Date("2025-04-05T06:45:00Z").toISOString(),
    durationMinutes:      45.2,
    totalSources:         8,
    totalUrlsFound:       42,
    successCount:         38,
    duplicateCount:       4,
    failureCount:         0,
    successRate:          100,
    enrichedCount:        35,
    enrichmentFailed:     3,
    totalKeywordsCovered: 47,
    totalKeywordsEmpty:   353,
    keywordsWithContent:  [
      { keyword: "Artificial intelligence", articleCount: 5 },
      { keyword: "Machine learning",        articleCount: 3 },
    ],
    keywordsWithoutContent: ["Beekeeping", "Oral history and traditions"],
    aiTokenUsage: {
      inputTokens:      12500,
      outputTokens:     3200,
      estimatedCostUSD: 0,
    },
    criticalErrors: false,
    ...overrides,
  };
}
 
// ════════════════════════════════════════════════════════════════════════════
// getAdminEmails — tested indirectly through sendCompletionNotification
// ════════════════════════════════════════════════════════════════════════════
 
describe("getAdminEmails — via sendCompletionNotification", () => {
 
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: "test-id" });
  });
 
  test("queries User table for role=ADMIN", async () => {
    prisma.user.findMany.mockResolvedValue([{ email: "admin@easyblogger.com" }]);
    await sendCompletionNotification(makeSampleReport());
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where:  { role: "ADMIN" },
      select: { email: true },
    });
  });
 
  test("sends email to all admin addresses", async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: "admin1@easyblogger.com" },
      { email: "admin2@easyblogger.com" },
    ]);
    await sendCompletionNotification(makeSampleReport());
    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.to).toContain("admin1@easyblogger.com");
    expect(callArgs.to).toContain("admin2@easyblogger.com");
  });
 
  test("does NOT send email when no admin users exist in DB", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await sendCompletionNotification(makeSampleReport());
    expect(mockSendMail).not.toHaveBeenCalled();
  });
 
  test("filters out null/undefined emails from admin list", async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: "real@easyblogger.com" },
      { email: null },
      { email: undefined },
    ]);
    await sendCompletionNotification(makeSampleReport());
    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.to).toBe("real@easyblogger.com");
    expect(callArgs.to).not.toContain("null");
  });
 
});
 
// ════════════════════════════════════════════════════════════════════════════
// sendCompletionNotification
// ════════════════════════════════════════════════════════════════════════════
 
describe("sendCompletionNotification", () => {
 
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: "test-id" });
    prisma.user.findMany.mockResolvedValue([{ email: "admin@easyblogger.com" }]);
  });
 
  test("sends exactly one email per call", async () => {
    await sendCompletionNotification(makeSampleReport());
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
 
  test("subject contains success indicator for healthy session", async () => {
    await sendCompletionNotification(makeSampleReport({ criticalErrors: false, successCount: 38 }));
    const subject = mockSendMail.mock.calls[0][0].subject;
    expect(subject).toContain("✅");
    expect(subject).toContain("38");
  });
 
  test("subject contains warning indicator when critical errors exist", async () => {
    await sendCompletionNotification(makeSampleReport({ criticalErrors: true, successRate: 45 }));
    const subject = mockSendMail.mock.calls[0][0].subject;
    expect(subject).toContain("⚠️");
  });
 
  test("HTML body contains the session ID", async () => {
    await sendCompletionNotification(makeSampleReport({ sessionId: "sess-abc-999" }));
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("sess-abc-999");
  });
 
  test("HTML body contains article saved count", async () => {
    await sendCompletionNotification(makeSampleReport({ successCount: 38 }));
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("38");
  });
 
  test("HTML body contains success rate", async () => {
    await sendCompletionNotification(makeSampleReport({ successRate: 95.5 }));
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("95.5");
  });
 
  test("HTML body contains keyword coverage numbers", async () => {
    await sendCompletionNotification(makeSampleReport({ totalKeywordsCovered: 47, totalKeywordsEmpty: 353 }));
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("47");
    expect(html).toContain("353");
  });
 
  test("HTML body contains AI token usage", async () => {
    await sendCompletionNotification(makeSampleReport({
      aiTokenUsage: { inputTokens: 12500, outputTokens: 3200, estimatedCostUSD: 0 },
    }));
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toMatch(/12[,.]?500|12500/);
  });
 
  test("from address contains the SMTP_FROM domain", async () => {
    process.env.SMTP_FROM = "noreply@easyblogger.com";
    await sendCompletionNotification(makeSampleReport());
    const from = mockSendMail.mock.calls[0][0].from;
    expect(from).toContain("easyblogger.com");
  });
 
  test("email is sent as HTML (not plain text)", async () => {
    await sendCompletionNotification(makeSampleReport());
    const mailArgs = mockSendMail.mock.calls[0][0];
    expect(mailArgs.html).toBeDefined();
    expect(mailArgs.html).toContain("<!DOCTYPE html");
  });
 
});
 
// ════════════════════════════════════════════════════════════════════════════
// sendErrorAlert
// ════════════════════════════════════════════════════════════════════════════
 
describe("sendErrorAlert", () => {
 
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: "test-id" });
    prisma.user.findMany.mockResolvedValue([{ email: "admin@easyblogger.com" }]);
  });
 
  test("sends exactly one email", async () => {
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), ["Success rate critically low: 45%"]);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
 
  test("subject contains urgent indicator 🚨", async () => {
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), ["Some issue"]);
    const subject = mockSendMail.mock.calls[0][0].subject;
    expect(subject).toContain("🚨");
  });
 
  test("HTML body contains the critical issue description", async () => {
    const issues = ["Success rate critically low: 45% (threshold: 70%)"];
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), issues);
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("Success rate critically low");
    expect(html).toContain("45%");
  });
 
  test("HTML body contains all issues when there are multiple", async () => {
    const issues = [
      "Success rate critically low: 45%",
      "3 categories produced zero articles",
    ];
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), issues);
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("Success rate critically low");
    expect(html).toContain("3 categories produced zero articles");
  });
 
  test("HTML body contains session ID", async () => {
    await sendErrorAlert(makeSampleReport({ sessionId: "sess-fail-999", criticalErrors: true }), ["Issue"]);
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("sess-fail-999");
  });
 
  test("does not send when no admin users exist", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), ["Issue"]);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
 
  test("sends to all admin addresses", async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: "admin1@easyblogger.com" },
      { email: "admin2@easyblogger.com" },
    ]);
    await sendErrorAlert(makeSampleReport({ criticalErrors: true }), ["Issue"]);
    const to = mockSendMail.mock.calls[0][0].to;
    expect(to).toContain("admin1@easyblogger.com");
    expect(to).toContain("admin2@easyblogger.com");
  });
 
});
 
// ════════════════════════════════════════════════════════════════════════════
// Edge cases
// ════════════════════════════════════════════════════════════════════════════
 
describe("edge cases", () => {
 
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: "test-id" });
    prisma.user.findMany.mockResolvedValue([{ email: "admin@easyblogger.com" }]);
  });
 
  test("handles report with empty keywordsWithContent array", async () => {
    await expect(
      sendCompletionNotification(makeSampleReport({ keywordsWithContent: [], totalKeywordsCovered: 0 }))
    ).resolves.not.toThrow();
  });
 
  test("handles report with null aiTokenUsage", async () => {
    await expect(
      sendCompletionNotification(makeSampleReport({ aiTokenUsage: null }))
    ).resolves.not.toThrow();
  });
 
  test("handles report with zero successCount", async () => {
    await expect(
      sendCompletionNotification(makeSampleReport({ successCount: 0, successRate: 0 }))
    ).resolves.not.toThrow();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
 
  test("propagates SMTP errors to the caller", async () => {
    mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));
    await expect(sendCompletionNotification(makeSampleReport())).rejects.toThrow("SMTP connection refused");
  });
 
  test("nodemailer createTransport is called when sending", async () => {
    await sendCompletionNotification(makeSampleReport());
    expect(nodemailer.createTransport).toHaveBeenCalled();
  });
 
});