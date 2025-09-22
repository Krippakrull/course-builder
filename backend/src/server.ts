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
