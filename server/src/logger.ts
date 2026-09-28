import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal structured (JSON lines) logger. One object per line so it is trivially
 * shippable to any log pipeline. Never logs secrets: callers pass explicit fields.
 */
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  if (config.isTest && level !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

type LogFn = (msg: string, fields?: Record<string, unknown>) => void;
export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  child: (base: Record<string, unknown>) => Logger;
}

function make(base: Record<string, unknown>): Logger {
  return {
    debug: (msg, fields) => write('debug', msg, { ...base, ...fields }),
    info: (msg, fields) => write('info', msg, { ...base, ...fields }),
    warn: (msg, fields) => write('warn', msg, { ...base, ...fields }),
    error: (msg, fields) => write('error', msg, { ...base, ...fields }),
    child: (extra) => make({ ...base, ...extra }),
  };
}

export const logger: Logger = make({});

/** Attaches a request id and logs each request with its latency and status. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  req.requestId = requestId;

  if (config.isTest) return next();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level: Level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    write(level, 'http', {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(ms * 10) / 10,
      userId: req.user?.userId,
      role: req.user?.role,
    });
  });
  next();
}
