# Integração Meta — inventário (Etapa A)

Data: 2026-11-06. Branch: `feat/reportei-metas` (checkout `wacrm-bell`). Sem segredos neste arquivo.

## Ambiente

- O servidor local (`localhost:3000`, `wacrm-dev-bell`) **usa o banco de produção**: `NEXT_PUBLIC_SUPABASE_URL` do `.env.local` aponta para o projeto Supabase `heesqqbjssficymgkdme` (wacrm), o mesmo da produção. Rodar em localhost não isola o banco.
- Consequência: nenhuma migração nova é aplicada sem autorização específica. Em 06/11 já tinham sido aplicadas, antes deste repasse e com a autorização geral da sessão, as migrações **178** (nome da automação) e **179** (`reportei_reports.template_id`). Ambas aditivas.
- Variáveis Meta presentes no `.env.local` (valores não listados): `META_ADS_APP_ID`, `META_ADS_APP_SECRET`, `META_ADS_CONFIG_ID` (se definida), `NEXT_PUBLIC_SITE_URL`.
- `NEXT_PUBLIC_REPORTEI_DEMO_ICONS=1` existe só no `.env.local` (ícones de rede demonstrativos nos cartões de clientes).

## Estado dos dados (banco compartilhado, contagens)

| Item | Valor |
|---|---|
| Conexões Meta (`meta_connections`) | 1 (1 conectada, 1 identidade Meta) |
| Vínculos de conta (`ad_integrations`) | 1, de 1 cliente, sem erro, com conexão |

Há, portanto, uma única conta real para conferir números.

## O que já funciona com dado real

- Entrar com Facebook (OAuth), troca por token de longa duração, token cifrado, renovação.
- Descoberta de contas de anúncios por conexão da empresa.
- Leitura de Insights agregado e diário de Meta Ads; campanhas selecionáveis por vínculo.
- Tabela de dashboards por cliente (`dashboards/tabela`) e painel por cliente (`dashboards/[clientId]`).
- Relatório salvo a partir da coleta real (`createSavedReport`), usado pelas automações.

## O que é demonstração hoje (a corrigir na Etapa B)

| Onde | Fonte atual |
|---|---|
| Dashboard geral (`dashboards/page.tsx`) | `demoOverview` e séries sintéticas (`dailySeries`) |
| Relatório gerado pelo assistente (`reports/generate`) | `demoSource` |
| Dashboards editáveis do cliente (`dashboard-doc.ts`) | `demoSource` |
| Prévia de template (`templates/[id]`) | `demoSource` (prévia, assim deve ficar, identificada) |

## Defeitos confirmados no código (da lista do repasse)

1. Vínculo (`clients/[id]/integrations`) aceita nome/moeda/fuso do navegador, não testa a conta na Meta, ignora duplicatas e, sem `connectionId`, cai na conexão do usuário.
2. `meta_connections` é único por `(account_id, user_id)`: uma autenticação Meta diferente do mesmo usuário do CRM sobrescreve a anterior sem aviso.
3. O `state` do OAuth é assinado e expira, mas não é amarrado ao navegador nem consumido (pode ser reutilizado dentro de 10 min).
4. `parseInsights` devolve zeros para linha ausente e para campo malformado; falha e "sem entrega" não se distinguem.
5. Paginação segue `paging.next` com o token sem validar o destino.
6. `overview.ts`/`dashboards` chamam de CAC o que é investimento ÷ leads (CPL); segmento é sorteado; investimento é tratado como "mais é melhor".
7. Reconectar atualiza só a conexão; os vínculos em erro continuam em erro.
8. Saúde da conexão usa `/me`, que não prova acesso ao ativo.

## Migrações preparadas (arquivo, NÃO aplicadas)

- `180_reportei_meta_integration_states.sql` (APLICADA em 06/11/2026 com autorização) — banco de destino: **produção** (`heesqqbjssficymgkdme`, único banco). Detalhes de impacto e recuperação no cabeçalho do próprio arquivo.

## Ações humanas pendentes (Meta)

Ver o fim do relatório de entrega; só serão pedidas quando uma etapa depender delas.
