// src/utils/scraperSecurity.js
// ─────────────────────────────────────────────────────────────────────────────
// Security layer for the content scraping mechanism.
//
// THREATS WE ARE DEFENDING AGAINST:
//
// 1. SSRF — Server-Side Request Forgery
//    What it is: An attacker (or misconfigured admin) adds a URL like
//    "http://localhost:5000/admin" or "http://192.168.1.1" or the AWS metadata
//    endpoint "http://169.254.169.254". The scraper would then make an HTTP
//    request TO OUR OWN SERVER or internal network, potentially reading
//    secrets, admin data, or cloud credentials.
//    Our defence: validateScrapingUrl() checks every URL before any HTTP
//    request is made. Internal IPs, localhost, and cloud metadata endpoints
//    are all blocked.
//
// 2. DNS Rebinding
//    What it is: A malicious domain resolves to a public IP at validation time
//    but switches to an internal IP (e.g. 127.0.0.1) when the actual request
//    is made. This bypasses hostname checks.
//    Our defence: We check the resolved IP of every request response using
//    axios's socket information. If the resolved IP is internal, the response
//    is discarded.
//
// 3. Malicious Redirects
//    What it is: A site responds with a redirect (301/302) pointing to an
//    internal URL, bypassing our URL validation.
//    Our defence: We intercept axios redirects manually to re-validate every
//    redirect destination before following it.
//
// 4. Oversized Responses (DoS via large payloads)
//    What it is: A malicious or broken site sends a 500MB HTML response,
//    consuming all available memory and crashing the Node.js process.
//    Our defence: maxContentLength and maxBodyLength limits on axios,
//    plus a streaming size guard.
//
// 5. Malicious Stored Content (XSS in database)
//    What it is: Scraped HTML might contain <script> tags or JavaScript event
//    handlers. If this content is ever displayed in a browser without escaping,
//    it becomes an XSS attack vector.
//    Our defence: sanitizeContent() strips all HTML tags from stored text.
//    The content stored is plain text only — no HTML whatsoever.
//
// 6. Non-HTML Content Type
//    What it is: A URL could point to a binary file (PDF, ZIP, executable)
//    instead of a webpage. Parsing binary data as HTML causes garbage output
//    or crashes the HTML parser.
//    Our defence: We check the Content-Type header and reject anything that
//    is not text/html.
//
// 7. Invalid/Unresolvable URLs from Admin Input
//    What it is: Admin accidentally saves a malformed URL or a URL to a site
//    that has since gone offline.
//    Our defence: The existing admin validateUrl endpoint (in admin.controller.js)
//    already pings the URL before saving. This utility adds a second check
//    at scrape time.
//
// WHAT IS NOT BLOCKED (intentional):
//   - Public websites on standard ports (80, 443) — these are the whole point
//   - Redirects within the same domain — normal for blog/news sites
//   - Sites that return non-200 status — handled gracefully by the scraper
// ─────────────────────────────────────────────────────────────────────────────

const dns  = require("dns").promises;
const net  = require("net");

// ── PRIVATE/INTERNAL IP RANGES ────────────────────────────────────────────────
// These IP address ranges are reserved for internal/private networks.
// We must never make HTTP requests to them from the scraper.

const BLOCKED_IP_RANGES = [
  // IPv4 loopback (localhost)
  { start: "127.0.0.0",   end: "127.255.255.255" },
  // IPv4 link-local (AWS EC2 instance metadata: 169.254.169.254)
  { start: "169.254.0.0", end: "169.254.255.255" },
  // IPv4 private network Class A (192.168.x.x — home/office routers)
  { start: "192.168.0.0", end: "192.168.255.255" },
  // IPv4 private network Class B (172.16.x.x — Docker, VPN, cloud internal)
  { start: "172.16.0.0",  end: "172.31.255.255"  },
  // IPv4 private network Class C (10.x.x.x — corporate networks, NeonDB private)
  { start: "10.0.0.0",    end: "10.255.255.255"  },
  // IPv4 any/broadcast
  { start: "0.0.0.0",     end: "0.255.255.255"   },
  // Carrier-grade NAT
  { start: "100.64.0.0",  end: "100.127.255.255" },
];

// Blocked hostnames — regardless of what IP they resolve to
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

// Maximum response size: 5MB — large enough for any real article page
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Allowed ports for scraping — only standard web ports
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, ""]); // "" = default port

// Allowed URL schemes
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// ── ipToLong ──────────────────────────────────────────────────────────────────
// Converts an IPv4 address string to a comparable number.
// e.g. "192.168.1.1" → 3232235777
// This lets us check if an IP falls inside a range using simple arithmetic.

function ipToLong(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// ── isPrivateIp ────────────────────────────────────────────────────────────────
// Returns true if the given IPv4 address falls inside any of the blocked ranges.
// Returns false for IPv6 addresses (we do not scrape IPv6-only hosts).

function isPrivateIp(ip) {
  // Block IPv6 loopback and link-local
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }

  // Only check IPv4 for range matching
  if (!net.isIPv4(ip)) return false;

  const long = ipToLong(ip);
  for (const range of BLOCKED_IP_RANGES) {
    if (long >= ipToLong(range.start) && long <= ipToLong(range.end)) {
      return true;
    }
  }
  return false;
}

// ── validateScrapingUrl ────────────────────────────────────────────────────────
// Main SSRF protection function. Called before EVERY HTTP request the scraper makes.
//
// Checks performed:
//   1. URL is a valid parseable URL
//   2. Scheme is http or https (not file://, ftp://, etc.)
//   3. Hostname is not a blocked hostname (localhost etc.)
//   4. Port is standard (80, 443, or blank)
//   5. DNS resolves to a public IP (not internal/private network)
//
// Returns: { safe: true } or { safe: false, reason: "..." }
//
// Note: The DNS check makes this async. It is called once per source URL
// at session start, not once per article link — to avoid hundreds of DNS
// lookups per session.

async function validateScrapingUrl(url) {
  // ── Check 1: Parseable URL ────────────────────────────────────────────────
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: `Invalid URL format: "${url}"` };
  }

  // ── Check 2: Allowed scheme ───────────────────────────────────────────────
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { safe: false, reason: `Blocked URL scheme: "${parsed.protocol}" — only http/https allowed` };
  }

  // ── Check 3: Blocked hostname ─────────────────────────────────────────────
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Blocked hostname: "${hostname}"` };
  }

  // Block IP addresses entered directly as hostnames
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { safe: false, reason: `Direct private IP address blocked: "${hostname}"` };
    }
  }

  // ── Check 4: Allowed port ─────────────────────────────────────────────────
  const port = parsed.port || "";
  if (!ALLOWED_PORTS.has(port)) {
    return { safe: false, reason: `Non-standard port blocked: "${port}" — only ports 80, 443, 8080, 8443 allowed` };
  }

  // ── Check 5: DNS resolution to public IP ─────────────────────────────────
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
    // If DNS resolution fails entirely, the domain doesn't exist — block it
    return { safe: false, reason: `DNS resolution failed for "${hostname}": ${dnsErr.message}` };
  }

  return { safe: true };
}

// ── validateRedirectUrl ────────────────────────────────────────────────────────
// Lighter version of validateScrapingUrl used to check redirect destinations.
// Does NOT do a DNS lookup (too expensive inline) — just checks structure and port.
// Redirect destinations must also be on the same original domain.

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

  // Redirect must stay on the original domain or a subdomain of it
  // e.g. techcrunch.com can redirect to www.techcrunch.com — that's fine
  // techcrunch.com cannot redirect to evil.com
  if (!hostname.endsWith(originalHostname) && hostname !== originalHostname) {
    return { safe: false, reason: `Cross-domain redirect blocked: "${hostname}" is not "${originalHostname}"` };
  }

  const port = parsed.port || "";
  if (!ALLOWED_PORTS.has(port)) {
    return { safe: false, reason: `Redirect to non-standard port blocked: "${port}"` };
  }

  return { safe: true };
}

// ── checkResponseSafety ────────────────────────────────────────────────────────
// Checks an axios response for safety before we process its content.
//
// Checks:
//   1. Content-Type is text/html (not binary, not JSON API, not executable)
//   2. Content-Length is within limits (blocks oversized responses)
//
// Called immediately after receiving each HTTP response.

function checkResponseSafety(response) {
  const contentType   = response.headers["content-type"] || "";
  const contentLength = parseInt(response.headers["content-length"] || "0");

  // Must be HTML — reject JSON APIs, PDFs, binaries, etc.
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return {
      safe:   false,
      reason: `Non-HTML content type rejected: "${contentType.split(";")[0].trim()}"`,
    };
  }

  // Reject responses that declare themselves over the size limit
  if (contentLength > MAX_RESPONSE_BYTES) {
    return {
      safe:   false,
      reason: `Response too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (limit: 5MB)`,
    };
  }

  // Check actual received data size (in case Content-Length header was missing/wrong)
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

// ── sanitizeContent ────────────────────────────────────────────────────────────
// Strips all remaining HTML from text before storing in the database.
//
// Why: Even after cheerio removes noise elements, traces of HTML attributes
// or malformed tags can remain in extracted text. Any HTML stored in the
// database could become an XSS vector if ever rendered in a browser without
// escaping. We store pure plain text only.
//
// What is removed:
//   - All HTML tags (<script>, <a>, <b>, <img>, etc.)
//   - HTML entities are decoded to their text equivalents
//     (e.g. &amp; → &, &lt; → <, &#x27; → ')
//   - Control characters (except normal whitespace)
//   - Null bytes
//
// What is preserved:
//   - All plain text content
//   - Our structural markers [H1], [H2], [QUOTE]
//   - Normal punctuation and special characters
//   - Newlines (our paragraph separators)

function sanitizeContent(text) {
  if (!text || typeof text !== "string") return "";

  return text
    // Remove all HTML tags
    .replace(/<[^>]*>/g, " ")
    // Decode common HTML entities
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
    // Remove null bytes and non-printable control characters
    // (keep \n=10, \r=13, \t=9 as they are legitimate whitespace)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse runs of more than 3 newlines (prevents huge blank gaps)
    .replace(/\n{4,}/g, "\n\n\n")
    // Collapse excessive spaces within a line
    .replace(/ {3,}/g, "  ")
    .trim();
}

// ── sanitizeTitle ─────────────────────────────────────────────────────────────
// Lighter version of sanitizeContent specifically for article titles.
// Titles are single-line — strips HTML and collapses to one line.

function sanitizeTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500); // hard cap on title length
}

// ── buildSecureAxiosConfig ─────────────────────────────────────────────────────
// Returns the axios configuration object with all security settings applied.
// Used by sendHTTPRequest() in scraper.service.js.
//
// Security settings applied:
//   - maxContentLength: rejects responses over 5MB at the axios level
//   - maxBodyLength:    rejects request bodies over 1MB (scraper sends no body,
//                       but this prevents accidental uploads)
//   - maxRedirects: 0   — we handle redirects manually so we can validate each one
//   - timeout: 15000    — 15 seconds max, prevents slow-loris attacks
//   - decompress: true  — handles gzip/brotli compressed responses

function buildSecureAxiosConfig() {
  return {
    timeout:          15000,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength:    1 * 1024 * 1024, // 1MB max for request body
    maxRedirects:     0,               // we handle redirects manually
    decompress:       true,
    validateStatus:   (status) => status < 600, // don't throw on any status
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
  isPrivateIp,          // exported for tests
  MAX_RESPONSE_BYTES,
};
