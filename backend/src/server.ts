import express from 'express';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
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
app.use(express.json());

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
