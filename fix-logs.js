const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function fixAiLogs() {
  console.log("🛠️  Starting targeted restore for: ai_article_logs");

  const backupPath = path.join(__dirname, "full_database_backup.json");
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  
  // Access the specific table data from your JSON
  const logData = backup.tables["ai_article_logs"];

  if (!logData || logData.length === 0) {
    console.log("❌ No data found for ai_article_logs in the backup file.");
    return;
  }

  console.log(`📡 Processing ${logData.length} records...`);

  for (const record of logData) {
    // 1. Map the database column name back to the Prisma field name
    // JSON has 'savedToDraftId', Prisma expects 'linkedArticleId'
    const cleanRecord = { 
      ...record,
      linkedArticleId: record.savedToDraftId, 
    };
    
    // Remove the old key so Prisma doesn't get confused
    delete cleanRecord.savedToDraftId;

    try {
      await prisma.ai_article_logs.upsert({
        where: { id: cleanRecord.id },
        update: cleanRecord,
        create: cleanRecord,
      });
    } catch (err) {
      console.warn(`⚠️  Failed to restore record ${record.id}: ${err.message}`);
    }
  }

  console.log("✅ Target restoration complete!");
}

fixAiLogs()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());