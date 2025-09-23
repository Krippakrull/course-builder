import { json, error } from '@sveltejs/kit';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

export async function GET({ params }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const courseId = params.courseId ?? '';
  if (!isUuid(courseId)) {
    throw error(400, 'courseId must be a valid UUID');
  }

  try {
    await ensureDatabase();
    const pool = getPool();
    const courseResult = await pool.query(
      `SELECT course_id, title, language, created_at, updated_at
       FROM courses
       WHERE course_id = $1`,
      [courseId]
    );

    const courseRow = courseResult.rows[0];
    if (!courseRow) {
      throw error(404, 'Course not found');
    }

    const moduleResult = await pool.query<{
      module_id: string;
      title: string;
      position: number;
    }>(
      `SELECT module_id, title, position
       FROM modules
       WHERE course_id = $1
       ORDER BY position ASC`,
      [courseId]
    );

    const moduleIds = moduleResult.rows.map((row) => row.module_id);
    const lessonsResult = moduleIds.length
      ? await pool.query<{
          lesson_id: string;
          module_id: string;
          title: string;
          position: number;
        }>(
          `SELECT lesson_id, module_id, title, position
           FROM lessons
           WHERE module_id = ANY($1::uuid[])
           ORDER BY position ASC`,
          [moduleIds]
        )
      : { rows: [] as {
          lesson_id: string;
          module_id: string;
          title: string;
          position: number;
        }[] };

    const lessonsByModule = new Map<string, { lessonId: string; title: string; position: number }[]>();

    for (const lesson of lessonsResult.rows) {
      const collection = lessonsByModule.get(lesson.module_id) ?? [];
      collection.push({
        lessonId: lesson.lesson_id,
        title: lesson.title,
        position: Number(lesson.position ?? 0),
      });
      lessonsByModule.set(lesson.module_id, collection);
    }

    const modules = moduleResult.rows.map((row) => ({
      moduleId: row.module_id,
      title: row.title,
      position: Number(row.position ?? 0),
      lessons: (lessonsByModule.get(row.module_id) ?? []).sort((a, b) => a.position - b.position),
    }));

    modules.sort((a, b) => a.position - b.position);

    return json({
      courseId: courseRow.course_id,
      title: courseRow.title,
      language: courseRow.language,
      createdAt: courseRow.created_at,
      updatedAt: courseRow.updated_at,
      modules,
    });
  } catch (cause) {
    if (cause instanceof Response) {
      throw cause;
    }

    console.error('Failed to load course', cause);
    throw error(500, 'Failed to load course');
  }
}
