const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seeding...");

  // 1. Create an Admin User (if not exists)
  // We use a dummy Firebase UID for seeding. In production, this should match a real Firebase user.
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
