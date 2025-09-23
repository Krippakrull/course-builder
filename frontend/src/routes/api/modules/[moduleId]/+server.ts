import { error } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function DELETE({ params }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const moduleId = params.moduleId ?? '';
  if (!isUuid(moduleId)) {
    throw error(400, 'moduleId must be a valid UUID');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureDatabase();
    await client.query('BEGIN');

    const moduleResult = await client.query<{ course_id: string }>(
      'SELECT course_id FROM modules WHERE module_id = $1',
      [moduleId]
    );

    const moduleRow = moduleResult.rows[0];

    if (!moduleRow) {
      await client.query('ROLLBACK');
      throw error(404, 'Module not found');
    }

    const courseId = moduleRow.course_id;

    await client.query('DELETE FROM modules WHERE module_id = $1', [moduleId]);

    const remainingModules = await client.query<{ module_id: string }>(
      'SELECT module_id FROM modules WHERE course_id = $1 ORDER BY position ASC',
      [courseId]
    );

    for (const [index, row] of remainingModules.rows.entries()) {
      await client.query('UPDATE modules SET position = $1, updated_at = NOW() WHERE module_id = $2', [
        index,
        row.module_id,
      ]);
    }

    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [courseId]);

    await client.query('COMMIT');

    return new Response(null, { status: 204 });
  } catch (cause) {
    await client.query('ROLLBACK');

    if (cause instanceof Response) {
      throw cause;
    }

    console.error('Failed to delete module', cause);
    throw error(500, 'Failed to delete module');
  } finally {
    client.release();
  }
}
