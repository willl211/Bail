import { Client } from 'pg';
import { createHarness } from './harness';
import { testDatabaseUrl } from './setup-database';

it('libère réellement la connexion PostgreSQL à la fermeture de l’application', async () => {
  const observer = new Client({ connectionString: testDatabaseUrl(), connectionTimeoutMillis: 5000 });
  const h = await createHarness();
  let closed = false;
  try {
    await observer.connect();
    const [connection] = await h.prisma.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    expect((await observer.query('SELECT pid FROM pg_stat_activity WHERE pid = $1', [connection.pid])).rowCount).toBe(1);
    await h.close();
    closed = true;
    let count: number | null = 1;
    for (let attempt = 0; attempt < 20 && count; attempt++) {
      count = (await observer.query('SELECT pid FROM pg_stat_activity WHERE pid = $1', [connection.pid])).rowCount;
      if (count) await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(count).toBe(0);
  } finally {
    if (!closed) await h.close();
    await observer.end();
  }
});
