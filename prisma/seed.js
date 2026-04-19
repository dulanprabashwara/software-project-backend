const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seeding...");

  // 1. Create an Admin User (if not exists)
  const adminEmail = "admin@easyblogger.com";
  const adminUid = "admin-seed-uid-123";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      username: "superadmin",
      displayName: "Super Admin",
      firebaseUid: adminUid,
      role: "ADMIN",
      isPremium: true,
      bio: "I am the system administrator.",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin",
    },
  });

  console.log(`✅ Admin user upserted: ${admin.username}`);

  // 2. Create Trending Topics
  const topics = [
    "Technology",
    "Health",
    "Travel",
    "Science",
    "Programming",
    "AI",
    "Startups",
  ];

  for (const name of topics) {
    await prisma.trendingTopic.upsert({
      where: { name },
      update: { hitCount: { increment: 1 } },
      create: { name, hitCount: 1 },
    });
  }

  console.log(`✅ Seeded ${topics.length} trending topics.`);

  // 3. Create a detailed example article
  const article = await prisma.article.upsert({
    where: { slug: "welcome-to-easy-blogger" },
    update: {},
    create: {
      title: "Welcome to Easy Blogger",
      slug: "welcome-to-easy-blogger",
      content: "<p>Welcome to the platform! This is a seeded article.</p>",
      summary: "This is the very first article on the platform.",
      status: "PUBLISHED",
      authorId: admin.id,
      readingTime: 1,
      tags: ["Welcome", "Platform"],
      publishedAt: new Date(),
    },
  });

  console.log(`✅ Seeded article: ${article.title}`);

  // 4. Initialize Singletons
  await prisma.adminDashboard.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  await prisma.aiConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  console.log("✅ Initialized singletons (Dashboard, AI Config).");

  // ─────────────────────────────────────────────────────────────────────────────
  // NEW SEED DATA
  // ─────────────────────────────────────────────────────────────────────────────

  // 5. Create 5 New Users
  console.log("👥 Seeding 5 new users...");
  const createdUsers = [admin]; // Include admin in the pool for actions
  for (let i = 1; i <= 5; i++) {
    const user = await prisma.user.upsert({
      where: { email: `user${i}@example.com` },
      update: {},
      create: {
        email: `user${i}@example.com`,
        username: `blogger_hero_${i}`,
        displayName: `Blogger ${i}`,
        firebaseUid: `firebase-uid-user-${i}`,
        bio: `Bio for user ${i}`,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=user${i}`,
      },
    });
    createdUsers.push(user);
  }

  // 6. Create 20 Articles
  console.log("📝 Seeding 20 articles...");
  const createdArticles = [];
  for (let i = 1; i <= 20; i++) {
    const randomAuthor = createdUsers[Math.floor(Math.random() * createdUsers.length)];
    const newArticle = await prisma.article.upsert({
      where: { slug: `article-slug-${i}` },
      update: {},
      create: {
        title: `Interesting Article Title #${i}`,
        slug: `article-slug-${i}`,
        content: `<p>This is the detailed content for article number ${i}. It contains a lot of interesting information.</p>`,
        summary: `Short summary for article ${i}`,
        status: "PUBLISHED",
        authorId: randomAuthor.id,
        publishedAt: new Date(),
        tags: ["Test", "Seeded"],
        likeCount: 0, // Will be updated by actual likes below
      },
    });
    createdArticles.push(newArticle);
  }

  // 7. Add Likes to Articles
  console.log("❤️ Seeding article likes...");
  for (const art of createdArticles) {
    // Each article gets 1-4 random likes
    const numLikes = Math.floor(Math.random() * 4) + 1;
    const shuffledUsers = [...createdUsers].sort(() => 0.5 - Math.random());
    const selectedUsers = shuffledUsers.slice(0, numLikes);

    for (const u of selectedUsers) {
      try {
        await prisma.articleLike.create({
          data: {
            userId: u.id,
            articleId: art.id,
          },
        });
        // Increment the likeCount on the article to keep denormalized data in sync
        await prisma.article.update({
          where: { id: art.id },
          data: { likeCount: { increment: 1 } },
        });
      } catch (err) {
        // Skip if unique constraint (user already liked article) hits
      }
    }
  }

  // 8. Add 12 Reports (Reported Articles)
  console.log("🚩 Seeding 12 reported articles...");
  const reportReasons = ["Spam", "Harassment", "Inappropriate", "Misinformation"];
  for (let i = 0; i < 12; i++) {
    const targetArticle = createdArticles[i % createdArticles.length];
    // Use users starting from index 1 (non-admin) as reporters
    const reporter = createdUsers[(i % 5) + 1]; 

    await prisma.reportedArticle.create({
      data: {
        reason: reportReasons[i % reportReasons.length],
        details: "Automated flag for testing moderation UI.",
        status: "PENDING",
        articleId: targetArticle.id,
        reporterId: reporter.id,
      },
    });
  }

  // 9. Add 8 Trending Topics
  console.log("📈 Seeding 8 specific trending topics...");
  const trendingNames = [
    "Web3", "Remote Work", "Fitness", "Cooking",
    "Mental Health", "Gadgets", "Economy", "Environment"
  ];

  for (let i = 0; i < 8; i++) {
    await prisma.trendingTopic.upsert({
      where: { name: trendingNames[i] },
      update: { hitCount: { increment: 500 } },
      create: {
        name: trendingNames[i],
        hitCount: Math.floor(Math.random() * 1000) + 500,
      },
    });
  }

  console.log("🌱 Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });