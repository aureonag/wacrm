# Integração Meta — correções da revisão independente e fechamento do piloto Ads

Data: 2026-11-06. Branch local `feat/reportei-metas` (checkout `E:\Claude\crm-aureon\wacrm-bell`). Nada publicado, enviado ao remoto, mesclado ou alterado na Meta. Sem segredos neste arquivo. Complementa `reportei-meta-entrega-etapa-b.md`.

## 1. Os cinco pontos da revisão

| # | Ponto | O que mudou | Onde | Testes |
|---|---|---|---|---|
| 1 | Payload inválido não é "sem entrega" | Só uma resposta com `data` sendo uma lista (mesmo vazia) é resposta válida. `data` ausente, nulo, não-lista, linha que não é objeto, várias linhas para um período, número ausente/negativo/não finito, campo opcional presente e quebrado, `actions`/`action_values` malformados, JSON inválido com status 200: tudo vira `invalid_payload` (a conta aparece como falha). Vale para Insights agregado e diário, dia a dia, campanhas, lista de contas e `paging.next` fora da Graph. | `meta-ads.ts` (`dataRows`, `readActions`, `metaNumber`, `parseInsightsStrict`, `parseDayRows`) | `meta-ads.test.ts`, `meta-fetch.test.ts` (fetch simulado) |
| 2 | Um evento canônico de compra | O evento é escolhido uma vez, a partir de `actions`; quantidade e valor vêm **desse mesmo tipo** (o valor de outro tipo nunca é emprestado). O tipo escolhido fica no resultado (`leadEvent`, `purchaseEvent`) e aparece na descrição do indicador. Contas que contam com eventos diferentes não são somadas (`mixed_events`). O evento pode ser fixado por cliente (usado exatamente; se a linha não o traz, não há resultado, sem plano B). | `meta-ads.ts`, `overview-readings.ts`, `meta-doc.ts`, `segment/route.ts`, `segment-select.tsx` | `meta-ads.test.ts`, `overview-readings.test.ts`, `report-data.test.ts` |
| 3 | Contas por ID/vínculo, nunca por nome | O gerador de relatório recebe `accountId` (`act_…`), que precisa estar vinculado ao cliente; o texto `account` é só rótulo. Sem id: 400 (`account_id_required`); id não vinculado: 400 (`unknown_account`). O bloco do documento guarda `accountId` e a atualização do dashboard casa por ele (duas contas com o mesmo nome continuam distintas). | `generate/route.ts`, `generate-input.ts`, `doc.ts`, `meta-doc.ts`, wizard | `generate-input.test.ts`, `meta-refresh.test.ts` |
| 4 | Filtro de campanha inválido nunca amplia | Filtro com lista vazia, id fora do formato, item não-string ou não-lista é recusado, na entrada (400) e também dentro da leitura (`invalid_filter`: a conta falha, não é lida inteira). Campanhas escolhidas precisam **existir na conta** (400 `unknown_campaign`), tanto no relatório quanto ao salvar o filtro do vínculo. `[]` deixou de significar "conta toda" (a conta toda é `null`). | `meta-ads.ts` (`campaignFilterParam`), `generate-input.ts`, `campaigns/route.ts` | `meta-ads.test.ts`, `meta-fetch.test.ts`, `generate-input.test.ts`, `report-data.test.ts` |
| 5 | Atualizar dashboard preservando as edições | A atualização não reconstrói mais pelo modelo. Mantém: ordem dos blocos e dos indicadores, títulos, textos e análises, blocos ocultos, tamanhos, destaque, indicadores removidos (continuam removidos) e adicionados (ganham número se a chave é suportada), escolha de comparação de cada indicador e período próprio do indicador (não é tocado). Só os números mudam. Conta que não pôde ser lida deixa os indicadores dela **sem número, com o motivo** (não mostra o número do período anterior como se fosse do novo) e a tela avisa quais. Rede sem fonte real vira "sem fonte de dados real". Vale também para o modelo fictício. O editor deixou de injetar números fictícios em documento real: indicador/rede adicionados ficam vazios com o motivo. | `meta-doc.ts` (`refreshPreserving`, `refreshRealDoc`), `dashboard-doc.ts`, `client-dashboards/[id]/route.ts`, editores | `meta-refresh.test.ts` (11 cenários) |

## 2. O que foi feito depois dos cinco pontos

| Item | Resultado |
|---|---|
| Saúde por conta | A checagem diária, além do login (`/me`), descreve **cada conta vinculada** na Meta e grava `status`, `last_error`, `last_state` e `last_verified_at` no vínculo. Perder uma conta com o login saudável é detectado. Falha temporária da Meta não muda o estado. Aviso (sino) uma única vez, na transição de funcionando para erro; conta que volta é marcada como funcionando. Vínculo e recuperação também gravam o estado. `checkLinksOfConnection`, `healthPatch`, `becameBroken`, `accountDownNotice`. |
| Fuso | O fuso da conta (vindo da Meta) é guardado no resultado. O intervalo pedido é lido no fuso da conta e **nunca passa do "hoje" dela**; quando é cortado, a comparação é refeita com o mesmo número de dias, e o intervalo realmente lido (`range`, `compareRange`) fica no resultado. Intervalo todo no futuro da conta é erro, não leitura vazia. Fuso desconhecido: nada é cortado nem presumido. A série do mês faz o mesmo por conta. `account-time.ts`. |
| Atribuição | Pedido (`requested`), modo (`meta_default`/`explicit`) e o que a Meta informa (`effective`, ou desconhecido) ficam no resultado e na descrição dos indicadores de conversão. Janelas por vínculo (1d/7d/28d clique, 1d/7d/28d visualização): API e diálogo "Atribuição" no vínculo. A coluna depende da **migração 181** (preparada, não aplicada); sem ela, tudo funciona com a atribuição padrão e a tela avisa. Observado ao vivo: a Meta devolve `attribution_setting = "multiple"` para a conta de teste (vários conjuntos com configurações diferentes); está preservado como veio. |
| Eventos por cliente | Evento de lead e de compra por cliente (API + dois seletores na página do cliente, em `reportei_client_settings`, migração 180 já aplicada). |
| Limites provisórios | `RULES.provisional = true` e aviso na tela: ±10%, mínimo de 10 leads ou 5 compras e 6 cartões são proposta nossa, ainda não aprovados nem configuráveis. |

## 3. Banco de dados

- Aplicada com autorização específica (06/11/2026): `180_reportei_meta_integration_states.sql`.
- **Preparada, NÃO aplicada**: `supabase/migrations/181_reportei_attribution_windows.sql`.
  - Destino: produção (`heesqqbjssficymgkdme`), único banco; o servidor local aponta para ele.
  - Impacto: uma coluna nova `ad_integrations.attribution_windows text[]`, `NULL` por padrão (= atribuição padrão da Meta, como hoje), com CHECK de janelas conhecidas (1 a 4). Nenhuma linha é apagada ou reescrita; nenhum número muda até alguém escolher janelas para um vínculo.
  - Recuperação: `ALTER TABLE ad_integrations DROP COLUMN IF EXISTS attribution_windows;`
  - O código já funciona sem ela.

## 4. Evidências

Testes: `npx vitest run src/lib/reportei`: 31 arquivos, 321 testes passando. Suíte completa: 2242 passam, **5 falham e não são desta branch** (`currency.test.ts` 3 e `date-utils.test.ts` 2, formatação dependente da localidade do Node; arquivos não tocados). `npx tsc --noEmit` sem erros; `npx eslint src` 0 erros.

Ao vivo, no servidor local, com a sessão do app e a conta `Agencia Aureon` (tudo criado foi apagado em seguida):

| Cenário | Resultado |
|---|---|
| Relatório só com o nome da conta | 400 `account_id_required` |
| `accountId` não vinculado (`act_999`) | 400 `unknown_account` |
| Campanha `["abc"]` / `[]` | 400 `Invalid integrations` |
| Campanha com formato válido que não existe na conta (`["1"]`) | 400 `unknown_campaign` |
| Relatório válido por `accountId` | 201; `demo:false`; bloco com `accountId`; fuso `America/Sao_Paulo`; intervalo 08/10 a 06/11; atribuição `meta_default`, aplicada `multiple`; `skipped: google_ads, tiktok_ads` |
| Dashboard real, editado (análise, título do bloco, título e destaque do indicador, ordem trocada) e depois período novo | análise, títulos, destaque, ordem e `accountId` preservados; gasto mudou de 439,41 (30 dias) para 100,58 (7 dias); `unreadable: []` |
| Evento de compra `omni_purchase` fixado para o cliente | compras e faturamento ficam sem número com motivo "sem evento" (a conta não tem esse evento); depois voltou ao padrão |
| Evento inválido (`<script>`) / PUT vazio | 400 / 400 |
| Atribuição: GET, PUT válido, janela desconhecida, lista vazia | `available:false`, 503 `migration_pending`, 400, 400 (a 181 ainda não foi aplicada) |

Conferência numérica com a Graph (janelas fechadas) está na seção 4 de `reportei-meta-entrega-etapa-b.md` e continua válida.

## 5. O que NÃO está provado, e por quê

1. **Reconexão em ambiente real.** Eu ia provar a revalidação marcando o vínculo real como "erro" no banco de produção e rodando a revalidação com o token guardado. O ambiente bloqueou essa ação (alteraria dado de produção e usaria a credencial guardada), e não a contornei. O que existe: testes automatizados da revalidação e da saúde por conta com banco e Meta simulados (um vínculo perdido, um com falha temporária, um que volta, sem repetir aviso), além da leitura real de acesso à conta. Para a prova real, faltam duas opções suas: (a) você refaz o login do Facebook com a mesma conta (o `callback` renova a conexão e revalida o vínculo, preservando id, filtros e relatórios) e eu confiro o resultado; ou (b) você autoriza expressamente que eu marque o vínculo de teste como erro por alguns segundos e rode a revalidação.
2. **Segunda identidade Meta.** Sem acesso: só existe uma conexão. O que existe: `meta-connection.test.ts` (7 cenários: uma segunda pessoa recebe conexão independente e a primeira não muda; a mesma identidade renova a própria conexão sem duplicar; antes da 180 a outra identidade do mesmo usuário é recusada sem sobrescrever; depois da 180 é adicionada). A prova real precisa de uma segunda pessoa com papel no aplicativo Meta autorizando a própria conta.
3. Conferência na tela nativa da Meta (Gerenciador de Anúncios): pendente, números na seção 4 de `reportei-meta-entrega-etapa-b.md`.
4. Segmento por cliente nas telas com mais de um cliente real: só existe um cliente com vínculo.
5. Instagram e Facebook não foram iniciados, conforme combinado (antes disso, fechar o piloto Ads).

## 6. Ações humanas

1. Escolher uma das opções do item 5.1 para a prova real de reconexão.
2. Se quiser as janelas de atribuição: autorizar a migração 181.
3. Aplicativo Meta da Aureon (`META_ADS_APP_ID`): *Funções do aplicativo* → adicionar cada integrante que vai conectar a própria conta (Desenvolvedor ou Testador) enquanto o app estiver em modo de desenvolvimento; é o que habilita a prova da segunda identidade.
4. Conferir os números na tela nativa da Meta.
5. Aprovar (ou ajustar) os limites provisórios de destaque e atenção.
