import { json } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';

export async function GET() {
  if (!isDatabaseConfigured()) {
    return json({ status: 'ok', database: 'not configured' });
  }

  try {
    await ensureDatabase();
    const pool = getPool();
    const { rows } = await pool.query<{ now: string }>('SELECT NOW()');

    return json({ status: 'ok', database: 'connected', timestamp: rows[0]?.now });
  } catch (error) {
    console.error('Health check failed', error);
    return json(
      { status: 'error', message: error instanceof Error ? error.message : 'Failed to query database' },
      { status: 500 }
    );
  }
}
