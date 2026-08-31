import type { Application } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './app';

/**
 * Ponto de entrada da API na Vercel.
 *
 * Este arquivo NÃO é publicado direto: o `npm run build` o empacota, junto
 * com todo o `server/`, em `api/index.js` (o empacotador da Vercel não leva
 * a pasta `server/` junto com a função).
 *
 * O `vercel.json` redireciona `/api/*` para a função; o Express recebe a
 * URL original (ex.: `/api/products`) e faz o roteamento normalmente.
 */
let app: Application | null = null;
let erroDeCarga: string | null = null;

function obterApp(): Application | null {
  if (app || erroDeCarga) return app;

  try {
    app = createApp();
  } catch (erro) {
    erroDeCarga = erro instanceof Error ? (erro.stack ?? erro.message) : String(erro);
    console.error('[api] falha ao montar o servidor:', erroDeCarga);
  }

  return app;
}

const ambiente = () => ({
  node: process.version,
  plataforma: `${process.platform}-${process.arch}`,
  naVercel: Boolean(process.env.VERCEL),
  regiao: process.env.VERCEL_REGION ?? null,
  temDatabaseUrl: Boolean(process.env.DATABASE_URL),
});

function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo, null, 2));
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const servidor = obterApp();

  if (!servidor) {
    responderJson(res, 503, {
      status: 'falha ao carregar',
      problema: 'O servidor não pôde ser montado nesta função.',
      detalhe: erroDeCarga,
      ambiente: ambiente(),
    });
    return;
  }

  if ((req.url ?? '').startsWith('/api/health') && !process.env.DATABASE_URL) {
    responderJson(res, 503, {
      status: 'sem configuração',
      problema: 'A variável DATABASE_URL não está definida nesta função.',
      comoResolver:
        'Vercel → Settings → Environment Variables → adicione DATABASE_URL (marque Production) → Deployments → Redeploy.',
      ambiente: ambiente(),
    });
    return;
  }

  servidor(req as never, res as never);
}
