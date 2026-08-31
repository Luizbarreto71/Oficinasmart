# 🔧 Oficina do Smartphone — Gestão

Sistema de gestão de **estoque e vendas** para loja de smartphones, acessórios, peças e
serviços. Controle de aparelhos por **IMEI**, produtos por quantidade, PDV com caixa,
pré-vendas, trocas de usados, seminovos, transferências entre unidades, relatórios em
PDF/Excel/CSV, modo offline e auditoria.

> **Uma variável de ambiente. Um projeto. Um deploy.**
> Só a `DATABASE_URL` do Supabase é obrigatória — o resto o sistema resolve sozinho.

---

## 🚀 Começando

```bash
npm install
cp .env.example .env
```

Abra o `.env` e troque a linha `DATABASE_URL` pela do seu banco no Supabase
(**Connect → ORMs → Prisma**, use o **Session pooler**, porta `:5432`).

```bash
npm run db:deploy     # cria todas as tabelas
npm run db:seed       # cria as unidades e as categorias
npm run dev           # http://localhost:5173
```

Crie o usuário administrador:

```bash
npm run criar-admin -- "Nome do Dono" email@dominio.com
```

O comando mostra a senha gerada. Para escolher a senha, passe como terceiro argumento.
Rodar de novo com o mesmo e-mail **troca a senha** (é assim que se recupera um acesso).

Quer ver com dados fictícios? `npm run db:exemplos` cria alguns smartphones com IMEI,
acessórios, uma peça, um serviço e uma venda de demonstração.

---

## 🧩 Como o projeto é organizado

```
oficina-do-smartphone/
├── api/index.js          # entrada da API na Vercel (GERADO por npm run build)
│
├── server/               # o backend inteiro — um arquivo por assunto
│   ├── app.ts            # monta a API e liga as rotas
│   ├── db.ts             # conexão + log de auditoria
│   ├── core.ts           # erros, validação, paginação, datas (fuso da loja)
│   ├── auth.ts           # login, tokens, proteção de rota
│   ├── permissoes.ts     # quem pode o quê (fonte da verdade)
│   ├── estoque.ts        # motor de estoque: movimentar(), transferir()
│   ├── produtos.ts       # cadastro, busca, edição, fotos
│   ├── devices.ts        # aparelhos físicos (DeviceUnit) — IMEI, bateria, garantia
│   ├── vendas.ts         # PDV direto, cancelamento, recibo
│   ├── vendas-service.ts # onde a venda acontece (baixa estoque, resolve aparelho)
│   ├── prevendas.ts      # pré-venda → caixa → finalização
│   ├── caixa.ts          # turno de caixa (abrir, fechar, resumo)
│   ├── trocas.ts         # aparelhos usados recebidos como pagamento
│   ├── seminovos.ts      # usados no estoque (de troca ou compra direta)
│   ├── movimentacoes.ts  # entrada, saída, ajuste, transferência, retirada, histórico
│   ├── dashboard.ts      # cards, gráfico e alertas
│   ├── relatorios.ts     # os relatórios
│   ├── exportar.ts       # motor genérico PDF / Excel / CSV
│   ├── recibo.ts         # comprovante de venda em PDF
│   ├── metas.ts          # placar de metas por vendedor
│   ├── aberto.ts         # valores em aberto (fiado)
│   ├── sistema.ts        # importar planilha, backup, Google Sheets, taxas, dados da loja
│   ├── cadastros.ts      # categorias, fornecedores, clientes, usuários, logs
│   ├── unidades.ts       # unidades (Loja, Estoque…)
│   ├── notificacoes.ts   # avisos na tela
│   └── vercel.ts         # empacotado em api/index.js
│
├── shared/               # código usado pelo site e pela API
│   ├── campos.ts         # catálogo de campos por categoria
│   ├── custo.ts          # custo médio ponderado
│   ├── taxas.ts          # taxas da maquininha
│   ├── trocas.ts         # defeitos, situações Anatel, validação de IMEI (Luhn)
│   ├── ordenar.ts        # ordem "de prateleira" (natural)
│   └── loja.ts / cores.ts / lista-atacado.ts
│
├── src/                  # o frontend (React + Vite)
│   ├── pages/            # Login, Dashboard, Estoque, Caixa, Vendas, Trocas…
│   ├── components/       # ui/, layout/, products/, vendas/, dashboard/
│   ├── contexts/         # Auth, Theme, Toast, Unit
│   ├── hooks/            # React Query
│   ├── services/         # chamadas à API
│   └── lib/              # api, offline, format, permissões
│
├── prisma/schema.prisma  # o banco
└── .env                  # ← a única configuração
```

### Comandos

```bash
npm run dev          # site + API na mesma porta (5173)
npm run dev:api      # só a API em :4000 (para testar com curl/Insomnia)
npm run build        # versão de produção → dist/ + api/index.js
npm run typecheck    # confere os tipos do frontend e do servidor

npm run db:deploy    # cria/atualiza as tabelas (produção)
npm run db:migrate   # cria uma migration nova (depois de mexer no schema)
npm run db:seed      # unidades + categorias
npm run db:exemplos  # + produtos e venda de demonstração
npm run criar-admin  # cria um administrador / troca a senha
npm run db:studio    # abre o Prisma Studio
```

---

## 📦 Tipos de produto: por aparelho x por quantidade

O campo **`tipoControle`** de cada produto decide como o estoque é controlado.

| | **UNITARIO** (por aparelho) | **QUANTIDADE** |
|---|---|---|
| Para que serve | Smartphones, seminovos | Acessórios, peças, serviços |
| Como o estoque vive | Uma linha `DeviceUnit` por aparelho físico | Um saldo por unidade (`Stock`) |
| IMEI | **Único no banco** — não deixa cadastrar o mesmo aparelho duas vezes | Opcional, sem unicidade forte |
| Cada aparelho guarda | IMEI, IMEI 2, nº série, condição, **saúde da bateria**, **garantia**, custo próprio, situação Anatel | — |
| Na venda | escolhe-se **o aparelho** (por IMEI, série ou da lista) | informa-se a quantidade |
| Entrada / baixa / ajuste | aba **Aparelhos** na tela de Estoque, ou `/api/devices` | tela **Movimentação** |

A categoria tem um `tipoControlePadrao` que sugere o tipo ao cadastrar um produto novo
(Smartphones e Seminovos → por aparelho; o resto → por quantidade).

O `Stock.quantity` de um produto UNITARIO é sempre recalculado a partir da contagem de
aparelhos `EM_ESTOQUE` — dentro da mesma transação que os movimenta.

---

## 🔐 Perfis de acesso

| Ação | Vendedor | Caixa | Gerente | Admin |
|---|:-:|:-:|:-:|:-:|
| Montar pré-vendas | ✅ | ✅ | ✅ | ✅ |
| Registrar trocas | ✅ | ✅ | ✅ | ✅ |
| Cobrar e finalizar (PDV/caixa) | ❌ | ✅ | ❌ | ✅ |
| Cadastrar/editar produtos e estoque | ❌ | ❌ | ✅ | ✅ |
| Ver e exportar relatórios / metas | ❌ | ❌ | ✅ | ✅ |
| Cancelar vendas | ❌ | ✅ | ❌ | ✅ |
| Usuários, backup, importar planilha, auditoria | ❌ | ❌ | ❌ | ✅ |

O sistema não deixa remover nem rebaixar o último administrador ativo. Gerente e Vendedor
enxergam só a sua unidade; o Administrador vê todas.

---

## ☁️ Publicar na Vercel

1. Importe o repositório. O `vercel.json` já cuida do build, das rotas e da função da API.
2. Em **Settings → Environment Variables**, adicione a `DATABASE_URL` — em produção use a
   URL do **Transaction pooler** (porta `6543`), que aguenta muitas funções ao mesmo tempo.
3. Deploy. Se ainda não criou as tabelas no banco de produção, rode uma vez localmente com
   o `.env` apontando para lá: `npm run db:deploy && npm run db:seed`.

Site e API ficam no mesmo endereço (`/` → o sistema, `/api` → a API).

---

## 🧠 Decisões que valem saber

- **IMEI é único no banco** (`DeviceUnit.imei @unique`). É a garantia real contra aparelho
  duplicado — não depende de checagem na tela.
- **A venda congela o custo do aparelho vendido** (do `DeviceUnit`, não a média do produto).
- **Cancelar uma venda não a apaga**: ela vira CANCELADA e os aparelhos voltam ao estoque
  como movimentação de CANCELAMENTO.
- **Pré-venda não reserva estoque**: quem garante a peça é o caixa na finalização.
- **As fotos ficam no banco** (o navegador reduz para ~1200px antes de enviar) — sem
  serviço de arquivos, roda na Vercel.
- **O segredo do login é gerado sozinho** na primeira execução e guardado no banco.
- **Todo corte de dia** acontece no fuso `America/Sao_Paulo`, com horário de verão ciente.
- **Modo offline**: sem internet, vendas e cadastros vão para uma fila no navegador e são
  reenviados quando a conexão volta.

---

## 🎨 Visual

Azul-escuro `#0F172A` na navegação, azul `#2563EB` de destaque, verde `#16A34A` para
operações positivas, vermelho `#DC2626` para exclusões/alertas. Fonte Inter, tema
claro/escuro, menu lateral recolhível, tabela que vira card no celular.
