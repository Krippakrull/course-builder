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

    type ModuleRow = {
      module_id: string;
      title: string;
      position: number;
    };

    type LessonRow = {
      lesson_id: string;
      module_id: string;
      title: string;
      position: number;
    };

    type BlockRow = {
      block_id: string;
      lesson_id: string;
      type: string;
      content: Record<string, unknown>;
      version: number;
      position: number;
      created_at: string;
      updated_at: string;
    };

    const moduleResult = await pool.query<ModuleRow>(
      `SELECT module_id, title, position
       FROM modules
       WHERE course_id = $1
       ORDER BY position ASC`,
      [courseId]
    );

    const moduleIds = moduleResult.rows.map((row: ModuleRow) => row.module_id);
    const lessonsResult = moduleIds.length
      ? await pool.query<LessonRow>(
          `SELECT lesson_id, module_id, title, position
           FROM lessons
           WHERE module_id = ANY($1::uuid[])
           ORDER BY position ASC`,
          [moduleIds]
        )
      : { rows: [] as LessonRow[] };

    const lessonIds = lessonsResult.rows.map((row: LessonRow) => row.lesson_id);

    const blocksResult = lessonIds.length
      ? await pool.query<BlockRow>(
          `SELECT block_id, lesson_id, type, content, version, position, created_at, updated_at
           FROM blocks
           WHERE lesson_id = ANY($1::uuid[])
           ORDER BY position ASC`,
          [lessonIds]
        )
      : { rows: [] as BlockRow[] };

    type LessonSummary = { lessonId: string; title: string; position: number };
    type BlockSummary = {
      blockId: string;
      type: string;
      content: Record<string, unknown>;
      version: number;
      position: number;
      createdAt: string;
      updatedAt: string;
    };

    const lessonsByModule = new Map<string, LessonSummary[]>();
    const blocksByLesson = new Map<
      string,
      BlockSummary[]
    >();

    for (const lesson of lessonsResult.rows) {
      const collection = lessonsByModule.get(lesson.module_id) ?? [];
      collection.push({
        lessonId: lesson.lesson_id,
        title: lesson.title,
        position: Number(lesson.position ?? 0),
      });
      lessonsByModule.set(lesson.module_id, collection);
    }

    for (const block of blocksResult.rows) {
      const collection = blocksByLesson.get(block.lesson_id) ?? [];
      collection.push({
        blockId: block.block_id,
        type: block.type,
        content: block.content ?? {},
        version: Number(block.version ?? 1),
        position: Number(block.position ?? 0),
        createdAt: block.created_at,
        updatedAt: block.updated_at,
      });
      blocksByLesson.set(block.lesson_id, collection);
    }

    type ModuleSummary = {
      moduleId: string;
      title: string;
      position: number;
      lessons: (LessonSummary & { blocks: BlockSummary[] })[];
    };

    const modules: ModuleSummary[] = moduleResult.rows.map((row) => ({
      moduleId: row.module_id,
      title: row.title,
      position: Number(row.position ?? 0),
      lessons: (lessonsByModule.get(row.module_id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((lesson) => ({
          ...lesson,
          blocks: (blocksByLesson.get(lesson.lessonId) ?? []).sort((a, b) => a.position - b.position),
        })),
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
