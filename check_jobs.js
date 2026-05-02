const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobs() {
  try {
    const jobs = await prisma.linkedInPublishJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        article: {
          select: { title: true }
        }
      }
    });

    if (jobs.length === 0) {
      console.log('No LinkedIn publish jobs found.');
      return;
    }

    console.log('Latest LinkedIn Publish Jobs:');
    jobs.forEach(job => {
      console.log(`- Article: ${job.article.title}`);
      console.log(`  Status: ${job.status}`);
      console.log(`  Created: ${job.createdAt}`);
      if (job.liPostUrl) console.log(`  Link: ${job.liPostUrl}`);
      if (job.errorMsg) console.log(`  Error: ${job.errorMsg}`);
      console.log('---');
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkJobs();
