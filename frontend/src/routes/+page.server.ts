import type { PageServerLoad } from './$types';
import { ensureDatabase, isDatabaseConfigured } from '$lib/server/db';

export const load: PageServerLoad = async () => {
  if (!isDatabaseConfigured()) {
    return { databaseConfigured: false as const, schemaReady: false as const };
  }

  try {
    await ensureDatabase();
    return { databaseConfigured: true as const, schemaReady: true as const };
  } catch (error) {
    console.error('Failed to ensure database schema', error);
    return { databaseConfigured: true as const, schemaReady: false as const };
  }
};
