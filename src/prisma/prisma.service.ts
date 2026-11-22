import 'dotenv/config';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { Pool } from 'pg';

function createPrismaAdapter(): { pool: Pool; adapter: PrismaPg } {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString && process.env.NODE_ENV !== 'test') {
    throw new Error('DATABASE_URL environment variable must be configured');
  }

  const isServerless = Boolean(process.env.VERCEL);
  const configuredMax = Number(process.env.PG_POOL_MAX);
  const max =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? Math.trunc(configuredMax)
      : isServerless
        ? 2
        : 10;

  const pool = new Pool({
    connectionString: connectionString || 'postgresql://localhost:5432/test_db',
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  });
  const adapter = new PrismaPg(pool);
  return { pool, adapter };
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const { pool, adapter } = createPrismaAdapter();
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL) {
      return;
    }

    try {
      await this.$connect();
    } catch (error) {
      const pgCode = (error as { code?: string })?.code;
      // PostgreSQL 3D000 = database does not exist
      if (pgCode === '3D000' && process.env.DATABASE_URL) {
        await this.ensureDatabaseExists(process.env.DATABASE_URL);
        await this.$connect();
      } else {
        throw error;
      }
    }
  }

  private async ensureDatabaseExists(databaseUrl: string): Promise<void> {
    const parsed = new URL(databaseUrl);
    const dbName = parsed.pathname.replace(/^\//, '');
    if (!dbName || !/^[a-zA-Z0-9_]+$/.test(dbName)) {
      throw new Error(
        `Invalid target database name in DATABASE_URL: "${dbName}"`,
      );
    }

    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/postgres';
    adminUrl.searchParams.delete('schema');

    const adminPool = new Pool({ connectionString: adminUrl.toString() });
    try {
      const exists = await adminPool.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName],
      );
      if (exists.rowCount === 0) {
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
        this.logger.log(`Created missing PostgreSQL database "${dbName}"`);
      }
    } finally {
      await adminPool.end();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }

  /**
   * Generates a unique sequential reference (e.g. INQ-2026-0001)
   * atomically inside an existing transaction or standalone.
   */
  async nextReference(
    tx: Prisma.TransactionClient,
    prefix: 'INQ' | 'QUO' | 'BKG',
    year = new Date().getUTCFullYear(),
  ): Promise<string> {
    const seq = await tx.sequenceCounter.upsert({
      where: {
        prefix_year: { prefix, year },
      },
      create: {
        prefix,
        year,
        lastValue: 1,
      },
      update: {
        lastValue: { increment: 1 },
      },
    });
    const padded = String(seq.lastValue).padStart(4, '0');
    return `${prefix}-${year}-${padded}`;
  }
}
