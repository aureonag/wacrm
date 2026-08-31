# Prospecção — configurando o motor de busca em segundo plano

O módulo "Prospecção" pesquisa empresas em segundo plano (Google
Places → enriquecimento de site/Instagram → deduplicação → pontuação
ICP) através de um motor de estados resumível, no mesmo espírito das
automações e fluxos já existentes no CRM.

## O que já funciona sem nenhuma configuração de cron

Quando o usuário pede uma busca no chat, o backend cria a execução e
roda **imediatamente** o primeiro passo do motor (uma chamada ao
Google Places, por exemplo) — o chat já mostra progresso real na
mesma conversa, sem esperar nada externo.

## Por que o cron é necessário mesmo assim

Uma busca real pode levar várias páginas de resultados e dezenas de
candidatos para enriquecer — mais do que cabe em uma única chamada
síncrona. O motor avança **um passo limitado por vez** e devolve o
controle; alguém precisa chamar `GET /api/prospecting/cron`
periodicamente para que a execução continue até `awaiting_review`.
Isso é exatamente o mesmo modelo já usado por `/api/automations/cron`
e `/api/flows/cron` — **nada dentro do container/processo da
aplicação agenda isso sozinho.**

## Configuração

1. Gere (ou reaproveite) o segredo já usado pelas automações:
   ```bash
   openssl rand -hex 32
   ```
2. Defina `AUTOMATION_CRON_SECRET` no ambiente de produção (Hostinger
   → hPanel → Variáveis de ambiente do site). Este é o **mesmo**
   segredo usado por `/api/automations/cron` e `/api/flows/cron` —
   não crie um segredo separado só para a Prospecção.
3. Aponte um agendador externo para rodar, a cada 1–2 minutos:
   ```bash
   curl -H "x-cron-secret: SEU_SEGREDO" \
     https://SEU-DOMINIO/api/prospecting/cron
   ```
   Opções recomendadas, em ordem de preferência:
   - **Painel de cron da própria Hostinger**, se o plano contratado
     tiver essa opção (hPanel → Cron Jobs) — mantém o agendamento
     dentro da mesma infraestrutura, sem depender de um serviço
     externo.
   - Um serviço gratuito de ping/cron externo (ex.: cron-job.org,
     Healthchecks.io) apontando para a mesma URL — funciona igualmente
     bem para `/api/automations/cron`, `/api/flows/cron` e
     `/api/prospecting/cron` no mesmo agendamento.

Enquanto `AUTOMATION_CRON_SECRET` não estiver definido, o endpoint
responde `503` — o restante do CRM continua funcionando normalmente
(a busca só fica parada em `awaiting_review`/estados intermediários
até o cron rodar pela primeira vez).

## Google Places

`GOOGLE_PLACES_API_KEY` é opcional e independente do cron. Sem ela, a
etapa de busca falha explicitamente com uma mensagem clara — o
restante do CRM, incluindo o chat da Prospecção, continua funcionando.
Para configurar:

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Ative a **Places API (New)**.
3. Gere uma chave de API e restrinja-a à Places API (New).
4. Defina `GOOGLE_PLACES_API_KEY` no ambiente de produção.
