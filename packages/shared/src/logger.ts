import pino, { type Logger as PinoLogger } from 'pino';
import { loadEnv } from './env.js';

export type Logger = PinoLogger;

/**
 * Tạo logger có scope theo tên service.
 * Dev: pretty-print màu; Prod: JSON 1 dòng (cho log shipping).
 */
export function createLogger(name: string): Logger {
  const env = loadEnv();
  return pino({
    name,
    level: env.LOG_LEVEL,
    base: { service: name, env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname,service,env',
              singleLine: false,
              messageFormat: '[{service}] {msg}',
            },
          }
        : undefined,
    redact: {
      // Tránh log nhạy cảm
      paths: ['password', '*.password', 'cookie', '*.cookie', 'token', 'apiKey'],
      remove: true,
    },
  });
}
