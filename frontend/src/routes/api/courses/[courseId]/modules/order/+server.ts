import { json, error } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function PATCH({ params, request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const courseId = params.courseId ?? '';
  if (!isUuid(courseId)) {
    throw error(400, 'courseId must be a valid UUID');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const moduleIdsValue = payload.moduleIds;

  if (!Array.isArray(moduleIdsValue) || moduleIdsValue.length === 0) {
    throw error(400, 'moduleIds must be a non-empty array');
  }

  const moduleIds = moduleIdsValue.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean);

  if (moduleIds.length !== moduleIdsValue.length) {
    throw error(400, 'moduleIds must contain only strings');
  }

  const uniqueModuleIds = new Set(moduleIds);
  if (uniqueModuleIds.size !== moduleIds.length) {
    throw error(400, 'moduleIds must be unique');
  }

  const pool = getPool();
  const client = await pool.connect();
  let transactionActive = false;

  try {
    await ensureDatabase();
    await client.query('BEGIN');
    transactionActive = true;

    const courseExists = await client.query('SELECT 1 FROM courses WHERE course_id = $1', [courseId]);

    if (courseExists.rowCount === 0) {
      await client.query('ROLLBACK');
      transactionActive = false;
      throw error(404, 'Course not found');
    }

    const existingModules = await client.query<{ module_id: string }>(
      'SELECT module_id FROM modules WHERE course_id = $1',
      [courseId]
    );

    const existingModuleIds = existingModules.rows.map((row: { module_id: string }) => row.module_id);

    if (existingModuleIds.length !== moduleIds.length) {
      await client.query('ROLLBACK');
      transactionActive = false;
      throw error(400, 'moduleIds does not match modules for the course');
    }

    const existingModuleIdSet = new Set(existingModuleIds);
    for (const moduleId of moduleIds) {
      if (!existingModuleIdSet.has(moduleId)) {
        await client.query('ROLLBACK');
        transactionActive = false;
        throw error(400, 'moduleIds must reference modules belonging to the course');
      }
    }

    for (const [index, moduleId] of moduleIds.entries()) {
      await client.query('UPDATE modules SET position = $1, updated_at = NOW() WHERE module_id = $2', [
        index,
        moduleId,
      ]);
    }

    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [courseId]);

    const orderedModules = await client.query<{ module_id: string; title: string; position: number }>(
      'SELECT module_id, title, position FROM modules WHERE course_id = $1 ORDER BY position ASC',
      [courseId]
    );

    await client.query('COMMIT');
    transactionActive = false;

    return json({
      courseId,
      modules: orderedModules.rows.map((row: { module_id: string; title: string; position: number }) => ({
        moduleId: row.module_id,
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

    console.error('Failed to reorder modules', cause);
    throw error(500, 'Failed to reorder modules');
  } finally {
    client.release();
  }
}
