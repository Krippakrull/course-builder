import express from 'express';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

dotenv.config();

const port = process.env.PORT ?? '3001';
const databaseUrl = process.env.DATABASE_URL;

let pool: Pool | undefined;

if (databaseUrl) {
  pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', (error) => {
    console.error('Unexpected database error', error);
  });
} else {
  console.warn('DATABASE_URL is not set. Database-dependent routes will be disabled.');
}

const app = express();

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);
app.use(express.json());

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

app.get('/health', async (_req: Request, res: Response) => {
  if (!pool) {
    res.json({ status: 'ok', database: 'not configured' });
    return;
  }

  try {
    const { rows } = await pool.query<{ now: string }>('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected', timestamp: rows[0].now });
  } catch (error) {
    console.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

type CreateCourseBody = {
  title?: unknown;
  language?: unknown;
};

app.post(
  '/courses',
  async (req: Request<unknown, unknown, CreateCourseBody>, res: Response) => {
    if (!pool) {
      res.status(503).json({ message: 'Database is not configured' });
      return;
    }

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const language =
      typeof req.body.language === 'string' ? req.body.language.trim() : '';

    if (!title) {
      res.status(400).json({ message: 'title is required' });
      return;
    }

    if (!language) {
      res.status(400).json({ message: 'language is required' });
      return;
    }

    const courseId = randomUUID();

    try {
      const { rows } = await pool.query(
        `INSERT INTO courses (course_id, title, language)
         VALUES ($1, $2, $3)
         RETURNING course_id, title, language, created_at, updated_at`,
        [courseId, title, language]
      );

      const course = rows[0];

      res.status(201).json({
        courseId: course.course_id,
        title: course.title,
        language: course.language,
        createdAt: course.created_at,
        updatedAt: course.updated_at,
      });
    } catch (error) {
      console.error('Failed to create course', error);
      res.status(500).json({ message: 'Failed to create course' });
    }
  }
);

type GetCourseParams = {
  courseId: string;
};

app.get('/courses/:courseId', async (req: Request<GetCourseParams>, res: Response) => {
  if (!pool) {
    res.status(503).json({ message: 'Database is not configured' });
    return;
  }

  const courseId = req.params.courseId;
  if (!isUuid(courseId)) {
    res.status(400).json({ message: 'courseId must be a valid UUID' });
    return;
  }

  try {
    const courseResult = await pool.query(
      `SELECT course_id, title, language, created_at, updated_at FROM courses WHERE course_id = $1`,
      [courseId]
    );

    const courseRow = courseResult.rows[0];

    if (!courseRow) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const modulesResult = await pool.query(
      `SELECT m.module_id, m.title, m.position, l.lesson_id, l.title AS lesson_title, l.position AS lesson_position
       FROM modules m
       LEFT JOIN lessons l ON l.module_id = m.module_id
       WHERE m.course_id = $1
       ORDER BY m.position ASC, l.position ASC`,
      [courseId]
    );

    const modulesMap = new Map<
      string,
      {
        moduleId: string;
        title: string;
        position: number;
        lessons: { lessonId: string; title: string; position: number }[];
      }
    >();

    for (const row of modulesResult.rows) {
      const moduleId = row.module_id as string;
      if (!modulesMap.has(moduleId)) {
        modulesMap.set(moduleId, {
          moduleId,
          title: row.title as string,
          position: Number(row.position ?? 0),
          lessons: [],
        });
      }

      if (row.lesson_id) {
        const module = modulesMap.get(moduleId);
        if (module) {
          module.lessons.push({
            lessonId: row.lesson_id as string,
            title: (row.lesson_title as string) ?? '',
            position: Number(row.lesson_position ?? 0),
          });
        }
      }
    }

    const modules = Array.from(modulesMap.values()).map((module) => ({
      ...module,
      lessons: module.lessons.sort((a, b) => a.position - b.position),
    }));

    modules.sort((a, b) => a.position - b.position);

    res.json({
      courseId: courseRow.course_id,
      title: courseRow.title,
      language: courseRow.language,
      createdAt: courseRow.created_at,
      updatedAt: courseRow.updated_at,
      modules,
    });
  } catch (error) {
    console.error('Failed to load course', error);
    res.status(500).json({ message: 'Failed to load course' });
  }
});

type CreateModuleParams = {
  courseId: string;
};

type CreateModuleBody = {
  title?: unknown;
};

app.post(
  '/courses/:courseId/modules',
  async (req: Request<CreateModuleParams, unknown, CreateModuleBody>, res: Response) => {
    if (!pool) {
      res.status(503).json({ message: 'Database is not configured' });
      return;
    }

    const courseId = req.params.courseId;
    if (!isUuid(courseId)) {
      res.status(400).json({ message: 'courseId must be a valid UUID' });
      return;
    }

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ message: 'title is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const courseExists = await client.query('SELECT 1 FROM courses WHERE course_id = $1', [
        courseId,
      ]);

      if (courseExists.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Course not found' });
        return;
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
      res.status(201).json({
        moduleId: module.module_id,
        title: module.title,
        position: module.position,
        lessons: [],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to create module', error);
      res.status(500).json({ message: 'Failed to create module' });
    } finally {
      client.release();
    }
  }
);

type CreateLessonParams = {
  moduleId: string;
};

type CreateLessonBody = {
  title?: unknown;
};

app.post(
  '/modules/:moduleId/lessons',
  async (req: Request<CreateLessonParams, unknown, CreateLessonBody>, res: Response) => {
    if (!pool) {
      res.status(503).json({ message: 'Database is not configured' });
      return;
    }

    const moduleId = req.params.moduleId;
    if (!isUuid(moduleId)) {
      res.status(400).json({ message: 'moduleId must be a valid UUID' });
      return;
    }

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ message: 'title is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const moduleResult = await client.query<{ course_id: string }>(
        'SELECT course_id FROM modules WHERE module_id = $1',
        [moduleId]
      );

      const moduleRow = moduleResult.rows[0];

      if (!moduleRow) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Module not found' });
        return;
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
      await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [
        moduleRow.course_id,
      ]);

      await client.query('COMMIT');

      const lesson = insertedLesson.rows[0];
      res.status(201).json({
        lessonId: lesson.lesson_id,
        title: lesson.title,
        position: lesson.position,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to create lesson', error);
      res.status(500).json({ message: 'Failed to create lesson' });
    } finally {
      client.release();
    }
  }
);

type ReorderModulesParams = {
  courseId: string;
};

type ReorderModulesBody = {
  moduleIds?: unknown;
};

app.patch(
  '/courses/:courseId/modules/order',
  async (req: Request<ReorderModulesParams, unknown, ReorderModulesBody>, res: Response) => {
    if (!pool) {
      res.status(503).json({ message: 'Database is not configured' });
      return;
    }

    const courseId = req.params.courseId;
    if (!isUuid(courseId)) {
      res.status(400).json({ message: 'courseId must be a valid UUID' });
      return;
    }

    const moduleIdsValue = req.body.moduleIds;
    if (!Array.isArray(moduleIdsValue) || moduleIdsValue.length === 0) {
      res.status(400).json({ message: 'moduleIds must be a non-empty array' });
      return;
    }

    const moduleIds = moduleIdsValue.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean);

    if (moduleIds.length !== moduleIdsValue.length) {
      res.status(400).json({ message: 'moduleIds must contain only strings' });
      return;
    }

    const uniqueModuleIds = new Set(moduleIds);
    if (uniqueModuleIds.size !== moduleIds.length) {
      res.status(400).json({ message: 'moduleIds must be unique' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const courseExists = await client.query('SELECT 1 FROM courses WHERE course_id = $1', [courseId]);

      if (courseExists.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Course not found' });
        return;
      }

      const existingModules = await client.query<{ module_id: string; title: string }>(
        'SELECT module_id, title FROM modules WHERE course_id = $1',
        [courseId]
      );

      const existingModuleIds = existingModules.rows.map((row) => row.module_id);

      if (existingModuleIds.length !== moduleIds.length) {
        await client.query('ROLLBACK');
        res.status(400).json({ message: 'moduleIds does not match modules for the course' });
        return;
      }

      const existingModuleIdSet = new Set(existingModuleIds);
      for (const moduleId of moduleIds) {
        if (!existingModuleIdSet.has(moduleId)) {
          await client.query('ROLLBACK');
          res.status(400).json({ message: 'moduleIds must reference modules belonging to the course' });
          return;
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

      res.json({
        courseId,
        modules: orderedModules.rows.map((row) => ({
          moduleId: row.module_id,
          title: row.title,
          position: Number(row.position ?? 0),
        })),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to reorder modules', error);
      res.status(500).json({ message: 'Failed to reorder modules' });
    } finally {
      client.release();
    }
  }
);

type ReorderLessonsParams = {
  moduleId: string;
};

type ReorderLessonsBody = {
  lessonIds?: unknown;
};

app.patch(
  '/modules/:moduleId/lessons/order',
  async (req: Request<ReorderLessonsParams, unknown, ReorderLessonsBody>, res: Response) => {
    if (!pool) {
      res.status(503).json({ message: 'Database is not configured' });
      return;
    }

    const moduleId = req.params.moduleId;
    if (!isUuid(moduleId)) {
      res.status(400).json({ message: 'moduleId must be a valid UUID' });
      return;
    }

    const lessonIdsValue = req.body.lessonIds;
    if (!Array.isArray(lessonIdsValue) || lessonIdsValue.length === 0) {
      res.status(400).json({ message: 'lessonIds must be a non-empty array' });
      return;
    }

    const lessonIds = lessonIdsValue.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean);

    if (lessonIds.length !== lessonIdsValue.length) {
      res.status(400).json({ message: 'lessonIds must contain only strings' });
      return;
    }

    const uniqueLessonIds = new Set(lessonIds);
    if (uniqueLessonIds.size !== lessonIds.length) {
      res.status(400).json({ message: 'lessonIds must be unique' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const moduleResult = await client.query<{ course_id: string }>(
        'SELECT course_id FROM modules WHERE module_id = $1',
        [moduleId]
      );

      const moduleRow = moduleResult.rows[0];

      if (!moduleRow) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Module not found' });
        return;
      }

      const courseId = moduleRow.course_id;

      const existingLessons = await client.query<{ lesson_id: string; title: string }>(
        'SELECT lesson_id, title FROM lessons WHERE module_id = $1',
        [moduleId]
      );

      if (existingLessons.rows.length !== lessonIds.length) {
        await client.query('ROLLBACK');
        res
          .status(400)
          .json({ message: 'lessonIds does not match lessons belonging to the specified module' });
        return;
      }

      const lessonIdSet = new Set(existingLessons.rows.map((row) => row.lesson_id));
      for (const lessonId of lessonIds) {
        if (!lessonIdSet.has(lessonId)) {
          await client.query('ROLLBACK');
          res.status(400).json({ message: 'lessonIds must reference lessons belonging to the module' });
          return;
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

      res.json({
        moduleId,
        lessons: orderedLessons.rows.map((row) => ({
          lessonId: row.lesson_id,
          title: row.title,
          position: Number(row.position ?? 0),
        })),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to reorder lessons', error);
      res.status(500).json({ message: 'Failed to reorder lessons' });
    } finally {
      client.release();
    }
  }
);

type DeleteModuleParams = {
  moduleId: string;
};

app.delete('/modules/:moduleId', async (req: Request<DeleteModuleParams>, res: Response) => {
  if (!pool) {
    res.status(503).json({ message: 'Database is not configured' });
    return;
  }

  const moduleId = req.params.moduleId;
  if (!isUuid(moduleId)) {
    res.status(400).json({ message: 'moduleId must be a valid UUID' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const moduleResult = await client.query<{ course_id: string }>(
      'SELECT course_id FROM modules WHERE module_id = $1',
      [moduleId]
    );

    const moduleRow = moduleResult.rows[0];

    if (!moduleRow) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Module not found' });
      return;
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

    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete module', error);
    res.status(500).json({ message: 'Failed to delete module' });
  } finally {
    client.release();
  }
});

type DeleteLessonParams = {
  lessonId: string;
};

app.delete('/lessons/:lessonId', async (req: Request<DeleteLessonParams>, res: Response) => {
  if (!pool) {
    res.status(503).json({ message: 'Database is not configured' });
    return;
  }

  const lessonId = req.params.lessonId;
  if (!isUuid(lessonId)) {
    res.status(400).json({ message: 'lessonId must be a valid UUID' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lessonResult = await client.query<{ module_id: string }>(
      'SELECT module_id FROM lessons WHERE lesson_id = $1',
      [lessonId]
    );

    const lessonRow = lessonResult.rows[0];

    if (!lessonRow) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Lesson not found' });
      return;
    }

    const moduleId = lessonRow.module_id;

    const moduleResult = await client.query<{ course_id: string }>(
      'SELECT course_id FROM modules WHERE module_id = $1',
      [moduleId]
    );

    const moduleRow = moduleResult.rows[0];

    if (!moduleRow) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Module not found for lesson' });
      return;
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

    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete lesson', error);
    res.status(500).json({ message: 'Failed to delete lesson' });
  } finally {
    client.release();
  }
});

async function ensureSchema(database: Pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS courses (
      course_id uuid PRIMARY KEY,
      title text NOT NULL,
      language text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS modules (
      module_id uuid PRIMARY KEY,
      course_id uuid REFERENCES courses(course_id) ON DELETE CASCADE,
      title text NOT NULL,
      position int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await database.query(`
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

async function start() {
  if (pool) {
    try {
      await ensureSchema(pool);
    } catch (error) {
      console.error('Failed to ensure database schema', error);
      process.exitCode = 1;
      return;
    }
  }

  app.listen(Number(port), () => {
    console.log(`Backend listening on port ${port}`);
  });
}

void start();
