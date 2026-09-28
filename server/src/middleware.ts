import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ZodSchema } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import type { AuthUser, Role } from './services/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

/** Typed API error: thrown from services/routes, rendered by `errorHandler`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'CONFLICT', message, details);

export interface JwtClaims {
  sub: string;
  role: Role;
  name?: string;
}

export function signToken(claims: JwtClaims): string {
  return jwt.sign({ role: claims.role, name: claims.name }, config.jwt.secret, {
    subject: claims.sub,
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'freepay',
  });
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, config.jwt.secret, { issuer: 'freepay' }) as jwt.JwtPayload;
  if (!decoded.sub || !decoded.role) throw unauthorized('Malformed token');
  return { userId: decoded.sub, role: decoded.role as Role, name: decoded.name as string | undefined };
}

/** Verifies the Bearer JWT and attaches `req.user`. */
export const authMiddleware: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(unauthorized('Invalid or expired token'));
  }
};

/** Role gate. Always used AFTER authMiddleware. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden(`Requires role ${roles.join(' or ')}`));
    next();
  };
}

/** Validates `req.body` (or query) against a zod schema and replaces it with parsed data. */
export function validate<T>(schema: ZodSchema<T>, source: 'body' | 'query' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(badRequest('Validation failed', result.error.flatten()));
    }
    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
}

/** Wraps an async handler so rejections reach the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; code?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    return;
  }
  // Postgres unique violation -> 409, RLS violation -> 403.
  if (e?.code === '23505') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate record' } });
    return;
  }
  if (e?.code === '42501') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Row-level security denied this operation' } });
    return;
  }
  logger.error('unhandled error', { requestId: req.requestId, error: e?.message, code: e?.code });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
