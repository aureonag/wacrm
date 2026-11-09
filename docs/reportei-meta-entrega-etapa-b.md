# Integração Meta — entrega das etapas A e B (Meta Ads real)

Data: 2026-11-06. Migração 180 aplicada depois da entrega, com autorização (seção 6). Branch local: `feat/reportei-metas` (checkout `E:\Claude\crm-aureon\wacrm-bell`). Nada foi publicado, enviado ao remoto ou mesclado. Sem segredos neste arquivo.

## 1. O que mudou

| Área | Mudança | Arquivos principais |
|---|---|---|
| Vínculo da conta | O servidor descreve a conta na Meta com a conexão escolhida e lê 7 dias antes de vincular; nome, moeda e fuso vêm da Meta. Conexão obrigatória (sem cair na do usuário). Duplicata não apaga nada; vínculo em erro é recuperado na mesma linha (filtros e histórico ficam). Resposta por conta: `linked / recovered / already_linked / failed`. | `clients/[id]/integrations/route.ts`, `meta-link.ts`, `meta-accounts-dialog.tsx` |
| OAuth | O `state` agora é amarrado ao navegador (cookie HttpOnly com o nonce, consumido no retorno). Reconectar uma conexão exige a mesma identidade Meta. Nova identidade é adicionada sem sobrescrever outra; mesma identidade renova a própria conexão e revalida os vínculos dela. | `meta/connect`, `meta/callback`, `meta-oauth.ts`, `meta-connection.ts` |
| Leitura (Insights) | Linha ausente = "sem entrega" (zeros reais, `delivered:false`); linha com número malformado = erro (`invalid_payload`), não zero. Próxima página só é seguida se for `https://graph.facebook.com/vNN…`. Um evento por finalidade (lead, compra), sem somar eventos sobrepostos. Dia a dia com paginação completa. | `meta-ads.ts` |
| Estados | Valores têm estado: `null + why` (sem integração, leitura incompleta, falha, moedas diferentes, sem evento, sem base, tipo não configurado). | `overview.ts`, `overview-readings.ts` |
| CPL/CAC | O que era "CAC" (investimento ÷ leads) agora é **CPL**; vira `null` sem leads. CAC não existe sem dado de clientes adquiridos. | `overview.ts`, `meta-ads.ts` (`cplOf`) |
| Segmento do cliente | Configuração por cliente (leads, e-commerce, misto, não configurado); não há mais sorteio. Investimento é contexto, não vence nem perde. | `segment/route.ts`, `segment-select.tsx` |
| Dashboard geral | Lê a Meta Ads real (`GET /api/operational/reportei/overview`). Séries do mês vêm do dia a dia real e o número grande é a soma da própria série. A demonstração virou "Prévia com números fictícios", com aviso permanente. | `dashboards/page.tsx`, `overview-real.ts`, `overview/route.ts` |
| Relatórios e dashboards do cliente | Gerados a partir das contas Meta realmente vinculadas. Rede sem fonte real não ganha bloco (lista `skipped`); indicador sem dado fica no documento como `unavailable` com o motivo. Modelo fictício só com `demo: true`, marcado e sem compartilhamento por link. | `meta-doc.ts`, `reports/generate`, `client-dashboards` |
| Saídas | Aviso de modelo fictício aparece também na impressão/PDF e na página pública; o servidor recusa criar link público de modelo fictício. | editores, `r/[token]`, `reports/[id]/share` |

Reaproveitado: OAuth, credencial cifrada, descoberta de contas, leitura de Insights, filtros de campanha, tabela por cliente, painel do cliente, `createSavedReport`.

## 2. Matriz de funcionalidades

| Funcionalidade | Estado |
|---|---|
| Meta Ads: leitura agregada e diária, vínculo validado, recuperação | **Operacional com prova real** (conta `Agencia Aureon`) |
| Dashboard geral, relatório e dashboard do cliente com Meta real | **Operacional com prova real** (relatório de teste gerado e apagado) |
| Estados ausência/zero/erro, CPL, eventos sem sobreposição, aviso de demo | Implementado com teste automatizado |
| Duas identidades Meta por empresa | Implementado no código; **depende da migração 180** para o mesmo usuário do CRM ter duas. Hoje: bloqueia com aviso em vez de sobrescrever |
| Segmento do cliente (salvar) | Implementado; **depende da migração 180**. Antes dela, a tela avisa e todos os clientes ficam "não configurado" |
| Reconectar com a mesma identidade preservando vínculos | Implementado com teste automatizado; **não provado em ambiente real** (exige perder/renovar uma sessão) |
| Segunda pessoa conectando a própria Meta | Implementado (uma conexão por usuário do CRM já era suportada); **sem prova real** (só existe 1 conexão) |
| Google, Instagram, Facebook, TikTok, YouTube, LinkedIn | Fora desta entrega: sem bloco e sem número (nada fictício) |
| Atribuição (pedido x aplicado), fuso da conta na coleta, saúde por ativo, deduplicação de alertas, volume mínimo configurável | **Não feito** (P1 do repasse, fora das etapas A e B pedidas) |
| Instagram/Facebook orgânico | Etapa D, não iniciada |

## 3. Regras adotadas (cada uma pode ser ajustada)

- Lead canônico: `lead` (cai em `offsite_conversion.fb_pixel_lead` só se `lead` não vier). Compra e valor: `purchase` (cai em `offsite_conversion.fb_pixel_purchase`). Nunca somados. Override por cliente tem coluna preparada na migração 180, sem interface ainda.
- Faturamento = **valor de compras atribuído pela Meta**, não receita recebida.
- Destaque/atenção: ±10% contra o período anterior, só métricas do tipo do cliente (leads: leads e CPL; e-commerce: compras, valor, ROAS, CPA), ao menos 10 leads ou 5 compras nos dois períodos, cliente lido por completo. Máximo de 6 por seção. Regra v1 exibida na tela. O corte de volume mínimo é proposta minha; o repasse pede que o número seja decidido por vocês.
- Totais: somam moeda única; ROAS e CPL recalculados da soma, só dos clientes que têm os dois lados; cada número mostra "N de M clientes".
- Comparação do mês: dias equivalentes do mês anterior (não o mês inteiro).

## 4. Conferência com a Meta (leitura independente)

Método: script local que lê a conta direto na Graph API (v21.0, mesmo token cifrado, sem imprimir o token) e compara com o que o CRM devolve. **Não foi aberto o Gerenciador de Anúncios** (sem acesso); a comparação com a tela nativa fica para você.

Conta `act_1091471148801226` (BRL, America/Sao_Paulo, sem filtro de campanha).

| Janela (fechada) | Métrica | Graph direto | CRM |
|---|---|---:|---:|
| 08/10 a 05/11/2026 | Investimento | 430,79 | 430,79 |
| 09/09 a 07/10/2026 (anterior) | Investimento | 189,00 | 189,00 |
| 08/10 a 05/11/2026 | CPC / CTR | 0,2304 / 3,2169% | 0,23 / 3,22% (arredondamento de exibição) |
| 01/10 a 31/10/2026 | Investimento: agregado × soma de 31 dias | 458,78 × 458,78 | — (confere a regra de série) |
| 01/10 a 06/10/2026 | Investimento (série diária do mês anterior) | 87,85 | 87,85 |

Leads e compras: a conta não registrou eventos `lead` nem `purchase` (ficam como "sem evento", não zero).

Janelas que incluem **hoje** mudam de uma leitura para outra (dia ainda acumulando): 438,18 → 438,25 → 438,60 em três leituras no mesmo dia; e o agregado do mês em andamento difere da soma dos dias por centavos entre chamadas feitas em instantes diferentes. Janelas fechadas bateram exatamente. Não forcei igualdade nem escondi a diferença.

Pendente para o aceite: conferir na tela nativa da Meta (mesma conta, 08/10 a 05/11/2026, sem filtro): investimento 430,79; impressões 58.130; alcance 46.903; cliques (todos) 1.870; CTR 3,22%; CPC 0,23. Repetir com uma conta de leads, uma com compras e uma sem entrega quando houver acesso (A15, A18, A19).

## 5. Testes e verificações executados

- `npx vitest run src/lib/reportei`: 23 arquivos, 238 testes passando.
- Suíte completa: 2159 passam, **5 falham e não são desta branch**: `src/lib/currency.test.ts` (3, formatação de moeda dependente da localidade do Node) e `src/lib/dashboard/date-utils.test.ts` (2). Esses arquivos e os que eles testam não foram tocados (`git diff` contra a base vazio).
- `npx tsc --noEmit`: sem erros. `npx eslint src`: 0 erros (85 avisos antigos).
- Ao vivo, no servidor local: dashboard geral real; relatório gerado pelo assistente com template Tráfego Pago (resultado: `demo:false`, 12 indicadores Meta, `skipped: google_ads, tiktok_ads`, indicadores sem dado marcados); o relatório de teste foi **apagado** em seguida.
- Não provados em ambiente real: reconexão após queda, segunda pessoa conectando, expiração/revogação real, outro computador (A03, A09, A26, A28), erro de rede/limites.

## 6. Banco de dados

O servidor local usa o **banco de produção** (`heesqqbjssficymgkdme`). Antes deste repasse, com a autorização geral da sessão, já estavam aplicadas as migrações aditivas **178** (nome da automação) e **179** (`reportei_reports.template_id`). **Nada novo foi aplicado.**

Aplicada em 06/11/2026, com autorização específica do Allan: `supabase/migrations/180_reportei_meta_integration_states.sql`. Conferido depois: colunas e índice criados, 1 conexão e 1 vínculo intactos, tipo do cliente salvo, lido e zerado pelo app.

- Destino: produção, único banco.
- Impacto: colunas novas `NULL` em `reportei_client_settings` (segmento e eventos), `meta_connections` (tipo do token, escopos, fim do acesso, última checagem) e `ad_integrations` (último estado). A unicidade de `meta_connections` troca de `(account_id, user_id)` para `(account_id, fb_user_id)`; hoje a tabela tem 1 linha e o próprio script aborta se houver identidade repetida. Nenhuma linha é apagada ou reescrita.
- Recuperação: bloco de comandos no cabeçalho do arquivo (remove as colunas e recria a unicidade antiga).
- O que muda quando for aplicada: o segmento passa a ser salvável e várias identidades por usuário do CRM passam a funcionar. O código não grava nas colunas de estado ainda.

## 7. Ações humanas

1. **Sua autorização específica** para a migração 180 (acima).
2. **Aplicativo Meta da Aureon** (o do `META_ADS_APP_ID`, painel Meta for Developers), para cada integrante que for conectar a própria conta: *Funções do aplicativo* → adicionar como Desenvolvedor ou Testador, enquanto o app estiver em modo de desenvolvimento. Finalidade: permitir o login sem revisão. Verifique o modo do app e se `ads_read` tem acesso avançado só se for ler contas de terceiros que não sejam da equipe.
3. **URL de retorno**: a configuração local retorna para `http://localhost:3000`, que só funciona na máquina de quem roda o servidor. Para outra pessoa conectar de outro computador é preciso um endereço de teste protegido ou usar o endereço publicado; não abri túnel nem mexi no aplicativo.
4. Conferir na tela nativa da Meta os números da seção 4.
5. Configurar o **tipo de cada cliente** na página dele (depois da migração).

## 8. Como a equipe conecta (local)

1. Abrir o cliente em Reportei → Clientes → Integrações → "Integrar" → entrar com o Facebook.
2. Escolher a conta na lista; o servidor valida na Meta e mostra, conta por conta, o resultado (integrada, recuperada, sem acesso, sem entrega).
3. O Dashboards, relatórios e dashboards do cliente passam a usar os números dessa conta.
