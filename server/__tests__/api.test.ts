import request from 'supertest';
import { createApp } from '../src/app.js';
import { signToken } from '../src/middleware.js';
import { PILGRIM_ID } from './helpers.js';

/** HTTP-level behaviour that needs no database. */
const app = createApp();

describe('health', () => {
  it('GET /health reports liveness', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, service: 'freepay-api', platform_kid: 'test-kid' });
  });
});

describe('auth middleware', () => {
  it('rejects requests without a bearer token', async () => {
    const r = await request(app).get('/api/transactions');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects malformed tokens', async () => {
    const r = await request(app).get('/api/transactions').set('authorization', 'Bearer nope');
    expect(r.status).toBe(401);
  });

  it('enforces roles before touching the database', async () => {
    const pilgrim = signToken({ sub: PILGRIM_ID, role: 'PILGRIM' });
    const r = await request(app).get('/api/admin/overview').set('authorization', `Bearer ${pilgrim}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');

    const vendorOnly = await request(app).post('/api/transactions/sync').set('authorization', `Bearer ${pilgrim}`).send({});
    expect(vendorOnly.status).toBe(403);
  });

  it('validates bodies before role-protected handlers run', async () => {
    const r = await request(app).post('/api/auth/login').send({ phone: '123', password: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for malformed JSON', async () => {
    const r = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{"phone":');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('BAD_JSON');
  });
});

describe('misc', () => {
  it('404s unknown routes with a JSON body', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('AI proxy returns 503 when OPENAI_API_KEY is not configured', async () => {
    const token = signToken({ sub: PILGRIM_ID, role: 'PILGRIM' });
    const r = await request(app).post('/api/ai').set('authorization', `Bearer ${token}`).send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('emergency contacts are public and configurable', async () => {
    const r = await request(app).get('/api/emergency/contacts');
    expect(r.status).toBe(200);
    expect(r.body.contacts).toEqual(expect.arrayContaining([{ label: 'Police', number: '112' }]));
    expect(r.body.share_ttl_min).toBe(60);
  });

  it('exposes the platform public key', async () => {
    const r = await request(app).get('/api/auth/platform-key');
    expect(r.status).toBe(200);
    expect(r.body.kid).toBe('test-kid');
    expect(r.body.public_key).toHaveLength(44);
  });

  it('sets rate limit headers', async () => {
    const r = await request(app).get('/api/auth/platform-key');
    expect(r.headers['x-ratelimit-limit']).toBeDefined();
    expect(r.headers['x-request-id']).toBeDefined();
  });
});

/**
 * The demo relay. It carries the exact QR string one window is displaying to the window
 * doing the "scanning", standing in for a camera that cannot see a second monitor. It is a
 * presentation aid only: nothing here verifies, signs or persists anything.
 */
describe('demo relay', () => {
  const token = signToken({ sub: PILGRIM_ID, role: 'PILGRIM' });
  const auth = (r: request.Test) => r.set('authorization', `Bearer ${token}`);
  const publish = (kind: string, payload: string) => auth(request(app).post('/api/demo/relay')).send({ kind, payload });
  const poll = (since: number, kinds?: string) => auth(request(app).get('/api/demo/relay').query({ since, ...(kinds ? { kinds } : {}) }));

  it('requires authentication', async () => {
    const r = await request(app).get('/api/demo/relay');
    expect(r.status).toBe(401);
  });

  it('hands a published code to a reader waiting past its cursor', async () => {
    const before = (await poll(0)).body.seq as number;
    const pub = await publish('MERCHANT', '{"t":"FREEPAY_MERCHANT","merchant_id":"m-1"}');
    expect(pub.status).toBe(200);
    expect(pub.body.seq).toBe(before + 1);

    const r = await poll(before);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ seq: before + 1, kind: 'MERCHANT', payload: '{"t":"FREEPAY_MERCHANT","merchant_id":"m-1"}' });

    // Reading again from the advanced cursor yields nothing: each code is delivered once.
    expect((await poll(r.body.seq)).body.items).toHaveLength(0);
  });

  it('filters by kind so a scanner only sees codes meant for it', async () => {
    const start = (await poll(0)).body.seq as number;
    await publish('QR', '{"t":"FREEPAY_PAY","nonce":"a"}');
    await publish('RECEIPT', '{"t":"FREEPAY_RECEIPT","nonce":"b"}');

    const merchantOnly = await poll(start, 'MERCHANT');
    expect(merchantOnly.body.items).toHaveLength(0);

    const both = await poll(start, 'QR,RECEIPT');
    expect(both.body.items.map((i: { kind: string }) => i.kind)).toEqual(['QR', 'RECEIPT']);
  });

  it('rejects payloads that could not be a QR code', async () => {
    expect((await publish('MERCHANT', 'tiny')).status).toBe(400);
    expect((await publish('NONSENSE', 'a-long-enough-payload')).status).toBe(400);
    expect((await publish('QR', 'x'.repeat(8001))).status).toBe(400);
  });

  it('keeps only a short window of recent codes', async () => {
    for (let i = 0; i < 25; i++) await publish('QR', `{"t":"FREEPAY_PAY","n":${i}}`);
    const r = await poll(0);
    expect(r.body.items.length).toBeLessThanOrEqual(20);
  });
});
