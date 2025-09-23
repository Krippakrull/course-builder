import { error } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function DELETE({ params }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const lessonId = params.lessonId ?? '';
  if (!isUuid(lessonId)) {
    throw error(400, 'lessonId must be a valid UUID');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureDatabase();
    await client.query('BEGIN');

    const lessonResult = await client.query<{ module_id: string }>(
      'SELECT module_id FROM lessons WHERE lesson_id = $1',
      [lessonId]
    );

    const lessonRow = lessonResult.rows[0];

    if (!lessonRow) {
      await client.query('ROLLBACK');
      throw error(404, 'Lesson not found');
    }

    const moduleId = lessonRow.module_id;

    const moduleResult = await client.query<{ course_id: string }>(
      'SELECT course_id FROM modules WHERE module_id = $1',
      [moduleId]
    );

    const moduleRow = moduleResult.rows[0];

    if (!moduleRow) {
      await client.query('ROLLBACK');
      throw error(404, 'Module not found for lesson');
    }

    const courseId = moduleRow.course_id;

    await client.query('DELETE FROM lessons WHERE lesson_id = $1', [lessonId]);

    const remainingLessons = await client.query<{ lesson_id: string }>(
      'SELECT lesson_id FROM lessons WHERE module_id = $1 ORDER BY position ASC',
      [moduleId]
    );

    for (const [index, row] of remainingLessons.rows.entries()) {
      await client.query('UPDATE lessons SET position = $1, updated_at = NOW() WHERE lesson_id = $2', [
        index,
        row.lesson_id,
      ]);
    }

    await client.query('UPDATE modules SET updated_at = NOW() WHERE module_id = $1', [moduleId]);
    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [courseId]);

    await client.query('COMMIT');

    return new Response(null, { status: 204 });
  } catch (cause) {
    await client.query('ROLLBACK');

    if (cause instanceof Response) {
      throw cause;
    }

    console.error('Failed to delete lesson', cause);
    throw error(500, 'Failed to delete lesson');
  } finally {
    client.release();
  }
}
