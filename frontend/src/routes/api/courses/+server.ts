import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';

export async function POST({ request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const language = typeof payload.language === 'string' ? payload.language.trim() : '';

  if (!title) {
    throw error(400, 'title is required');
  }

  if (!language) {
    throw error(400, 'language is required');
  }

  const pool = getPool();

  try {
    await ensureDatabase();
    const courseId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO courses (course_id, title, language)
       VALUES ($1, $2, $3)
       RETURNING course_id, title, language, created_at, updated_at`,
      [courseId, title, language]
    );

    const course = rows[0];

    return json(
      {
        courseId: course.course_id,
        title: course.title,
        language: course.language,
        createdAt: course.created_at,
        updatedAt: course.updated_at,
      },
      { status: 201 }
    );
  } catch (cause) {
    console.error('Failed to create course', cause);
    throw error(500, 'Failed to create course');
  }
}
