import type { RequestHandler } from 'express';
import { ApiError } from './middleware.js';

/**
 * Small in-memory sliding-window rate limiter. Good enough for a single API node and
 * for keeping brute-force attempts on /auth endpoints cheap to block. Swap for a
 * Redis-backed store when running multiple instances.
 */
interface Bucket {
  hits: number[];
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Derive the bucket key; defaults to client IP. */
  key?: (req: Parameters<RequestHandler>[0]) => string;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  const sweep = (now: number) => {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => now - t < opts.windowMs);
      if (b.hits.length === 0) buckets.delete(k);
    }
  };

  return (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const key = opts.key ? opts.key(req) : req.ip ?? 'unknown';
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);
    if (bucket.hits.length >= opts.max) {
      const retryAfterSec = Math.ceil((opts.windowMs - (now - bucket.hits[0])) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(new ApiError(429, 'RATE_LIMITED', opts.message ?? 'Too many requests, slow down'));
    }
    bucket.hits.push(now);
    buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.max - bucket.hits.length)));
    next();
  };
}

/** Preconfigured limiters. */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many login attempts' });
export const apiLimiter = rateLimit({ windowMs: 60_000, max: 600 });
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req) => req.user?.userId ?? req.ip ?? 'anon',
  message: 'Assistant is busy, try again in a minute',
});
