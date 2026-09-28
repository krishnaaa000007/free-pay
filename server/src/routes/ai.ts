import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ApiError, asyncHandler, authMiddleware, validate } from '../middleware.js';
import { aiLimiter } from '../rateLimit.js';

/**
 * AI assistant proxy. The mobile app never holds the OpenAI key; it talks to this route,
 * which adds a Free Pay system prompt and forwards to OpenAI. Returns 503 when no key is
 * configured so the app can fall back to its built-in offline FAQ answers.
 */
export const aiRouter = Router();
aiRouter.use(authMiddleware, aiLimiter);

const schema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) })).min(1).max(20),
  context: z
    .object({
      role: z.string().optional(),
      screen: z.string().optional(),
      language: z.string().optional(),
      pending_sync: z.number().optional(),
      online: z.boolean().optional(),
    })
    .optional(),
});

const SYSTEM_PROMPT = `You are the Free Pay assistant, the in-app helper for Free Pay, an offline-first payments and safety app used at large pilgrimage events (melas).
Answer briefly (max 4 sentences), warmly and practically. Key facts:
- Pilgrims pay by showing a signed QR; vendors verify it offline and it syncs later. Offline limits: INR 2000 per payment, INR 5000 per rolling day. Offline credentials expire after 10 days.
- Vendors see PENDING_SYNC -> SYNCED -> SETTLED. Settlement is requested from the Settlement tab.
- SOS shares location with responders for 60 minutes. Emergency numbers: Mela Control Room 1077, Police 112, Ambulance 108, Lost & Found 1098.
- Crowd map shows density and suggests less crowded routes.
If asked about anything unsafe or medical beyond first response advice, direct the user to the Medical Post / 108.
Reply in the user's language when the context says so (hi = Hindi, mr = Marathi, gu = Gujarati, ta = Tamil).`;

aiRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    if (!config.openai.apiKey) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'AI assistant is not configured on this server');
    }
    const body = req.body as z.infer<typeof schema>;
    const ctx = body.context ?? {};
    const contextLine = `Context: role=${ctx.role ?? req.user?.role ?? 'unknown'}, screen=${ctx.screen ?? 'unknown'}, language=${ctx.language ?? 'en'}, online=${ctx.online ?? true}, pending_sync=${ctx.pending_sync ?? 0}.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openai.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.openai.model,
          temperature: 0.4,
          max_tokens: 300,
          messages: [{ role: 'system', content: SYSTEM_PROMPT + '\n' + contextLine }, ...body.messages],
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        logger.warn('openai error', { status: response.status, body: text.slice(0, 300) });
        throw new ApiError(502, 'AI_UPSTREAM', 'Assistant is temporarily unavailable');
      }
      const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: unknown };
      const reply = json.choices?.[0]?.message?.content?.trim() ?? '';
      res.json({ reply, model: json.model ?? config.openai.model, usage: json.usage });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(504, 'AI_TIMEOUT', 'Assistant took too long to respond');
    } finally {
      clearTimeout(timer);
    }
  }),
);
