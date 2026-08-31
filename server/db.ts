import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import type { Request } from 'express';

// Em produção as variáveis vêm da Vercel; local, do arquivo .env.
dotenv.config();

/**
 * Sem DATABASE_URL o sistema não funciona — mas derrubar o processo aqui
 * faria a Vercel devolver só "FUNCTION_INVOCATION_FAILED". Em vez disso
 * seguimos de pé e o `app.ts` responde explicando o que falta configurar.
 */
export const bancoConfigurado = Boolean(process.env.DATABASE_URL);

if (!bancoConfigurado) {
  console.error(
    '[banco] DATABASE_URL não está definida. ' +
      'Local: copie .env.example para .env. ' +
      'Na Vercel: Settings → Environment Variables.',
  );
}

export let erroDoBanco: string | null = null;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Ajusta a URL de conexão para o ambiente serverless: uma conexão por
 * instância, e `pgbouncer=true` no pooler de transação (porta 6543).
 */
function prepararUrl(url: string): string {
  try {
    const endereco = new URL(url);

    if (!endereco.searchParams.has('connection_limit')) {
      endereco.searchParams.set('connection_limit', '1');
    }
    if (!endereco.searchParams.has('pool_timeout')) {
      endereco.searchParams.set('pool_timeout', '20');
    }
    if (endereco.port === '6543' && !endereco.searchParams.has('pgbouncer')) {
      endereco.searchParams.set('pgbouncer', 'true');
    }

    return endereco.toString();
  } catch {
    return url;
  }
}

/** Como o servidor está falando com o banco — sem a senha. */
export function comoConectamos(): {
  host: string | null;
  porta: number | null;
  modo: string;
  limiteDeConexoes: string | null;
} {
  try {
    const u = new URL(process.env.VERCEL ? prepararUrl(process.env.DATABASE_URL ?? '') : (process.env.DATABASE_URL ?? ''));
    const porta = u.port ? Number(u.port) : null;
    return {
      host: u.hostname || null,
      porta,
      modo:
        porta === 6543
          ? 'transaction pooler'
          : porta === 5432 && u.hostname.includes('pooler')
            ? 'session pooler'
            : 'conexão direta',
      limiteDeConexoes: u.searchParams.get('connection_limit'),
    };
  } catch {
    return { host: null, porta: null, modo: 'desconhecido', limiteDeConexoes: null };
  }
}

function criarCliente(): PrismaClient | null {
  const url = process.env.DATABASE_URL || 'postgresql://sem-configuracao/postgres';
  const endereco = process.env.VERCEL ? prepararUrl(url) : url;

  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
      datasources: { db: { url: endereco } },
      transactionOptions: { timeout: 30_000, maxWait: 15_000 },
    });
  } catch (erro) {
    erroDoBanco = erro instanceof Error ? erro.message : String(erro);
    console.error('[banco] falha ao iniciar o Prisma:', erroDoBanco);
    return null;
  }
}

const cliente = globalForPrisma.prisma ?? criarCliente();

if (cliente && process.env.NODE_ENV !== 'production') globalForPrisma.prisma = cliente;

export const db: PrismaClient =
  cliente ??
  (new Proxy(
    {},
    {
      get() {
        throw new Error(
          `O banco de dados não pôde ser iniciado: ${erroDoBanco ?? 'motivo desconhecido'}`,
        );
      },
    },
  ) as PrismaClient);

export const bancoIniciado = cliente !== null;

// ------------------------------------------------------------------ Auditoria

interface Log {
  acao: string;
  entidade: string;
  id?: string | null;
  alteracoes?: unknown;
  req?: Request;
  usuarioId?: string | null;
}

/**
 * Grava uma ação no histórico. Nunca lança: registrar log não pode derrubar
 * a operação que o usuário pediu.
 */
export async function registrarLog({ acao, entidade, id, alteracoes, req, usuarioId }: Log): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: acao,
        entity: entidade,
        entityId: id ?? null,
        changes: alteracoes ? (JSON.parse(JSON.stringify(alteracoes)) as object) : undefined,
        ip: req?.ip ?? null,
        userId: usuarioId ?? req?.usuario?.id ?? null,
      },
    });
  } catch (erro) {
    console.error('[auditoria]', (erro as Error).message);
  }
}
