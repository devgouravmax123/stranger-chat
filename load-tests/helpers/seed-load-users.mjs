import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('../../backend/node_modules/pg');
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_1kRzpVaxZ9ro@ep-fancy-star-b32j88in-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

export async function ensureLoadTestUsers(count = 1000) {
  const pool = new Pool({ connectionString, max: 5 });
  try {
    const client = await pool.connect();
    try {
      // Check existing load test users
      const checkRes = await client.query(
        `SELECT id FROM "User" WHERE id LIKE '00000000-0000-4000-8000-%' ORDER BY id ASC LIMIT $1`,
        [count]
      );

      const existingCount = checkRes.rows.length;
      if (existingCount >= count) {
        return checkRes.rows.map((r) => r.id);
      }

      console.log(`[Seed] Seeding ${count - existingCount} load test users into PostgreSQL...`);
      const needed = count - existingCount;
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (let i = existingCount; i < count; i++) {
        const hex = (i + 1).toString(16).padStart(12, '0');
        const id = `00000000-0000-4000-8000-${hex}`;
        const username = `load_tester_${i + 1}`;
        const language = 'English';
        const goal = 'casual-chat';

        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, ARRAY['Coding', 'Gaming', 'Music'], NOW(), NOW(), NOW(), false)`);
        params.push(id, username, language, goal);
      }

      const insertSql = `
        INSERT INTO "User" (
          id, username, language, goal, interests, "createdAt", "updatedAt", "lastSeenAt", "isBanned"
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `;

      await client.query(insertSql, params);
      console.log(`[Seed] Successfully seeded ${needed} load-test users into DB!`);

      const allRes = await client.query(
        `SELECT id FROM "User" WHERE id LIKE '00000000-0000-4000-8000-%' ORDER BY id ASC LIMIT $1`,
        [count]
      );
      return allRes.rows.map((r) => r.id);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed-load-users.mjs')) {
  ensureLoadTestUsers(1000).then((users) => {
    console.log(`Total load-test users ready: ${users.length}`);
    process.exit(0);
  }).catch((err) => {
    console.error('Failed to seed load-test users:', err);
    process.exit(1);
  });
}
