import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cria (ou atualiza) um usuário administrador.
 *
 *   npm run criar-admin -- "Guilherme Lemos" guilherme@loja.com
 *   npm run criar-admin -- "Guilherme Lemos" guilherme@loja.com MinhaSenha123
 *
 * Sem a senha, o script gera uma e mostra na tela.
 * Se o e-mail já existir, o usuário é promovido a administrador e a senha
 * é trocada — serve também para "esqueci a senha".
 */

const db = new PrismaClient();

function gerarSenha(): string {
  const letras = 'abcdefghijkmnopqrstuvwxyz';
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const alfabeto = letras + maiusculas + numeros;

  const sorteia = (fonte: string) => fonte[crypto.randomInt(fonte.length)];

  const base = [sorteia(maiusculas), sorteia(numeros)];
  for (let i = 0; i < 8; i += 1) base.push(sorteia(alfabeto));

  return base.sort(() => crypto.randomInt(3) - 1).join('');
}

async function main() {
  const [nome, email, senhaInformada] = process.argv.slice(2);

  if (!nome || !email) {
    console.error('\nComo usar:');
    console.error('  npm run criar-admin -- "Nome Completo" email@dominio.com [senha]\n');
    process.exit(1);
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`\n❌ "${email}" não parece um e-mail válido.\n`);
    process.exit(1);
  }

  const senha = (senhaInformada ?? '').trim() || gerarSenha();

  if (senha.length < 6) {
    console.error('\n❌ A senha precisa ter ao menos 6 caracteres.\n');
    process.exit(1);
  }

  const jaExiste = await db.user.findUnique({ where: { email: email.toLowerCase() } });

  const usuario = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { name: nome, password: await bcrypt.hash(senha, 10), role: 'ADMIN', active: true },
    create: {
      name: nome,
      email: email.toLowerCase(),
      password: await bcrypt.hash(senha, 10),
      role: 'ADMIN',
      active: true,
    },
  });

  console.log(`\n${jaExiste ? '🔄 Conta atualizada' : '✅ Conta criada'}: administrador\n`);
  console.log('  ┌────────────────────────────────────────────────');
  console.log(`  │  Nome:   ${usuario.name}`);
  console.log(`  │  E-mail: ${usuario.email}`);
  console.log(`  │  Senha:  ${senha}`);
  console.log('  └────────────────────────────────────────────────\n');
  console.log('  Guarde esses dados. A senha pode ser trocada depois em');
  console.log('  Configurações → Sistema → Alterar senha.\n');
}

main()
  .catch((erro) => {
    console.error('\n❌ Erro:', erro instanceof Error ? erro.message : erro, '\n');
    process.exit(1);
  })
  .finally(() => db.$disconnect());
