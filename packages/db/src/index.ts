import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot-reloads / serverless invocations.
// In Docker each api replica gets its own process-level singleton, which is
// exactly what Prisma recommends for long-lived Node processes.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
export * from "@prisma/client";
