// Apply Drizzle migrations. Chạy: `pnpm db:migrate`
// Generate trước bằng: `pnpm db:generate` sau khi đổi schema.

import { createLogger, loadEnv } from '@app/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from './client.js';

const log = createLogger('db-migrate');

async function main() {
  loadEnv();
  log.info('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  log.info('✓ Migrations done');
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    log.error({ err }, 'Migration failed');
    await closeDb();
    process.exit(1);
  });
