import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 20,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    global._postgresPool.on('error', (err: Error & { code?: string }) => {
      const msg = String(err?.message || '');
      const code = String(err?.code || '');
      const isTransientIdleDisconnect =
        /connection terminated unexpectedly|terminating connection|server closed the connection|socket hang up|econnreset|etimedout|epipe/i.test(
          msg,
        ) ||
        ['57P01', '57P02', '57P03', '08006', '08003', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(
          code,
        );

      // Cloud SQL Developer (scale-to-zero) routinely closes idle TCP sockets;
      // pg.Pool automatically evicts the closed idle client and reconnects on the next query.
      if (isTransientIdleDisconnect) {
        return;
      }
      console.warn('SQL pool client notice:', msg || code || 'unknown_pool_error');
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
