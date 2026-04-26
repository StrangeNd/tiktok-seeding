import { defineConfig } from 'drizzle-kit';

// Env được inject bởi `dotenv -e ../../.env --` wrapper trong npm script.
// Nếu chạy drizzle-kit thủ công, set DATABASE_URL trước.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL chưa set. Dùng `pnpm db:generate` (đã wrap dotenv-cli) hoặc set ENV thủ công.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
