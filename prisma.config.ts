import "dotenv/config";
import { defineConfig } from "prisma/config";

// prisma.config.ts — required by Prisma 6.19+ tooling.
//
// NOTE: The database URL still lives in schema.prisma (datasource block) because
// the Prisma 6.x schema engine binary reads the schema directly and does not yet
// pick up `datasource.url` from this file. This will change in Prisma v7.
//
// The VS Code Prisma extension may show a warning about `url` in schema.prisma;
// this is a false positive — the extension enforces v7 rules against v6 code.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
});
