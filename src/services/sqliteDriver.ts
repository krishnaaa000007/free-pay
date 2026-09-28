/**
 * Native SQLite driver (iOS/Android). Metro picks `sqliteDriver.web.ts` on web, so the
 * expo-sqlite WASM worker never enters the web bundle.
 */
import * as SQLite from 'expo-sqlite';

export type SqliteDb = SQLite.SQLiteDatabase;

export async function openSqlite(name: string): Promise<SqliteDb | null> {
  return SQLite.openDatabaseAsync(name);
}
