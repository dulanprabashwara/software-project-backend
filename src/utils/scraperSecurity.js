// src/utils/scraperSecurity.js
// Security utilities for the content scraping mechanism.
// Defends against: SSRF, DNS rebinding, malicious redirects, oversized responses, and stored XSS.

const dns = require("dns").promises;
const net = require("net");


// ── Security Constants ─────────────────────────────────────────────────────────

// Maximum allowed response size — large enough for any real article page
const MAX_RESPONSE_BYTES   = 5 * 1024 * 1024; 

// Maximum allowed request body size — scraper sends no body, this is a safety cap
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

// Request timeout in milliseconds — prevents slow-loris style attacks
const REQUEST_TIMEOUT_MS = 15000; 

// Hard cap on stored title length
const MAX_TITLE_LENGTH = 500;

// HTTP status codes above this are never expected — treat anything above as an error
const HTTP_STATUS_MAX = 600;

// Accepted HTML content type identifiers for the Content-Type check
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml"];

// Browser User-Agent sent with every HTTP request so sites don't block the scraper
const SCRAPER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// IP address ranges that must never be contacted (internal/private networks)
const BLOCKED_IP_RANGES = [
  { start: "127.0.0.0",   end: "127.255.255.255" }, // IPv4 loopback (localhost)
  { start: "169.254.0.0", end: "169.254.255.255" }, // IPv4 link-local (AWS metadata endpoint)
  { start: "192.168.0.0", end: "192.168.255.255" }, // IPv4 private Class A
  { start: "172.16.0.0",  end: "172.31.255.255"  }, // IPv4 private Class B (Docker, VPN)
  { start: "10.0.0.0",    end: "10.255.255.255"  }, // IPv4 private Class C (corporate)
  { start: "0.0.0.0",     end: "0.255.255.255"   }, // IPv4 any/broadcast
  { start: "100.64.0.0",  end: "100.127.255.255" }, // Carrier-grade NAT
];

// Hostnames that must be blocked regardless of what IP they resolve to
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

// Only standard web ports are allowed for scraping
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, ""]); // "" = no explicit port (default)

// Only http and https URL schemes are permitted
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);


// ── IP Helpers ────────────────────────────────────────────────────────────────

// Converts an IPv4 address string to a comparable integer (e.g. "192.168.1.1" → 3232235777).
function ipToLong(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// Returns true if the given IP address belongs to a private or reserved range.
function isPrivateIp(ip) {
  // Block IPv6 loopback and link-local addresses
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }

  // Range check applies to IPv4 only
  if (!net.isIPv4(ip)) return false;

  const long = ipToLong(ip);
  for (const range of BLOCKED_IP_RANGES) {
    if (long >= ipToLong(range.start) && long <= ipToLong(range.end)) {
      return true;
    }
  }
  return false;
}


// ── URL Validation ────────────────────────────────────────────────────────────

// Validates a source URL before any HTTP request is made — checks scheme, hostname, port, and DNS resolution.
// Called once per source at session start (not per article) to avoid excessive DNS lookups.
async function validateScrapingUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: `Invalid URL format: "${url}"` };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { safe: false, reason: `Blocked URL scheme: "${parsed.protocol}" — only http/https allowed` };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Blocked hostname: "${hostname}"` };
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { safe: false, reason: `Direct private IP address blocked: "${hostname}"` };
  }

  const port = parsed.port || "";
  if (!ALLOWED_PORTS.has(port)) {
    return { safe: false, reason: `Non-standard port blocked: "${port}" — only ports 80, 443, 8080, 8443 allowed` };
  }

  // DNS check — ensures the domain resolves to a public IP, not an internal network address
  try {
    const addresses = await dns.resolve4(hostname);
    for (const ip of addresses) {
      if (isPrivateIp(ip)) {
        return {
          safe:   false,
          reason: `DNS resolved to private IP: "${hostname}" → "${ip}" — SSRF protection triggered`,
        };
      }
    }
  } catch (dnsErr) {
    return { safe: false, reason: `DNS resolution failed for "${hostname}": ${dnsErr.message}` };
  }

  return { safe: true };
}

// Validates a redirect destination without a DNS lookup — checks scheme, hostname, port, and same-domain rule.
// Redirect targets must stay on the same domain as the original source.
function validateRedirectUrl(redirectUrl, originalHostname) {
  let parsed;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return { safe: false, reason: "Malformed redirect URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { safe: false, reason: `Redirect to non-http scheme: "${parsed.protocol}"` };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Redirect to blocked hostname: "${hostname}"` };
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { safe: false, reason: `Redirect to private IP blocked: "${hostname}"` };
  }

  // Cross-domain redirects are blocked — a source can only redirect within its own domain
  if (!hostname.endsWith(originalHostname) && hostname !== originalHostname) {
    return { safe: false, reason: `Cross-domain redirect blocked: "${hostname}" is not "${originalHostname}"` };
  }

  const port = parsed.port || "";
  if (!ALLOWED_PORTS.has(port)) {
    return { safe: false, reason: `Redirect to non-standard port blocked: "${port}"` };
  }

  return { safe: true };
}


// ── Response Safety ───────────────────────────────────────────────────────────

// Checks an HTTP response for a valid HTML content type and acceptable size before processing its content.
function checkResponseSafety(response) {
  const contentType   = response.headers["content-type"] || "";
  const contentLength = parseInt(response.headers["content-length"] || "0");

  const isHtml = ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t));
  if (!isHtml) {
    return {
      safe:   false,
      reason: `Non-HTML content type rejected: "${contentType.split(";")[0].trim()}"`,
    };
  }

  if (contentLength > MAX_RESPONSE_BYTES) {
    return {
      safe:   false,
      reason: `Response too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (limit: 5MB)`,
    };
  }

  // Check actual received size in case the Content-Length header was missing or wrong
  const actualSize = Buffer.byteLength(
    typeof response.data === "string" ? response.data : JSON.stringify(response.data),
    "utf8"
  );
  if (actualSize > MAX_RESPONSE_BYTES) {
    return {
      safe:   false,
      reason: `Actual response size too large: ${(actualSize / 1024 / 1024).toFixed(1)}MB (limit: 5MB)`,
    };
  }

  return { safe: true };
}


// ── Content Sanitization ──────────────────────────────────────────────────────

// Strips all HTML tags and decodes entities from article body text before database storage,
// ensuring only plain text is ever saved (prevents XSS if content is ever rendered in a browser).
function sanitizeContent(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/<[^>]*>/g, " ")       // remove all HTML tags
    .replace(/&amp;/g,   "&")
    .replace(/&lt;/g,    "<")
    .replace(/&gt;/g,    ">")
    .replace(/&quot;/g,  '"')
    .replace(/&#x27;/g,  "'")
    .replace(/&#39;/g,   "'")
    .replace(/&nbsp;/g,  " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g,"…")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // remove non-printable control chars (keep \n \r \t)
    .replace(/\n{4,}/g,  "\n\n\n") // collapse excessive blank lines
    .replace(/ {3,}/g,   "  ")     // collapse excessive spaces
    .trim();
}

// Strips HTML and collapses whitespace from a title string, capped at MAX_TITLE_LENGTH characters.
function sanitizeTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}


// ── Axios Config ──────────────────────────────────────────────────────────────

// Returns a hardened axios config: size limits, manual redirect handling, 15s timeout, browser headers.
function buildSecureAxiosConfig() {
  return {
    timeout:          REQUEST_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength:    MAX_REQUEST_BODY_BYTES,
    maxRedirects:     0,              // redirects are handled manually in scraper.service.js
    decompress:       true,
    validateStatus:   (status) => status < HTTP_STATUS_MAX,
    headers: {
      "User-Agent":      SCRAPER_USER_AGENT,
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection":      "keep-alive",
    },
  };
}

module.exports = {
  validateScrapingUrl,
  validateRedirectUrl,
  checkResponseSafety,
  sanitizeContent,
  sanitizeTitle,
  buildSecureAxiosConfig,
  isPrivateIp,       
  MAX_RESPONSE_BYTES,
};
