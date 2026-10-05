import fs from 'fs';
import path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

const DB_DIR = path.resolve(process.cwd(), 'database');
const DB_FILE = path.join(DB_DIR, 'store.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let dbInstance: Database | null = null;
let SQL: SqlJsStatic | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    dbInstance = new SQL.Database(buffer);
  } else {
    dbInstance = new SQL.Database();
  }

  return dbInstance;
}

export function saveDb(): void {
  if (!dbInstance) return;
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

export function queryAll<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function execute(sql: string, params: any[] = []): { lastInsertRowid: number; changes: number } {
  if (!dbInstance) throw new Error('Database not initialized');
  
  if (params && params.length > 0) {
    const stmt = dbInstance.prepare(sql);
    stmt.run(params);
    stmt.free();
  } else {
    dbInstance.run(sql);
  }

  // Get last insert rowid
  const rowidRes = dbInstance.exec('SELECT last_insert_rowid() as id, changes() as chg');
  let lastInsertRowid = 0;
  let changes = 0;
  if (rowidRes.length > 0 && rowidRes[0].values.length > 0) {
    lastInsertRowid = Number(rowidRes[0].values[0][0]) || 0;
    changes = Number(rowidRes[0].values[0][1]) || 0;
  }

  saveDb();
  return { lastInsertRowid, changes };
}
