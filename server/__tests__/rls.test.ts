/**
 * Row-level-security integration tests. They need the docker-compose Postgres with
 * migrations applied (npm run db:up && npm run db:migrate). When the database is not
 * reachable the suite is skipped so `npm test` stays green on a laptop without Docker.
 */
import type pg from 'pg';
import { checkDb, closeDb, withSystem, withUser, type DbUser } from '../src/db.js';

const PILGRIM_A = '11111111-1111-4111-8111-000000000001';
const PILGRIM_B = '11111111-1111-4111-8111-000000000002';
const VENDOR_SHANKAR = '22222222-2222-4222-8222-000000000001';
const VENDOR_GEETA = '22222222-2222-4222-8222-000000000002';
const MERCHANT_SHANKAR = '33333333-3333-4333-8333-000000000001';
const MERCHANT_GEETA = '33333333-3333-4333-8333-000000000002';
const ADMIN = '55555555-5555-4555-8555-000000000001';

class Rollback extends Error {}

/** Run assertions inside an RLS context and always roll back the writes. */
async function probe<T>(user: DbUser, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await withUser(user, async (c) => {
    out = await fn(c);
    throw new Rollback('rollback');
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
  return out as T;
}

const dbAvailable = await checkDb().then((r) => r.ok);
const maybe = dbAvailable ? describe : describe.skip;

if (!dbAvailable) {
  // eslint-disable-next-line no-console
  console.warn('[rls.test] database not reachable; skipping RLS integration tests');
}

maybe('row-level security', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('the API connects as a non-superuser role without BYPASSRLS', async () => {
    const row = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) => (await c.query('SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0]);
    expect(row.current_user).toBe('freepay_app');
    expect(row.rolsuper).toBe(false);
    expect(row.rolbypassrls).toBe(false);
  });

  it('every application table has RLS enabled and forced', async () => {
    const rows = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) =>
      (await c.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
                      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname NOT IN ('schema_migrations')`)).rows,
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect({ table: r.relname, rls: r.relrowsecurity, forced: r.relforcerowsecurity }).toEqual({ table: r.relname, rls: true, forced: true });
    }
  });

  it('a pilgrim only sees their own transactions', async () => {
    const rows = await probe({ userId: PILGRIM_A, role: 'PILGRIM' }, async (c) => (await c.query('SELECT DISTINCT payer_id FROM transactions')).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].payer_id).toBe(PILGRIM_A);
  });

  it('a pilgrim cannot read other users or admin accounts', async () => {
    const out = await probe({ userId: PILGRIM_A, role: 'PILGRIM' }, async (c) => ({
      users: (await c.query('SELECT id FROM users')).rows,
      admins: (await c.query('SELECT id FROM admin_users')).rows,
      profiles: (await c.query('SELECT id FROM public_profiles')).rows,
    }));
    expect(out.users.map((u: { id: string }) => u.id)).toEqual([PILGRIM_A]);
    expect(out.admins).toEqual([]);
    expect(out.profiles.length).toBeGreaterThan(1); // safe projection (name + avatar only) is allowed
  });

  it('a vendor only sees transactions of their own stall', async () => {
    const rows = await probe({ userId: VENDOR_SHANKAR, role: 'VENDOR' }, async (c) => (await c.query('SELECT DISTINCT merchant_id FROM transactions')).rows);
    expect(rows.map((r: { merchant_id: string }) => r.merchant_id)).toEqual([MERCHANT_SHANKAR]);
  });

  it("a vendor cannot insert a transaction for another vendor's stall", async () => {
    await expect(
      probe({ userId: VENDOR_SHANKAR, role: 'VENDOR' }, (c) =>
        c.query(
          `INSERT INTO transactions (id, nonce, payer_id, merchant_id, amount, mode, status, created_at)
           VALUES (gen_random_uuid(), encode(gen_random_bytes(16),'hex'), $1, $2, 100, 'OFFLINE', 'SYNCED', now())`,
          [PILGRIM_A, MERCHANT_GEETA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('financial fields are immutable even for admins (append-only ledger)', async () => {
    const id = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) => (await c.query('SELECT id FROM transactions LIMIT 1')).rows[0].id as string);
    await expect(probe({ userId: ADMIN, role: 'ADMIN' }, (c) => c.query('UPDATE transactions SET amount = amount + 1 WHERE id = $1', [id]))).rejects.toMatchObject({ code: '42501' });
    await expect(probe({ userId: ADMIN, role: 'ADMIN' }, (c) => c.query('UPDATE transactions SET merchant_id = $2 WHERE id = $1', [id, MERCHANT_GEETA]))).rejects.toMatchObject({ code: '42501' });
  });

  it('nobody can delete from the ledger', async () => {
    await expect(probe({ userId: ADMIN, role: 'ADMIN' }, (c) => c.query('DELETE FROM transactions WHERE true'))).rejects.toMatchObject({ code: '42501' });
    await expect(probe({ userId: VENDOR_SHANKAR, role: 'VENDOR' }, (c) => c.query('DELETE FROM transactions WHERE merchant_id = $1', [MERCHANT_SHANKAR]))).rejects.toMatchObject({ code: '42501' });
  });

  it('admins may annotate but a vendor may not', async () => {
    const id = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) => (await c.query('SELECT id FROM transactions LIMIT 1')).rows[0].id as string);
    const ok = await probe({ userId: ADMIN, role: 'ADMIN' }, (c) =>
      c.query(`INSERT INTO transaction_annotations (transaction_id, admin_id, kind, note) VALUES ($1, $2, 'NOTE', 'looks fine') RETURNING id`, [id, ADMIN]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      probe({ userId: VENDOR_SHANKAR, role: 'VENDOR' }, (c) => c.query(`INSERT INTO transaction_annotations (transaction_id, kind, note) VALUES ($1, 'NOTE', 'x')`, [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('the nonce is unique across all merchants (replay backstop at the database)', async () => {
    const nonce = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) => (await c.query('SELECT nonce FROM transactions LIMIT 1')).rows[0].nonce as string);
    await expect(
      probe({ userId: VENDOR_GEETA, role: 'VENDOR' }, (c) =>
        c.query(
          `INSERT INTO transactions (id, nonce, payer_id, merchant_id, amount, mode, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 100, 'OFFLINE', 'SYNCED', now())`,
          [nonce, PILGRIM_B, MERCHANT_GEETA],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('cross-tenant facts are only available as booleans through SECURITY DEFINER helpers', async () => {
    const nonce = await probe({ userId: ADMIN, role: 'ADMIN' }, async (c) => (await c.query('SELECT nonce FROM transactions WHERE merchant_id = $1 LIMIT 1', [MERCHANT_SHANKAR])).rows[0].nonce as string);
    const out = await probe({ userId: VENDOR_GEETA, role: 'VENDOR' }, async (c) => ({
      visible: (await c.query('SELECT 1 FROM transactions WHERE nonce = $1', [nonce])).rowCount,
      exists: (await c.query('SELECT app_nonce_exists($1) AS v', [nonce])).rows[0].v,
    }));
    expect(out.visible).toBe(0);
    expect(out.exists).toBe(true);
  });

  it('emergency locations are visible to responders only inside the sharing window', async () => {
    const out = await probe({ userId: PILGRIM_B, role: 'PILGRIM' }, async (c) => {
      const expired = (await c.query(
        `INSERT INTO emergencies (user_id, kind, lat, lng, expires_at) VALUES ($1, 'MEDICAL', 25.4, 81.8, now() - interval '1 minute') RETURNING id`,
        [PILGRIM_B],
      )).rows[0].id as string;
      const live = (await c.query(
        `INSERT INTO emergencies (user_id, kind, lat, lng, expires_at) VALUES ($1, 'MEDICAL', 25.4, 81.8, now() + interval '59 minutes') RETURNING id`,
        [PILGRIM_B],
      )).rows[0].id as string;
      // Switch identity inside the same transaction to observe as the responder.
      await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.role', 'ADMIN', true)`, [ADMIN]);
      const adminSees = (await c.query('SELECT id FROM emergencies WHERE id = ANY($1::uuid[])', [[expired, live]])).rows.map((r: { id: string }) => r.id);
      await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.role', 'PILGRIM', true)`, [PILGRIM_B]);
      const ownerSees = (await c.query('SELECT id FROM emergencies WHERE id = ANY($1::uuid[])', [[expired, live]])).rows.length;
      return { expired, live, adminSees, ownerSees };
    });
    expect(out.adminSees).toEqual([out.live]);
    expect(out.ownerSees).toBe(2);
  });

  it('the SYSTEM context can look up a user by phone but cannot read the ledger', async () => {
    const out = await withSystem(async (c) => ({
      user: (await c.query('SELECT id FROM users WHERE phone = $1', ['9000000001'])).rows[0],
      txns: (await c.query('SELECT id FROM transactions')).rowCount,
    }));
    expect(out.user.id).toBe(PILGRIM_A);
    expect(out.txns).toBe(0);
  });
});
