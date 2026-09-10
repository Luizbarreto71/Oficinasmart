import compression from 'compression';
import express, { type Application } from 'express';
import helmet from 'helmet';
import { rotasAuth } from './auth.js';
import { rotasCategorias, rotasClientes, rotasFornecedores, rotasUsuarios } from './cadastros.js';
import { rota, tratarErros } from './core.js';
import { rotasDashboard } from './dashboard.js';
import { bancoConfigurado, bancoIniciado, db, erroDoBanco, comoConectamos } from './db.js';
import { rotasDevices } from './devices.js';
import { rotasMovimentacoes } from './movimentacoes.js';
import { rotasFotos, rotasProdutos } from './produtos.js';
import { rotasRelatorios } from './relatorios.js';
import { rotasSistema } from './sistema.js';
import { rotasUnidades } from './unidades.js';
import { rotasCaixa } from './caixa.js';
import { rotasNotificacoes } from './notificacoes.js';
import { rotasPreVendas } from './prevendas.js';
import { rotasEmAberto } from './aberto.js';
import { rotasTrocas } from './trocas.js';
import { rotasMetas } from './metas.js';
import { rotasSeminovos } from './seminovos.js';
import { rotasVendas } from './vendas.js';

/**
 * Monta a API. Usado igual em dois lugares:
 * - desenvolvimento: dentro do servidor do Vite;
 * - produção: na função serverless da Vercel (`api/index.js`).
 */
export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(compression());

  const lerJson = express.json({ limit: '12mb' });
  const lerFormulario = express.urlencoded({ extended: true });

  app.use((req, res, next) => {
    if (req.body !== undefined) return next();
    lerJson(req, res, (erro) => (erro ? next(erro) : lerFormulario(req, res, next)));
  });

  app.get(
    '/api/health',
    rota(async (_req, res) => {
      const ambiente = {
        node: process.version,
        plataforma: `${process.platform}-${process.arch}`,
        producao: process.env.NODE_ENV === 'production',
        naVercel: Boolean(process.env.VERCEL),
      };

      if (!bancoConfigurado) {
        res.status(503).json({
          status: 'sem configuração',
          problema: 'A variável DATABASE_URL não está definida.',
          comoResolver:
            'Vercel → Settings → Environment Variables → adicione DATABASE_URL, depois Deployments → Redeploy.',
          ambiente,
        });
        return;
      }

      if (!bancoIniciado) {
        res.status(503).json({
          status: 'falha ao iniciar',
          problema: 'O cliente do banco (Prisma) não pôde ser criado.',
          detalhe: erroDoBanco,
          comoResolver:
            'Costuma ser o motor do Prisma faltando no pacote da função. Refaça o deploy sem cache.',
          ambiente,
        });
        return;
      }

      try {
        await db.$queryRaw`SELECT 1`;
        const [produtos, usuarios] = await Promise.all([db.product.count(), db.user.count()]);
        res.json({ status: 'ok', database: 'conectado', produtos, usuarios, banco: comoConectamos(), ambiente });
      } catch (erro) {
        res.status(503).json({
          status: 'degradado',
          problema: 'Conectou o cliente, mas a consulta ao banco falhou.',
          detalhe: (erro as Error).message,
          comoResolver:
            'Confira a DATABASE_URL: em produção use a URL do Transaction pooler (porta 6543) e codifique caracteres especiais da senha.',
          ambiente,
        });
      }
    }),
  );

  app.use('/api', (_req, res, next) => {
    if (bancoConfigurado) return next();
    res.status(503).json({
      error:
        'O sistema está sem conexão com o banco: falta a variável DATABASE_URL. ' +
        'Configure em Vercel → Settings → Environment Variables e refaça o deploy.',
    });
  });

  app.use('/api/auth', rotasAuth);
  app.use('/api/dashboard', rotasDashboard);
  app.use('/api/products', rotasProdutos);
  app.use('/api/devices', rotasDevices);
  app.use('/api/fotos', rotasFotos);
  app.use('/api/sales', rotasVendas);
  app.use('/api/pre-sales', rotasPreVendas);
  app.use('/api/trocas', rotasTrocas);
  app.use('/api/seminovos', rotasSeminovos);
  app.use('/api/metas', rotasMetas);
  app.use('/api/em-aberto', rotasEmAberto);
  app.use('/api/cash', rotasCaixa);
  app.use('/api/notifications', rotasNotificacoes);
  app.use('/api/movements', rotasMovimentacoes);
  app.use('/api/units', rotasUnidades);
  app.use('/api/categories', rotasCategorias);
  app.use('/api/suppliers', rotasFornecedores);
  app.use('/api/customers', rotasClientes);
  app.use('/api/users', rotasUsuarios);
  app.use('/api/reports', rotasRelatorios);
  app.use('/api/settings', rotasSistema);

  app.use((req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
  });

  app.use(tratarErros);

  return app;
}
