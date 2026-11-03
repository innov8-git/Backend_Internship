import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

async function run() {
  console.log('Initializing PGlite...');
  const db = await PGlite.create({ dataDir: './prisma/pgdata' });
  const server = new PGLiteSocketServer({
    db,
    port: 5432,
    host: '127.0.0.1'
  });
  await server.start();
  console.log('PGlite TCP server listening on 127.0.0.1:5432');
}

run().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
