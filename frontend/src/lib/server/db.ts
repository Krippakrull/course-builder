import { env } from '$env/dynamic/private';
import { Pool } from 'pg';

const databaseUrl = env.DATABASE_URL;

let pool: Pool | undefined;
let schemaPromise: Promise<void> | null = null;

export function isDatabaseConfigured() {
  return Boolean(databaseUrl);
}

export function getPool() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
    pool.on('error', (error) => {
      console.error('Unexpected database error', error);
    });
  }

  return pool;
}

async function ensureSchema(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS courses (
      course_id uuid PRIMARY KEY,
      title text NOT NULL,
      language text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS modules (
      module_id uuid PRIMARY KEY,
      course_id uuid REFERENCES courses(course_id) ON DELETE CASCADE,
      title text NOT NULL,
      position int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      lesson_id uuid PRIMARY KEY,
      module_id uuid REFERENCES modules(module_id) ON DELETE CASCADE,
      title text NOT NULL,
      position int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function ensureDatabase() {
  if (!isDatabaseConfigured()) {
    return;
  }

  if (!schemaPromise) {
    const db = getPool();
    schemaPromise = ensureSchema(db).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  await schemaPromise;
}
