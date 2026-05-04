const axios = require("axios");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// ── CONSTANTS ───────────────────────────────────────────────────────

const LI_OAUTH_BASE = "https://www.linkedin.com/oauth/v2";
const LI_API_BASE = "https://api.linkedin.com/v2";
const POST_PUBLISH_TIMEOUT_MS = 15000;

/**
 * Generates the LinkedIn OAuth 2.0 authorization URL.
 */
const initiateLinkedInAuth = (userId) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw ApiError.internal(
      "LinkedIn integration is not configured. LINKEDIN_CLIENT_ID and LINKEDIN_REDIRECT_URI must be set in .env"
    );
  }

  // The state parameter helps prevent CSRF attacks and carries our internal userId
  const state = Buffer.from(JSON.stringify({ userId })).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "openid profile email w_member_social", // w_member_social is for posting
    prompt: "login", // Force login screen to allow account switching
  });

  return `${LI_OAUTH_BASE}/authorization?${params.toString()}`;
};

/**
 * Exchanges the auth code for a token and saves the LinkedIn connection.
 */
const handleLinkedInCallback = async (code, stateParam) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
    userId = decoded.userId;
  } catch {
    throw ApiError.badRequest("Invalid OAuth state parameter.");
  }

  if (!userId) throw ApiError.badRequest("Missing userId in OAuth state.");

  // 1. Exchange code for Access Token
  let tokenData;
  try {
    const res = await axios.post(
      `${LI_OAUTH_BASE}/accessToken`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    tokenData = res.data;
  } catch (err) {
    console.error("LinkedIn Token Exchange Error:", err.response?.data || err.message);
    throw ApiError.badRequest("Failed to exchange LinkedIn OAuth code for token.");
  }

  const accessToken = tokenData.access_token;

  // 2. Fetch User Profile (to get Member ID / URN)
  // We use the userinfo endpoint (OpenID Connect)
  let liUser;
  try {
    const res = await axios.get("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    liUser = res.data;
  } catch (err) {
    console.error("LinkedIn Profile Fetch Error:", err.response?.data || err.message);
    throw ApiError.internal("Failed to fetch LinkedIn user profile.");
  }

  const liMemberId = liUser.sub; // The 'sub' field is the unique member ID in OIDC
  const connectionData = {
    accessToken,
    liMemberId,
    liDisplayName: liUser.name || liUser.given_name + " " + liUser.family_name,
    liProfilePicture: liUser.picture || null,
  };

  const connection = await prisma.linkedInConnection.upsert({
    where: { userId },
    update: connectionData,
    create: { userId, ...connectionData },
  });

  // Also update the main user record for quick reference
  await prisma.user.update({
    where: { id: userId },
    data: { linkedInAccountId: liMemberId },
  });

  return connection;
};

/**
 * Returns connection details (excluding the access token).
 */
const getLinkedInConnection = async (userId) => {
  return prisma.linkedInConnection.findUnique({
    where: { userId },
    select: {
      id: true,
      liMemberId: true,
      liDisplayName: true,
      liProfilePicture: true,
      connectedAt: true,
    },
  });
};

/**
 * Disconnects LinkedIn.
 */
const disconnectLinkedIn = async (userId) => {
  await prisma.linkedInConnection.deleteMany({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data: { linkedInAccountId: null },
  });
  return { disconnected: true };
};

/**
 * Posts the article to LinkedIn.
 */
const pushArticleToLinkedIn = async (article, connection, caption, job = null) => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
  
  // Use snapshot from job if available, otherwise fallback to current article state
  const title = job?.title || article.title;
  const coverImage = job?.coverImage || article.coverImage;
  // 1. Ensure absolute Article URL
  const articleUrl = article.slug.startsWith("http") 
    ? article.slug 
    : `${clientUrl}/article/${article.slug}`;

  // 2. Normalize and Validate Thumbnail URL
  let thumbnail = coverImage || undefined;
  if (thumbnail) {
    // If it's a relative path, prepend clientUrl
    if (thumbnail.startsWith("/")) {
      thumbnail = `${clientUrl}${thumbnail}`;
    }
    // If it's a base64 string, LinkedIn will reject it, so we remove it
    if (thumbnail.startsWith("data:")) {
      console.warn("[LinkedIn] Removing base64 thumbnail (LinkedIn only supports public URLs)");
      thumbnail = undefined;
    }
  }

  // 3. Warn about localhost
  if (articleUrl.includes("localhost")) {
    console.warn("[LinkedIn] Warning: Using localhost URL. LinkedIn's crawler will not be able to fetch article metadata.");
  }

  // We use the modern 'v2/posts' API
  const postBody = {
    author: `urn:li:person:${connection.liMemberId}`,
    commentary: caption || title,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: {
      article: {
        source: articleUrl,
        title: title,
        description: article.summary || "",
        thumbnail: thumbnail,
      },
    },
    lifecycleState: "PUBLISHED",
  };

  try {
    const res = await axios.post(`${LI_API_BASE}/posts`, postBody, {
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      timeout: POST_PUBLISH_TIMEOUT_MS,
    });

    const postId = res.headers["x-restli-id"] || res.data?.id;
    return {
      liPostId: postId,
      liPostUrl: `https://www.linkedin.com/feed/update/${postId}`,
    };
  } catch (err) {
    const apiError = err.response?.data;
    console.error("LinkedIn Post Error Detail:", JSON.stringify(apiError, null, 2));
    
    const errorDetail = apiError?.message || err.message;
    throw new Error(`LinkedIn API failed: ${errorDetail}`);
  }
};

/**
 * Handles immediate or scheduled LinkedIn publishing.
 */
const scheduleLinkedInPublish = async (articleId, userId, scheduledAt, caption) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  const connection = await prisma.linkedInConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw ApiError.badRequest("LinkedIn is not connected.");
  }

  const jobBase = {
    articleId,
    userId,
    liConnId: connection.id,
    caption,
    title: article.title,
    coverImage: article.coverImage,
  };

  if (!scheduledAt) {
    // Immediate Publish
    if (article.status !== "PUBLISHED") {
      return { success: false, message: "Article is not published on Easy Blogger yet." };
    }

    try {
      const { liPostId, liPostUrl } = await pushArticleToLinkedIn(article, connection, caption);
      await prisma.linkedInPublishJob.create({
        data: { ...jobBase, scheduledAt: new Date(), status: "PUBLISHED", liPostId, liPostUrl },
      });
      return { success: true, message: "Published to LinkedIn!", liPostId, liPostUrl };
    } catch (err) {
      await prisma.linkedInPublishJob.create({
        data: { ...jobBase, scheduledAt: new Date(), status: "FAILED", errorMsg: err.message },
      });
      return { success: false, message: err.message };
    }
  }

  // Scheduled Publish
  const { registerLinkedInJob, cancelLinkedInJob } = require("../jobs/linkedin.job");

  const existingJob = await prisma.linkedInPublishJob.findFirst({
    where: { articleId, userId, status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  if (existingJob) {
    const updatedJob = await prisma.linkedInPublishJob.update({
      where: { id: existingJob.id },
      data: {
        scheduledAt: new Date(scheduledAt),
        caption,
        status: "PENDING",
        errorMsg: null,
        title: article.title,
        coverImage: article.coverImage,
      },
    });
    cancelLinkedInJob(updatedJob.id);
    registerLinkedInJob(updatedJob.id, updatedJob.scheduledAt);
    return { success: true, message: "LinkedIn schedule updated.", jobId: updatedJob.id };
  }

  const job = await prisma.linkedInPublishJob.create({
    data: { ...jobBase, scheduledAt: new Date(scheduledAt), status: "PENDING" },
  });
  registerLinkedInJob(job.id, job.scheduledAt);

  return { success: true, message: "LinkedIn post scheduled.", jobId: job.id };
};

const getLinkedInPublishStatus = async (articleId, userId) => {
  return prisma.linkedInPublishJob.findFirst({
    where: { articleId, userId },
    orderBy: { createdAt: "desc" },
  });
};

module.exports = {
  initiateLinkedInAuth,
  handleLinkedInCallback,
  getLinkedInConnection,
  disconnectLinkedIn,
  pushArticleToLinkedIn,
  scheduleLinkedInPublish,
  getLinkedInPublishStatus,
};
