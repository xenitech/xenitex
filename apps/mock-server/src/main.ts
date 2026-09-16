import { loadConfig } from './config.js';
import { buildMockServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildMockServer(config);
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
