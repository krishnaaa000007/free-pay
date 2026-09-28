/** Web build: no native SQLite; the ledger falls back to its in-memory implementation. */
export type SqliteDb = never;

export async function openSqlite(_name: string): Promise<SqliteDb | null> {
  return null;
}
