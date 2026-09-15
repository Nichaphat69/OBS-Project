/**
 * Singleton PrismaClient — shared by apps/api (and the migration script).
 *
 * Reuses the same client across hot-reloads / multiple imports within one process instead of
 * opening a new connection pool each time (the classic Prisma-in-dev pitfall).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export default prisma;
