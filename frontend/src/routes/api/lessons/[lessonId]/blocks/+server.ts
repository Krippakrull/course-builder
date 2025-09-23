import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { ensureDatabase, getPool, isDatabaseConfigured } from '$lib/server/db';
import { isUuid } from '$lib/server/utils';

type AllowedBlockType = 'text' | 'heading' | 'list';

type NormalizedBlock = {
  blockId: string;
  type: AllowedBlockType;
  position: number;
  content: Record<string, unknown>;
};

const allowedTypes: AllowedBlockType[] = ['text', 'heading', 'list'];

function normalizeBlocks(payload: unknown): NormalizedBlock[] {
  if (!payload || typeof payload !== 'object') {
    throw error(400, 'Request body must be an object');
  }

  const blocksValue = (payload as { blocks?: unknown }).blocks;

  if (!Array.isArray(blocksValue)) {
    throw error(400, 'blocks must be an array');
  }

  const seen = new Set<string>();

  return blocksValue.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw error(400, `blocks[${index}] must be an object`);
    }

    const raw = value as Record<string, unknown>;

    const type = typeof raw.type === 'string' ? (raw.type as AllowedBlockType) : null;
    if (!type || !allowedTypes.includes(type)) {
      throw error(400, `blocks[${index}].type must be one of ${allowedTypes.join(', ')}`);
    }

    const blockIdValue = raw.blockId;
    const blockId =
      typeof blockIdValue === 'string' && isUuid(blockIdValue) ? blockIdValue : randomUUID();

    if (seen.has(blockId)) {
      throw error(400, `Duplicate blockId detected in blocks payload`);
    }

    seen.add(blockId);

    const contentValue = raw.content;
    if (!contentValue || typeof contentValue !== 'object') {
      throw error(400, `blocks[${index}].content must be an object`);
    }

    let normalizedContent: Record<string, unknown>;

    if (type === 'text') {
      const text = typeof (contentValue as { text?: unknown }).text === 'string'
        ? (contentValue as { text?: string }).text
        : '';
      normalizedContent = { text };
    } else if (type === 'heading') {
      const text = typeof (contentValue as { text?: unknown }).text === 'string'
        ? (contentValue as { text?: string }).text
        : '';
      const rawLevel = (contentValue as { level?: unknown }).level;
      const parsedLevel = Number(rawLevel);
      const level = Number.isInteger(parsedLevel) ? Math.min(Math.max(parsedLevel, 1), 6) : 2;
      normalizedContent = { text, level };
    } else {
      const listContent = contentValue as { items?: unknown; style?: unknown };
      const items = Array.isArray(listContent.items)
        ? listContent.items
            .map((item) => (typeof item === 'string' ? item : item != null ? String(item) : ''))
            .map((item) => item.replace(/\r/g, ''))
        : [];
      const style = listContent.style === 'numbered' ? 'numbered' : 'bulleted';
      normalizedContent = { items, style };
    }

    return {
      blockId,
      type,
      position: index,
      content: normalizedContent,
    } satisfies NormalizedBlock;
  });
}

type ExistingBlockRow = {
  block_id: string;
  type: string;
  content: unknown;
  version: number;
};

type SavedBlockRow = {
  block_id: string;
  type: AllowedBlockType;
  content: Record<string, unknown>;
  version: number;
  position: number;
  created_at: string;
  updated_at: string;
};

export async function PATCH({ params, request }: Parameters<import('@sveltejs/kit').RequestHandler>[0]) {
  if (!isDatabaseConfigured()) {
    throw error(503, 'Database is not configured');
  }

  const lessonId = params.lessonId ?? '';
  if (!isUuid(lessonId)) {
    throw error(400, 'lessonId must be a valid UUID');
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const blocks = normalizeBlocks(payload);

  const pool = getPool();
  const client = await pool.connect();
  let transactionActive = false;

  try {
    await ensureDatabase();
    await client.query('BEGIN');
    transactionActive = true;

    const contextResult = await client.query<{ module_id: string; course_id: string }>(
      `SELECT lessons.module_id, modules.course_id
       FROM lessons
       INNER JOIN modules ON modules.module_id = lessons.module_id
       WHERE lessons.lesson_id = $1`,
      [lessonId]
    );

    const contextRow = contextResult.rows[0];
    if (!contextRow) {
      await client.query('ROLLBACK');
      transactionActive = false;
      throw error(404, 'Lesson not found');
    }

    const existingBlocksResult = await client.query<ExistingBlockRow>(
      `SELECT block_id, type, content, version
       FROM blocks
       WHERE lesson_id = $1`,
      [lessonId]
    );

    const existingBlocks = new Map<string, ExistingBlockRow>(
      existingBlocksResult.rows.map((row) => [row.block_id, row] as const)
    );

    const incomingIds = new Set(blocks.map((block) => block.blockId));

    const toDelete: string[] = existingBlocksResult.rows
      .map((row) => row.block_id)
      .filter((blockId) => !incomingIds.has(blockId));

    if (toDelete.length > 0) {
      await client.query('DELETE FROM blocks WHERE block_id = ANY($1::uuid[])', [toDelete]);
    }

    for (const block of blocks) {
      const serializedContent = JSON.stringify(block.content);
      const existing = existingBlocks.get(block.blockId);

      if (existing) {
        const previousContent = JSON.stringify(existing.content ?? {});
        const typeChanged = existing.type !== block.type;
        const contentChanged = previousContent !== serializedContent;
        const increment = typeChanged || contentChanged ? 1 : 0;

        await client.query(
          `UPDATE blocks
           SET type = $1,
               content = $2::jsonb,
               position = $3,
               version = version + $4,
               updated_at = NOW()
           WHERE block_id = $5`,
          [block.type, serializedContent, block.position, increment, block.blockId]
        );
      } else {
        await client.query(
          `INSERT INTO blocks (block_id, lesson_id, type, content, position)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [block.blockId, lessonId, block.type, serializedContent, block.position]
        );
      }
    }

    await client.query('UPDATE lessons SET updated_at = NOW() WHERE lesson_id = $1', [lessonId]);
    await client.query('UPDATE modules SET updated_at = NOW() WHERE module_id = $1', [contextRow.module_id]);
    await client.query('UPDATE courses SET updated_at = NOW() WHERE course_id = $1', [contextRow.course_id]);

    const updatedBlocksResult = await client.query<SavedBlockRow>(
      `SELECT block_id, type, content, version, position, created_at, updated_at
       FROM blocks
       WHERE lesson_id = $1
       ORDER BY position ASC`,
      [lessonId]
    );

    await client.query('COMMIT');
    transactionActive = false;

    return json({
      blocks: updatedBlocksResult.rows.map((row) => ({
        blockId: row.block_id,
        type: row.type,
        content: row.content,
        version: Number(row.version ?? 1),
        position: Number(row.position ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } satisfies {
        blockId: string;
        type: AllowedBlockType;
        content: Record<string, unknown>;
        version: number;
        position: number;
        createdAt: string;
        updatedAt: string;
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

    console.error('Failed to update blocks', cause);
    throw error(500, 'Failed to update blocks');
  } finally {
    client.release();
  }
}
