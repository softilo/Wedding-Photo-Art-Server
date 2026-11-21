import { createConfiguredApp } from './app.setup.js';

async function bootstrap() {
  const app = await createConfiguredApp();
  await app.listen(process.env.PORT ?? 5000);
}
await bootstrap();
