import { createApp } from './app';
import { db } from './db';

/**
 * Sobe a API sozinha, para testar com curl/Insomnia (`npm run dev:api`).
 *
 * No dia a dia não é necessário: `npm run dev` já serve a API junto com o
 * site, na mesma porta.
 */
const porta = Number(process.env.PORT ?? 4000);

const servidor = createApp().listen(porta, () => {
  console.log(`🚀 API em http://localhost:${porta}/api`);
});

const encerrar = () => {
  servidor.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
