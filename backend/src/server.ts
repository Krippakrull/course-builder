import express from 'express';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
import { Pool } from 'pg';

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

app.listen(Number(port), () => {
  console.log(`Backend listening on port ${port}`);
});
