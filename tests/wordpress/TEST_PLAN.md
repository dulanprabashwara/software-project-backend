# WordPress Integration — Test Plan & Documentation
**Project:** Easy Blogger Backend  
**Module:** WordPress Integration  
**Document Type:** Unit Test Plan  
**Standard:** Based on IEEE 829 Test Documentation Standard  
**Version:** 1.0  

---

## 1. Scope

This document covers unit-level testing for the WordPress integration module, which consists of:

| Source File | Responsibility |
|---|---|
| `src/services/wordpress.service.js` | All business logic: OAuth, connection management, publishing, scheduling |
| `src/jobs/wordpress.job.js` | Background cron processor for scheduled publish jobs |

**Out of scope:** Integration tests against the live WordPress.com API, controller HTTP layer tests, frontend tests.

---

## 2. Test Environment

| Item | Value |
|---|---|
| Test Runner | Jest 29 |
| Config File | `tests/jest.config.js` |
| Environment Setup | `tests/setup.js` |
| Prisma Mock | `tests/mocks/prisma.mock.wp.js` (WordPress-specific, does not affect scraper tests) |
| Axios Mock | `tests/mocks/axios.mock.js` |
| Test Data | `tests/wordpress/fixtures.js` |
| Node env | `test` |
| Database | Not used (fully mocked) |
| External APIs | Not called (axios fully mocked) |

### Running the Tests

```bash
# Run only WordPress tests
npx jest --config=tests/jest.config.js tests/wordpress/

# Run with coverage
npx jest --config=tests/jest.config.js tests/wordpress/ --coverage

# Run in watch mode during development
npx jest --config=tests/jest.config.js tests/wordpress/ --watch

# Run a single test file
npx jest --config=tests/jest.config.js tests/wordpress/wordpress.auth.test.js
```

---

## 3. Test Files

| File | Group | Test Cases |
|---|---|---|
| `wordpress.auth.test.js` | OAuth initiation, OAuth callback, connection status, disconnect | TC-AUTH-001 to TC-DISC-005 |
| `wordpress.push.test.js` | Core WordPress REST API publish call | TC-PUSH-001 to TC-PUSH-019 |
| `wordpress.schedule.test.js` | Scheduling logic, failure paths, input validation | TC-SCHED-001 to TC-SCHED-032 |
| `wordpress.job.test.js` | Cron job processor, publish status query | TC-JOB-001 to TC-STAT-006 |

**Total test cases: 75**

---

## 4. Shared Test Data (fixtures.js)

All test data is defined in `tests/wordpress/fixtures.js`. Below is a description of each fixture and the realistic values used.

### MOCK_USER
Represents an authenticated Easy Blogger user.

| Field | Value | Reason |
|---|---|---|
| id | `user_abc123` | Stable ID used across all tests |
| email | `emma@example.com` | Realistic email |
| displayName | `Emma Richardson` | Matches the UI designs |
| isPremium | `true` | Premium user to avoid feature restriction issues |
| wordpressAccountId | `null` | Default: not yet connected |

### MOCK_ARTICLE
Represents a published article with all fields populated.

| Field | Value | Reason |
|---|---|---|
| id | `article_xyz789` | Stable ID |
| title | `Getting Started with TypeScript` | Realistic title |
| content | HTML with heading, paragraph, and absolute-URL image | Tests that HTML transfers correctly; absolute URL tests image pass-through |
| coverImage | Absolute CDN URL | Tests featured_image mapping |
| tags | `["TypeScript", "JavaScript", "Web Development"]` | Tests comma-join logic |
| authorId | `user_abc123` | Matches MOCK_USER so ownership checks pass |

### MOCK_ARTICLE_NO_EXTRAS
Same as MOCK_ARTICLE but with `coverImage: null` and `tags: []`. Used to verify optional fields are omitted from the WordPress API payload (TC-PUSH-013, TC-PUSH-014).

### MOCK_WP_CONNECTION
The stored WordPress connection record as it exists in the database, including `accessToken`.

### MOCK_WP_CONNECTION_PUBLIC
The connection as returned by `getWordPressConnection()` — no `accessToken` field. Used to verify the security select rule (TC-STATUS-004).

### MOCK_WP_TOKEN_RESPONSE
Simulates the WordPress.com OAuth2 token endpoint response.

| Field | Value | Reason |
|---|---|---|
| access_token | `wp_oauth_token_secret_abc` | Realistic token format |
| blog_id | `123456789` (Number) | WordPress returns this as a Number; tests verify we stringify it (TC-CB-011) |
| blog_url | `https://emmablog.wordpress.com` | Realistic WordPress.com URL |

### MOCK_WP_ME_RESPONSE
Simulates the WordPress.com `/me` API response after OAuth.

### MOCK_WP_POST_RESPONSE
Simulates a successful WordPress post creation response.

| Field | Value | Reason |
|---|---|---|
| ID | `555000` (Number) | WordPress returns numeric IDs; tests verify stringification |
| URL | Full WordPress post URL | Returned to frontend after publish |

### MOCK_PUBLISH_JOB_PENDING / PUBLISHED / FAILED
Database job records at each stage of the lifecycle. Used in job processor tests.

---

## 5. Test Cases

### Group 1 — initiateWordPressAuth (TC-AUTH-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-AUTH-001 | Returns valid OAuth URL | `userId = "user_abc123"`, all env vars set | URL starts with `https://public-api.wordpress.com/oauth2/authorize` | Verifies correct OAuth base URL |
| TC-AUTH-002 | URL has correct client_id | Same as above | URL contains `client_id=test_client_id_12345` | Verifies env var is embedded in URL |
| TC-AUTH-003 | URL has correct redirect_uri | Same | URL contains encoded redirect URI | Verifies callback URL is correct |
| TC-AUTH-004 | URL has response_type=code | Same | `response_type=code` in URL | Standard OAuth2 code flow check |
| TC-AUTH-005 | URL has correct scope | Same | `scope=posts+auth` | WordPress requires posts and auth scope |
| TC-AUTH-006 | State param encodes userId | `userId = "user_abc123"` | Decoded state contains `{ userId: "user_abc123" }` | The callback must be able to recover userId from state |
| TC-AUTH-007 | Different users get different state | `userId = "user_aaa"` vs `"user_bbb"` | Two different state values | Prevents state collisions between concurrent OAuth flows |
| TC-AUTH-008 | Throws when CLIENT_ID missing | `WORDPRESS_CLIENT_ID` deleted from env | Throws any error | Server should not silently produce a broken URL |
| TC-AUTH-009 | Throws when REDIRECT_URI missing | `WORDPRESS_REDIRECT_URI` deleted | Throws any error | Same reason |
| TC-AUTH-010 | Error message mentions configuration | Both env vars deleted | Error message matches `/configured/i` | Error must be informative for the developer |

---

### Group 2 — handleWordPressCallback (TC-CB-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-CB-001 | Successful connection | Valid code + valid state | Returns object with siteUrl, siteId, wpUsername | Happy path end-to-end |
| TC-CB-002 | Calls token endpoint with grant_type | Valid code | axios.post called with `authorization_code` body | Verifies correct OAuth2 token exchange |
| TC-CB-003 | Fetches /me profile | Valid code | axios.get called with `/me` and Bearer token | WordPress username must be fetched after token |
| TC-CB-004 | Upserts connection record | Valid code | `prisma.wordPressConnection.upsert` called with correct where/create | Connection must be persisted |
| TC-CB-005 | Mirrors siteId on User | Valid code | `prisma.user.update` called with `wordpressAccountId` | Quick null-check field on User must be kept in sync |
| TC-CB-006 | Throws 400 on invalid state | `state = "not_valid_base64!!!"` | Error with statusCode 400 | Prevents callback hijacking with corrupted state |
| TC-CB-007 | Throws 400 when state has no userId | State encodes `{ other: "data" }` | Error with statusCode 400 | Malformed but valid base64 state should still be rejected |
| TC-CB-008 | Throws 400 on token exchange failure | WP returns 4xx error | Error with statusCode 400 | Invalid or expired auth codes must be reported |
| TC-CB-009 | Propagates WP error description | WP returns `error_description: "expired"` | Error message contains "expired" | User-facing error should explain what went wrong |
| TC-CB-010 | Throws 500 on /me failure | axios.get rejects | Error with statusCode 500 | Network failure fetching user profile should be an internal error |
| TC-CB-011 | siteId stored as string | WP returns `blog_id` as Number 123456789 | `typeof siteId === "string"` | Prisma schema defines siteId as String; must not cause type mismatch |
| TC-CB-012 | Falls back to username when display_name empty | WP returns `display_name: ""` | wpUsername equals the `username` field | Some WP accounts have no display name set |

---

### Group 3 — getWordPressConnection (TC-STATUS-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-STATUS-001 | Returns connection data | User has a connection | Object with siteUrl and wpUsername | Edit Profile and Publish pages use this to set UI state |
| TC-STATUS-002 | Returns null when not connected | No connection in DB | `null` | Frontend checks for null to show Disconnected UI |
| TC-STATUS-003 | Queries by userId | `userId = "user_abc123"` | `findUnique` called with `where: { userId }` | Must be user-specific |
| TC-STATUS-004 | Does not return accessToken | User has connection | `callArg.select.accessToken` is undefined | accessToken is secret and must never be sent to frontend |

---

### Group 4 — disconnectWordPress (TC-DISC-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-DISC-001 | Returns disconnected=true on success | User has connection | `{ disconnected: true }` | Frontend uses this to update UI state |
| TC-DISC-002 | Deletes the connection row | User has connection | `prisma.wordPressConnection.delete` called with correct userId | Ensures connection is actually removed |
| TC-DISC-003 | Clears wordpressAccountId on User | User has connection | `prisma.user.update` called with `{ wordpressAccountId: null }` | Keeps the User model mirror field in sync |
| TC-DISC-004 | Throws 404 when no connection | No connection in DB | Error with statusCode 404 | Should not silently succeed |
| TC-DISC-005 | Does not call delete when not found | No connection | `prisma.wordPressConnection.delete` not called | No unnecessary DB operations |

---

### Group 5 — pushArticleToWordPress (TC-PUSH-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-PUSH-001 | Returns wpPostId and wpPostUrl | Full article, valid connection | `{ wpPostId: "555000", wpPostUrl: "https://..." }` | Core success path |
| TC-PUSH-002 | wpPostId is always a string | WP returns numeric ID | `typeof wpPostId === "string"` | Prisma schema stores it as String |
| TC-PUSH-003 | Calls correct API endpoint | Any article | URL contains `/sites/{siteId}/posts/new` | Must target the correct site |
| TC-PUSH-004 | Sends Bearer token in header | Any article | `Authorization: Bearer wp_oauth_token...` | WordPress API requires this for auth |
| TC-PUSH-005 | Title in post body | Article with title | `body.title === article.title` | Content fidelity |
| TC-PUSH-006 | Content in post body | Article with HTML content | `body.content` contains original content | Full article must transfer |
| TC-PUSH-007 | Canonical snippet prepended | Article with slug | Content contains "canonical" | SEO — original source attribution |
| TC-PUSH-008 | Canonical URL uses CLIENT_URL | `CLIENT_URL=http://localhost:3000` | Content contains `http://localhost:3000` | Canonical must point to our platform |
| TC-PUSH-009 | Canonical omitted when no CLIENT_URL | `CLIENT_URL` deleted | No `<link rel="canonical"` in content | Graceful degradation when env not set |
| TC-PUSH-010 | Status is publish | Any article | `body.status === "publish"` | Must publish, not draft |
| TC-PUSH-011 | Tags as comma-separated string | `tags: ["A", "B", "C"]` | `body.tags === "A,B,C"` | WordPress.com tag format |
| TC-PUSH-012 | Cover image as featured_image | Article with coverImage | `body.featured_image === article.coverImage` | Preserves cover image on WP |
| TC-PUSH-013 | Tags omitted when empty | `tags: []` | `body.tags === undefined` | Must not send empty string to WP |
| TC-PUSH-014 | featured_image omitted when null | `coverImage: null` | `body.featured_image === undefined` | Must not send null to WP |
| TC-PUSH-015 | Throws Error on 403 | WP returns 403 with message | `throws Error("Forbidden: insufficient permissions.")` | Token lacks permission |
| TC-PUSH-016 | Throws Error on 401 | WP returns 401 "Token has expired" | `throws Error("Token has expired.")` | Expired or revoked token |
| TC-PUSH-017 | Throws on network error | axios throws without response | `throws Error("connect ECONNREFUSED")` | Network-level failure |
| TC-PUSH-018 | Throws plain Error not ApiError | Any failure | Error has no statusCode | Caller (scheduleWordPressPublish) uses the error type to decide draft fallback |
| TC-PUSH-019 | 15 second timeout set | Any call | `config.timeout === 15000` | Prevents hanging requests from blocking the cron job |

---

### Group 6A — scheduleWordPressPublish: Immediate Success (TC-SCHED-001 to 006)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-SCHED-001 | success=true for immediate publish | `scheduledAt=null`, WP succeeds | `result.success === true` | Happy path |
| TC-SCHED-002 | Returns wpPostUrl | Same | `result.wpPostUrl` equals WP response URL | Frontend links to WP post |
| TC-SCHED-003 | Returns wpPostId | Same | `result.wpPostId` equals WP response ID | For record keeping |
| TC-SCHED-004 | Creates PUBLISHED job | Same | Job created with `status: "PUBLISHED"` | Audit trail |
| TC-SCHED-005 | Job has correct articleId and userId | Same | Job data contains both IDs | Correct ownership |
| TC-SCHED-006 | Job stores WP identifiers | Same | Job has wpPostId and wpPostUrl | Status endpoint can return them later |

---

### Group 6B — scheduleWordPressPublish: Publish Fails, Draft Saves (TC-SCHED-007 to 013)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-SCHED-007 | success=false | Publish fails, draft saves | `result.success === false` | Caller must know publish did not succeed |
| TC-SCHED-008 | draftUrl returned | Same | `result.draftUrl === "https://wordpress.com/posts/..."` | Frontend shows "Open draft on WordPress" link |
| TC-SCHED-009 | failureReason is publish | Same | `result.failureReason === "publish"` | Frontend differentiates: show draft link, not retry |
| TC-SCHED-010 | FAILED job created with draftUrl | Same | DB job has `status: "FAILED"` and `draftUrl` set | Status endpoint returns correct data |
| TC-SCHED-011 | Job stores publish errorMsg | Same | `jobData.errorMsg.length > 0` | Debugging information |
| TC-SCHED-012 | Draft save uses status=draft | Same | Second axios.post body has `status: "draft"` | Must not attempt to publish the draft |
| TC-SCHED-013 | Draft save includes article content | Same | Draft body contains original content | User must not need to retype anything |

---

### Group 6C — Both Publish AND Draft Fail (TC-SCHED-014 to 018)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-SCHED-014 | success=false | Both fail | `result.success === false` | Caller notified |
| TC-SCHED-015 | draftUrl is null | Both fail | `result.draftUrl === null` | No draft link shown; retry button shown instead |
| TC-SCHED-016 | failureReason is both | Both fail | `result.failureReason === "both"` | Frontend shows retry button only |
| TC-SCHED-017 | FAILED job still created | Both fail | `prisma.wordPressPublishJob.create` called once | Failure must be recorded for status checks |
| TC-SCHED-018 | Job draftUrl is null in DB | Both fail | `jobData.draftUrl === null` | Status endpoint returns null draftUrl correctly |

---

### Group 6D — Scheduled Publish (TC-SCHED-019 to 026)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-SCHED-019 | success=true | `scheduledAt = future Date` | `result.success === true` | Scheduling accepted |
| TC-SCHED-020 | Creates PENDING job | Same | Job has `status: "PENDING"` | Cron job will process it later |
| TC-SCHED-021 | No axios call | Same | `axios.post` not called | WordPress must NOT be called at schedule time |
| TC-SCHED-022 | Correct scheduledAt stored | `scheduledAt = specificDate` | `jobData.scheduledAt.getTime() === specificDate.getTime()` | Cron fires at the right time |
| TC-SCHED-023 | Result has jobId | Same | `result.jobId` defined | Frontend can reference the job for status checks |
| TC-SCHED-024 | Result has scheduledAt | Same | `result.scheduledAt` defined | Frontend displays scheduled time to user |
| TC-SCHED-025 | Updates existing PENDING job (no duplicate) | Existing PENDING job found | `create` NOT called; `update` called once | Prevents duplicate jobs for same article |
| TC-SCHED-026 | Resets IN_PROGRESS to PENDING on reschedule | Existing IN_PROGRESS job | Update sets `status: "PENDING"` | Allows rescheduling a stuck job |

---

### Group 6E — Validation (TC-SCHED-027 to 032)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-SCHED-027 | Throws 404 for nonexistent article | `articleId = "bad_id"` | Error with statusCode 404 | Article must exist |
| TC-SCHED-028 | Throws 403 for wrong author | Article belongs to different user | Error with statusCode 403 | User cannot publish others' articles |
| TC-SCHED-029 | Throws 400 when WP not connected | No connection in DB | Error with statusCode 400 | Must check connection before any WP call |
| TC-SCHED-030 | Error message mentions connecting | Same | Error message matches `/connect/i` | User-facing message explains the fix |
| TC-SCHED-031 | No axios call when article not found | `articleId = "bad_id"` | `axios.post` not called | Guard clause fires before external call |
| TC-SCHED-032 | No axios call for wrong author | Article of another user | `axios.post` not called | Guard clause fires before external call |

---

### Group 7 — processWordPressJobs (TC-JOB-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-JOB-001 | No-op when no pending jobs | DB returns empty array | No updates, no axios calls | No unnecessary work |
| TC-JOB-002 | Marks job IN_PROGRESS first | One pending job | First update has `status: "IN_PROGRESS"` | Prevents double-processing by concurrent cron ticks |
| TC-JOB-003 | Queries PENDING with scheduledAt <= now | Any state | Query has `status: "PENDING"` and `lte: Date` | Only fires due jobs |
| TC-JOB-004 | Marks job PUBLISHED on success | One pending job, WP succeeds | Second update has `status: "PUBLISHED"` | Job lifecycle |
| TC-JOB-005 | Stores WP identifiers on success | Same | Update has wpPostId and wpPostUrl | Status endpoint can retrieve them |
| TC-JOB-006 | Marks job FAILED on WP error | WP throws | Second update has `status: "FAILED"` | Job lifecycle on failure |
| TC-JOB-007 | Stores errorMsg on failure | WP throws "WP API timeout" | Update has `errorMsg: "WP API timeout"` | Debug information |
| TC-JOB-008 | Processes multiple jobs in one run | 2 pending jobs | 4 update calls total (2 per job) | Batch processing |
| TC-JOB-009 | One failure does not stop others | Job1 fails, Job2 succeeds | 4 update calls, job2 is PUBLISHED | Resilience |
| TC-JOB-010 | Skips job if IN_PROGRESS update fails | Update throws on first call | `axios.post` not called | Concurrency safety: another instance may have grabbed the job |
| TC-JOB-011 | Graceful when DB query fails | findMany throws | Resolves without throwing | Cron must not crash the process |

---

### Group 8 — getWordPressPublishStatus (TC-STAT-xxx)

| ID | Test Name | Input | Expected Output | Purpose |
|---|---|---|---|---|
| TC-STAT-001 | Returns latest job | PUBLISHED job exists | Object with `status: "PUBLISHED"` and wpPostUrl | Frontend reads publish result |
| TC-STAT-002 | Returns null when no job | DB returns null | `null` | Frontend shows "not published to WP yet" |
| TC-STAT-003 | Returns draftUrl for FAILED job | FAILED job with draftUrl | `result.draftUrl` matches stored value | Frontend shows draft link |
| TC-STAT-004 | Queries by articleId and userId | Specific IDs | Query where clause has both fields | User can only see their own job status |
| TC-STAT-005 | Orders by createdAt desc | Multiple jobs possible | `orderBy: { createdAt: "desc" }` | Most recent attempt is returned |
| TC-STAT-006 | Returns errorMsg for FAILED | FAILED job with errorMsg | `result.errorMsg` matches stored value | Frontend can display failure reason |

---

## 6. Expected Coverage

After running all 75 test cases, the following function coverage is expected for `wordpress.service.js`:

| Function | Branches Covered |
|---|---|
| `buildCanonicalSnippet` | CLIENT_URL set / not set / no slug |
| `initiateWordPressAuth` | Success / missing env vars |
| `handleWordPressCallback` | Success / bad state / token fail / me fail / no display_name |
| `getWordPressConnection` | Found / not found |
| `disconnectWordPress` | Success / not found |
| `pushArticleToWordPress` | Success / 4xx error / network error / no tags / no cover |
| `attemptDraftSave` | Success / failure |
| `scheduleWordPressPublish` | Immediate success / publish fail+draft ok / both fail / scheduled new / scheduled reschedule / validation errors |
| `getWordPressPublishStatus` | Found / not found |

---

## 7. What Is NOT Tested Here (and Why)

| Item | Reason |
|---|---|
| Live WordPress.com API calls | Requires real credentials and network; belongs in integration/E2E tests |
| node-cron scheduling timing | Third-party library; we test the function it calls, not the timer |
| `startWordPressJobs()` | Just registers a cron — tested implicitly; no logic to unit test |
| Controller HTTP layer (req/res) | Belongs in controller tests with supertest |
| OAuth redirect in browser | Browser behaviour; belongs in E2E tests (Playwright/Cypress) |
| Prisma migration correctness | Belongs in migration tests against a test DB |
