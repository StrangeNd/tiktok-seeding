// Minimal HTTP JSON helper dùng node:http (fetch cũng được nhưng node:http overhead thấp hơn).

import http from 'node:http';
import { URL } from 'node:url';

export interface HttpJsonOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface HttpJsonResult<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

export function httpJson<T = unknown>(
  url: string,
  { method = 'GET', body, timeoutMs = 10_000, headers = {} }: HttpJsonOptions = {},
): Promise<HttpJsonResult<T>> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(data ? { 'Content-Length': String(data.length) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = text;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              // not JSON, giữ string
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: parsed as T,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`HTTP timeout ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
