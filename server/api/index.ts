/**
 * Serverless entry for the Free Pay API (Vercel).
 *
 * `src/index.ts` is the long-running process: it binds a port, probes the database and
 * installs signal handlers. None of that applies to a function that is started per request,
 * so this entry does the one thing that does — hand Vercel the Express app.
 *
 * Everything else is identical to running locally, including row-level security: each
 * request still goes through withUser(), which opens a transaction and sets app.user_id /
 * app.role before touching a table.
 */
import { createApp } from '../src/app.js';

export default createApp();
