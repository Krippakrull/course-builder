import { json, error } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function PATCH({ params, request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const moduleId = params.moduleId ?? '';
  if (!isUuid(moduleId)) {
    throw error(400, 'moduleId must be a valid UUID');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const lessonIdsValue = payload.lessonIds;

  if (!Array.isArray(lessonIdsValue) || lessonIdsValue.length === 0) {
    throw error(400, 'lessonIds must be a non-empty array');
  }

  const lessonIds = lessonIdsValue.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean);

  if (lessonIds.length !== lessonIdsValue.length) {
    throw error(400, 'lessonIds must contain only strings');
  }

  const uniqueLessonIds = new Set(lessonIds);
  if (uniqueLessonIds.size !== lessonIds.length) {
    throw error(400, 'lessonIds must be unique');
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

    const courseId = moduleRow.course_id;

    const existingLessons = await client.query<{ lesson_id: string }>(
      'SELECT lesson_id FROM lessons WHERE module_id = $1',
      [moduleId]
    );

    if (existingLessons.rows.length !== lessonIds.length) {
      await client.query('ROLLBACK');
      transactionActive = false;
      throw error(400, 'lessonIds does not match lessons belonging to the specified module');
    }

    const lessonIdSet = new Set(existingLessons.rows.map((row: { lesson_id: string }) => row.lesson_id));
    for (const lessonId of lessonIds) {
      if (!lessonIdSet.has(lessonId)) {
        await client.query('ROLLBACK');
        transactionActive = false;
        throw error(400, 'lessonIds must reference lessons belonging to the module');
      }
    }

    for (const [index, lessonId] of lessonIds.entries()) {
      await client.query('UPDATE lessons SET position = $1, updated_at = NOW() WHERE lesson_id = $2', [
        index,
        lessonId,
      ]);
    }

    await client.query('UPDATE modules SET updated_at = NOW() WHERE module_id = $1', [moduleId]);
    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [courseId]);

    const orderedLessons = await client.query<{ lesson_id: string; title: string; position: number }>(
      'SELECT lesson_id, title, position FROM lessons WHERE module_id = $1 ORDER BY position ASC',
      [moduleId]
    );

    await client.query('COMMIT');
    transactionActive = false;

    return json({
      moduleId,
      lessons: orderedLessons.rows.map((row: { lesson_id: string; title: string; position: number }) => ({
        lessonId: row.lesson_id,
        title: row.title,
        position: Number(row.position ?? 0),
      })),
    });
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

    console.error('Failed to reorder lessons', cause);
    throw error(500, 'Failed to reorder lessons');
  } finally {
    client.release();
  }
}
