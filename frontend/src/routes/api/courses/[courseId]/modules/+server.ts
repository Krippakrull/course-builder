import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function POST({ params, request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const courseId = params.courseId ?? '';
  if (!isUuid(courseId)) {
    throw error(400, 'courseId must be a valid UUID');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';

  if (!title) {
    throw error(400, 'title is required');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureDatabase();
    await client.query('BEGIN');

    const courseExists = await client.query('SELECT 1 FROM courses WHERE course_id = $1', [courseId]);

    if (courseExists.rowCount === 0) {
      await client.query('ROLLBACK');
      throw error(404, 'Course not found');
    }

    const positionResult = await client.query<{ position: string | number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM modules WHERE course_id = $1`,
      [courseId]
    );

    const rawPosition = positionResult.rows[0]?.position ?? 0;
    const position = Number(rawPosition);
    const moduleId = randomUUID();

    const insertedModule = await client.query(
      `INSERT INTO modules (module_id, course_id, title, position)
       VALUES ($1, $2, $3, $4)
       RETURNING module_id, title, position`,
      [moduleId, courseId, title, Number.isFinite(position) ? position : 0]
    );

    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [courseId]);

    await client.query('COMMIT');

    const module = insertedModule.rows[0];

    return json(
      {
        moduleId: module.module_id,
        title: module.title,
        position: module.position,
        lessons: [],
      },
      { status: 201 }
    );
  } catch (cause) {
    await client.query('ROLLBACK');

    if (cause instanceof Response) {
      throw cause;
    }

    console.error('Failed to create module', cause);
    throw error(500, 'Failed to create module');
  } finally {
    client.release();
  }
}
