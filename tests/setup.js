// tests/setup.js
// Runs before every test file.
// Sets dummy environment variables so modules that read process.env don't crash.

process.env.OPENROUTER_API_KEY = "test-key-not-real";
process.env.OPENAI_API_KEY     = "test-key-not-real";
process.env.DATABASE_URL       = "postgresql://test:test@localhost/test";
process.env.SMTP_USER          = "test@example.com";
process.env.SMTP_PASS          = "testpass";
process.env.SMTP_FROM          = "noreply@easyblogger.com";
process.env.NODE_ENV           = "test";
