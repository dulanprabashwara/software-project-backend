import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function exportAllData() {
  console.log("🔍 Locating all database tables...");
  
  // Prisma.ModelName is an object like { User: 'User', Article: 'Article' }
  const modelNames = Object.values(Prisma.ModelName);
  
  const fullBackup: Record<string, any[]> = {};

  for (const modelName of modelNames) {
    // Convert 'User' to 'user' to match the prisma.user.findMany() syntax
    const propertyName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    
    try {
      console.log(`📦 Fetching data from: ${modelName}...`);
      
      // Access the model dynamically
      const records = await (prisma as any)[propertyName].findMany();
      
      fullBackup[modelName] = records;
      console.log(`✅ Extracted ${records.length} records from ${modelName}.`);
    } catch (error) {
      // Some models might be specialized or missing from the client, we skip those
      console.warn(`⚠️ Could not extract ${modelName}:`, error.message);
    }
  }

  const fileName = 'full_db_backup.json';
  fs.writeFileSync(fileName, JSON.stringify(fullBackup, null, 2));
  
  console.log("\n" + "=".repeat(40));
  console.log(`🎉 BACKUP COMPLETE: ${fileName}`);
  console.log("=".repeat(40));
}

exportAllData()
  .catch((e) => console.error("FATAL ERROR:", e))
  .finally(async () => await prisma.$disconnect());