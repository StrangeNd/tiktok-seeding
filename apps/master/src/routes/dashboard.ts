import { createReadStream, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dashboard/dist');
const dashboardIndex = resolve(dashboardRoot, 'index.html');

export function isDashboardAssetRequest(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return path === '/' || path === '/dashboard' || path.startsWith('/dashboard/');
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  if (!existsSync(dashboardIndex)) {
    app.log.warn(
      { dashboardRoot },
      'Dashboard build not found; run pnpm build:dashboard before using production dashboard serving',
    );
    app.get('/', async (_req, reply) =>
      reply.code(503).send({ error: 'dashboard_not_built', message: 'Run pnpm build:dashboard.' }),
    );
    return;
  }

  await app.register(fastifyStatic, {
    root: dashboardRoot,
    prefix: '/dashboard/',
    decorateReply: false,
  });

  app.get('/', async (_req, reply) => reply.redirect('/dashboard/'));
  app.get('/dashboard', async (_req, reply) => reply.redirect('/dashboard/'));

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (isDashboardAssetRequest(req.method, path)) {
      return reply.type('text/html; charset=utf-8').send(createReadStream(dashboardIndex));
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}
