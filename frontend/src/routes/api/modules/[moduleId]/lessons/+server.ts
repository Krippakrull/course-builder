import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function POST({ params, request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const moduleId = params.moduleId ?? '';
  if (!isUuid(moduleId)) {
    throw error(400, 'moduleId must be a valid UUID');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';

  if (!title) {
    throw error(400, 'title is required');
  }

  const pool = getPool();
  const client = await pool.connect();
  let transactionActive = false;

  try {
    await ensureDatabase();
    await client.query('BEGIN');
    transactionActive = true;

    const moduleResult = await client.query<{ course_id: string }>(
      'SELECT course_id FROM modules WHERE module_id = $1',
      [moduleId]
    );

    const moduleRow = moduleResult.rows[0];

    if (!moduleRow) {
      await client.query('ROLLBACK');
      transactionActive = false;
      throw error(404, 'Module not found');
    }

    const positionResult = await client.query<{ position: string | number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM lessons WHERE module_id = $1`,
      [moduleId]
    );

    const rawPosition = positionResult.rows[0]?.position ?? 0;
    const position = Number(rawPosition);
    const lessonId = randomUUID();

    const insertedLesson = await client.query(
      `INSERT INTO lessons (lesson_id, module_id, title, position)
       VALUES ($1, $2, $3, $4)
       RETURNING lesson_id, title, position`,
      [lessonId, moduleId, title, Number.isFinite(position) ? position : 0]
    );

    await client.query('UPDATE modules SET updated_at = NOW() WHERE module_id = $1', [moduleId]);
    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [moduleRow.course_id]);

    await client.query('COMMIT');
    transactionActive = false;

    const lesson = insertedLesson.rows[0];

    return json(
      {
        lessonId: lesson.lesson_id,
        title: lesson.title,
        position: lesson.position,
      },
      { status: 201 }
    );
  } catch (cause) {
    if (transactionActive) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback transaction', rollbackError);
      }
      transactionActive = false;
    }

    if (cause instanceof Response) {
      throw cause;
    }

    console.error('Failed to create lesson', cause);
    throw error(500, 'Failed to create lesson');
  } finally {
    client.release();
  }
}
