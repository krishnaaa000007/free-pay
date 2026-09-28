import type pg from 'pg';

/** Append a row to the audit log inside the caller's transaction. */
export async function audit(
  client: pg.PoolClient,
  entry: {
    actorId: string | null;
    actorRole: string;
    action: string;
    entity?: string;
    entityId?: string | null;
    meta?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.actorId, entry.actorRole, entry.action, entry.entity ?? null, entry.entityId ?? null, entry.meta ?? null],
  );
}
