> Checkpoint192: este documento preserva a investigação190 nas seções históricas abaixo. A implantação restrita foi autorizada, mantém o CRM na Business e prepara um gateway separado na VPS. As migrações156/157 já foram aplicadas no Supabase; o escritório ainda não foi publicado. Seguir [o roteiro atualizado](office-gateway-deployment.md).

# Implantação do piloto do escritório Aureon no CRM

Registro histórico190 preparado em15/10/2026: naquele fechamento não houve publicação, migração ou envio ao Git. As seções1–10 preservam essa investigação e seus limites; os fatos192 abaixo substituem as antigas pendências de aplicação do banco.

## Atualização efetiva192

A implantação restrita foi autorizada e está em andamento. Root aplicou156+157 e verificadores no Supabase alvo: roteiro combinado de24.714bytes, SHA2564e7159a1c687ed45ce75fd13a61b3a127a791fa2b77d5c60b0b87cefb9178cf2. O catálogo posterior confirmou três RPCs com SECURITY DEFINER=true, anon/authenticated=false e backend=true; duas tabelas com RLS/FORCE RLS=true e ACL direta somente para postgres. Isso ainda não valida load/CAS/nonce, persistência ou restart pelo serviço.

O receptor passou25/25testes, sem skips, no Linux real da VPS. Gate e build192 locais:573PASS,0FAIL,1SKIP; build Webpack/typecheck exit0 com configuração pública fictícia. Esse.next local não deve ser publicado: a Business compilará com sua configuração real. O owner/authUID foi confirmado privadamente; o UID não integra o Git.

O dry-run Git autorizado passou com Everything up-to-date e a autenticação normal funcionou; nenhum commit, push ou PR foi feito no checkpoint. O provisioner revisado foi aplicado com exit0 e criou o usuário técnico deupload. A transferênciaSSH com hostkey fixada recebeu Release received.,507.549.813bytes/SHA256 conferidos, em41,438s; prova:.office-test/192-upload-result.json. A revogação da chave deupload e a extração ainda aguardam confirmação. O comando longo sem Return havia sido descartado e a console antiga fechada; seus efeitos não foram presumidos.

A chave HMAC original foi instalada naVPS em configuração0600 root-owned, via stdin sem eco, com a flag false. A aplicação dos seis parâmetros noCRM foi enviada pelo botão e aguarda confirmação de sucesso. As duas propostas recusadas de cópia para temporário sem criptografia e de outra chave apenas noCRM não foram executadas. A ACL do material original foi corrigida somente para Allan eSYSTEM e permitiu a leitura direta. Uma terceira recusa do Apply foi resolvida conferindo cinco valores não secretos e a chave mascarada; o clique autorizado foi executado. Não há chave ouUID real neste documento. O serviço do escritório ainda não foi publicado e não houve aceite de SSO, mídia ou equipe no ambiente hospedado.

Provas e pendências atuais: docs/office-gateway-deployment.md, docs/office-pilot-backlog.json e auditoria192-checkpoint-implantacao.json.

## 1. Destino atual e evidência

| Item | Evidência disponível | Consequência |
| --- | --- | --- |
| CRM em aureonag.com | Inspeção de interface do hPanel, comunicada pelo responsável pela investigação: Web App Node/Next.js em hospedagem Business, GitHub wacrm/main, commit bd99e5e9, última implantação exibida como concluída em 15/10 às 12:32; raiz ./, build/output “Padrão”, Node 20.x. | Este é o destino atual confirmado. O Docker Compose do repositório não descreve a infraestrutura observada. |
| Implantação automática | Tooltip do painel confirmou autoimplantação ativada. | **Push/merge em main pode publicar automaticamente. Não executar na preparação.** |
| Capacidade exibida | 1/5 aplicações, memória 212 MB, disco 1,33/50 GB. | São valores de interface; não comprovam limite de memória, políticas de upload ou permanência do artefato. |
| VPS srv1958606 | Interface: Ubuntu 24.04, KVM1, Docker/Traefik; Docker Manager listava somente evolution-api-nxzm e traefik. | Não há evidência de CRM nessa VPS. Usá-la exigiria migração de hospedagem explicitamente aprovada. |
| Entrega e caminho privado na Business | Pendente. | Confirmar mecanismo de artefatos, diretório real acessível ao Node e retenção entre builds/reinícios. |
| Topologia Node | Pendente no ambiente hospedado. | Exige um processo atendendo todas as rotas /api/office; confirmar um domínio não comprova isso. |
| Banco hospedado | Aplicação da migração 156, grants e persistência real pendentes. | CI e banco fictício não comprovam configuração de produção. |

As observações de painel são **inspeção de interface**, não teste funcional do escritório hospedado. Reconfirmar a configuração na janela de publicação.

A [documentação oficial da Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), consultada em 15/10/2026 e identificada como atualizada há duas semanas, informa que hbuilds/current/nodejs aponta à versão ativa por symlink; builds ficam em hbuilds/versions/build-id, mantendo as duas últimas versões bem-sucedidas. hbuilds e public_html são gerenciados e sobrescritos em deploys; edições manuais não persistem. Em Business/Cloud, npm roda no processo de build, não por SSH.

**Implicação para este código:** o loader recusa symlinks também nos ancestrais; apontar o runtime a hbuilds/current falharia. A solução precisa de um diretório privado real com persistência confirmada, ou de entrega vinculada ao diretório real de cada build. Não presumir que qualquer diretório externo é persistente. A documentação não comprova essas condições no host atual; o comportamento permanece P.

## 2. Release local disponível

- Artefato local: E:\Claude\aureon-office-crm\.office-runtime-optimized.
- 8.494 arquivos de conteúdo + manifest.json = 8.495 arquivos.
- Conteúdo 632.549.098 bytes; manifesto 3.685.472 bytes.
- 62 scripts, 3 folhas de estilo; 305 PNGs extraídos de 350 ocorrências sem recompressão.
- SHA-256 manifest.json: bf7f719a3a9739a22c1e43286ee193ce7e44ce73ec90aa277f29913e0fb1e135.
- SHA-256 app.js do pacote: dcd475efe4c4a68be7c3780a35e19b8ba68778ee7013f4691ed3b476c479328e.
- SHA-256 index.html do pacote: c2e602d830fd0be9214e08909d7ab30126768b241a89a42d4d40c143c658f584.
- Após a cópia foram conferidos todos os 305 PNGs, os 62 scripts, o índice e o inventário. Originais e versão anterior foram preservados.
- Registro no projeto original: auditoria-personagem-2026-10-08/replica-interface/190-pacote-crm-otimizado.json.

O manifesto mantém readyToServe=false e stage=crm-integrated-unverified. Esses campos registram o estágio; a liberação operacional usa a flag do servidor. **Não editar o manifesto para fabricar prontidão.** O loader exige pacote written e bootstrap CRM compatível e verifica caminhos/tamanhos/hashes.

Registrar na entrega: commit revisado do CRM, histórico de migrações, identificador do artefato e seu manifesto. Se houver compactação de transporte, calcular também o hash desse arquivo; nenhum arquivo de transporte foi criado nesta etapa.

## 3. Configuração do servidor

Usar o mecanismo autorizado de configuração do CRM. Não imprimir, copiar para este documento ou colocar no pacote os segredos existentes.

| Variável | Valor ou contrato |
| --- | --- |
| AUREON_OFFICE_ENABLED | Ausente ou qualquer valor diferente da string true mantém o serviço desativado. Preparar com false; ativar só na janela acompanhada. |
| AUREON_OFFICE_ACCOUNT_ID | 737433a3-ec29-4e90-b4ba-9989192ca735, UUID da conta Aureon fixado também na migração 156. Não usar UUID do espaço Gather nem nome da empresa. |
| AUREON_OFFICE_RUNTIME_DIR | Obrigatório: caminho absoluto da release privada real e verificada. O caminho da Business ainda é P; não inventar valor no painel. |
| NEXT_PUBLIC_SUPABASE_URL | Projeto já utilizado pelo CRM; deve corresponder ao banco e à sessão. Não mudar apenas para o escritório. |
| SUPABASE_SERVICE_ROLE_KEY | Credencial exclusivamente do servidor para as RPCs. Nunca em NEXT_PUBLIC_*, no artefato, navegador ou logs. |

UUID ausente/malformado falha fechado. Cookies, membership e perfil atuais do CRM autorizam o usuário. Cabeçalhos de vínculo de conta/usuário não são autenticação. O frontend não cadastra um nome local para entrar.

O servidor exige AUREON_OFFICE_RUNTIME_DIR não vazio e absoluto, após verificar a flag. Ausência ou caminho relativo responde 503, sem procurar .office-runtime no diretório de trabalho. Definir a release privada real; o loader continua recusando symlinks e validando o manifesto.

Tudo permanece na mesma origem HTTPS do CRM:

- Página /escritorio; contexto /api/office/context; bootstrap /api/office/bootstrap.
- Arquivos /api/office/runtime/; operações /api/office/interface/; avatar /api/office/avatar-composition/.
- /api/office/smart-objects/ permanece indisponível no piloto; Spotify desabilitado.
- Mapa e construção em modo de leitura; sem importar storage do navegador.

Não configurar alias público de CDN/Nginx/Traefik para o pacote. Cada arquivo passa pelo gate do CRM. Não incluir fontes do servidor, auditorias, backups, credenciais ou estado de navegador.

## 4. Caminho para a Business atual

Este caminho depende das confirmações de infraestrutura; não há entrega privada pronta no painel observado.

1. Confirmar com o operador: diretório privado real, ausência de symlinks nos ancestrais, permissões do Node, retenção, limites de arquivo, topologia de processo e mecanismo de entrega separado do Git.
2. Manter flag false e revisar o código/checks antes de qualquer push a main.
3. Escolher uma entrega suportada:
   - Diretório privado persistente fora das árvores gerenciadas, somente após confirmação da plataforma.
   - Artefato incorporado por etapa de build suportada, fora da saída pública, com caminho real resolvido para aquela versão. Exige validar retenção, mapeamento de caminhos e reinício; não é implementado neste trabalho.
4. Entregar a release aprovada em diretório novo; verificar manifesto e todos os arquivos; restringir escrita. Não colocar sob public, public_html ou .next/static. Não usar edição manual de hbuilds como mecanismo de entrega.
5. Definir o caminho absoluto da release e publicar código revisado com flag false na janela autorizada. Confirmar um único processo e a migração.
6. Ativar para 3–5 membros Aureon e executar o aceite hospedado antes de ampliar o uso.

Se a plataforma não oferecer entrega privada compatível, escolher explicitamente entre implementar um mecanismo suportado e migrar a hospedagem. Não colocar o pacote no Git/public como atalho. **A compatibilidade da Business com a estratégia privada ainda é P.**

O empacotador depende do projeto original do escritório, ausente do CRM remoto; não presumir que possa gerar a biblioteca no host. Entregar a release já aprovada ou projetar um fluxo de artefatos verificável. Não executar npm por SSH como plano operacional da Business.

## 5. Migração 156 e CAS

Fonte: supabase/migrations/156_office_runtime.sql.

Cria office_private.runtime_state por account_id, revision e snapshot JSON. DMs/canais privados do snapshot não são leitura do navegador. RLS é habilitado/forçado, sem policies de membros; grants diretos são revogados inclusive de service_role. Somente office_runtime_load e office_runtime_compare_and_swap, SECURITY DEFINER de postgres com search_path fixado, recebem EXECUTE para service_role.

Tabela e RPCs restringem a conta a 737433a3-ec29-4e90-b4ba-9989192ca735. A migração não importa seed nem credenciais.

Procedimento:

1. Confirmar projeto de banco, histórico e backup/restauração.
2. Conferir **todas** as migrações pendentes; db push não seleciona automaticamente só a 156.
3. Fazer replay em banco descartável e checks. migrations.yml faz replay local no runner, sem aplicar produção.
4. Aplicar pelo fluxo autorizado do CRM com flag false. Nunca usar db reset em produção para cumprir check.
5. Validar tabela, conta, RLS, dono, search_path e grants. Não expor snapshots/DMs em prints/logs.
6. Só depois testar persistência real no aplicativo e reinício.

Exemplo de inspeção de metadados pelo operador autorizado:

~~~sql
select to_regclass('office_private.runtime_state') as office_table;
select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('office_runtime_load', 'office_runtime_compare_and_swap');
select
  has_schema_privilege('authenticated', 'office_private', 'USAGE') as member_schema_usage,
  has_table_privilege('authenticated', 'office_private.runtime_state', 'SELECT') as member_table_select,
  has_table_privilege('service_role', 'office_private.runtime_state', 'SELECT') as service_table_select,
  has_function_privilege('authenticated', 'public.office_runtime_load(uuid)', 'EXECUTE') as member_rpc_execute,
  has_function_privilege('service_role', 'public.office_runtime_load(uuid)', 'EXECUTE') as server_rpc_execute;
~~~

Esperado: false nos três acessos diretos e no EXECUTE de authenticated; true no EXECUTE de service_role. Conferir também a RPC de escrita e a existência da conta no banco alvo. Esses metadados não constituem teste de persistência.

CAS compara revision antes de gravar: inicializadores concorrentes não criam duas revision 1; escritor antigo não sobrescreve o novo. O serviço retorna 409, exigindo recarga/repetição consciente; não reaplica o efeito silenciosamente. Após restart, testar chat/preferências e revisão coerente.

O mapa inicial vem do seed aprovado no backend: 122 objetos, 296 itens de construção e piso aprovado. Não copiar a decoração temporária ou dados de testes locais para produção. Um snapshot já persistido exige avaliação própria; não o sobrescrever para forçar o seed.

## 6. Um processo/nó no piloto

Cache espacial, sinais de chamada e overlays temporários ficam na memória do Node. Só spatial-state, spatial-control e spatial-presence reaproveitam um snapshot confirmado; outras operações recarregam armazenamento e podem fazer um CAS. Autenticação/vínculo permanecem em toda solicitação.

- Um processo atende todas as rotas /api/office; sem PM2 cluster, múltiplos workers, réplicas, balanceamento entre instâncias ou serverless nessas rotas.
- Confirmar a topologia real na Business antes de habilitar. CAS não compartilha presença/sinais entre processos.
- Reinício apaga estado temporário e exige reconexão; snapshots duráveis devem permanecer.
- Para ampliar réplicas: primeiro coordenação compartilhada de presença/sinalização e validação de concorrência.

É limitação concreta do serviço atual, não apenas preferência de infraestrutura.

## 7. Alternativa futura: Docker com mount somente leitura

**Exige migração explícita; não aplicar à Business atual por suposição.** O Compose versionado tem serviço app, porta interna 3000 e healthcheck genérico, sem labels/rede Traefik. Não há evidência de CRM instalado na VPS.

Dockerfile usa Node 20, build standalone, usuário nextjs e não aplica migrações. O pacote deve ficar separado da imagem. A configuração .dockerignore exclui as pastas locais atuais do contexto Docker; isso não prova o rastreamento do Next. Dois builds anteriores incluíram 8.190 arquivos privados no trace da rota, apesar de outputFileTracingExcludes. Após remover o fallback por cwd e exigir AUREON_OFFICE_RUNTIME_DIR, o build limpo final terminou com exit 0 e o trace da rota runtime passou a 14 arquivos, zero office-runtime e zero office-test (inspeção de artefato A dessa execução). O Next instalado ainda apresenta o problema de glob com separadores Windows; este resultado não afirma correção desse glob. Não houve edição manual de NFT/Next ou deleção para fabricar o resultado. Manter releases futuras fora do checkout/contexto de build também.

Overlay ilustrativo para uma futura hospedagem Docker, sem criar arquivo operacional agora:

~~~yaml
services:
  app:
    environment:
      AUREON_OFFICE_ENABLED: "false"
      AUREON_OFFICE_ACCOUNT_ID: 737433a3-ec29-4e90-b4ba-9989192ca735
      AUREON_OFFICE_RUNTIME_DIR: /opt/aureon-office/runtime
    volumes:
      - type: bind
        source: /srv/aureon-office/releases/190-bf7f719a
        target: /opt/aureon-office/runtime
        read_only: true
        bind:
          create_host_path: false
~~~

O caminho source é **exemplo**, a provisionar/verificar na infraestrutura escolhida. Usar diretório real sem symlink, com leitura para nextjs e sem escrita para o processo. Preservar versões antigas. Validar o Compose com config --quiet para não imprimir configuração resolvida, manter --scale app=1 e revisar proxy HTTPS/domínio/banco/backup/recursos antes da migração. Não reutilizar labels ou portas do Evolution por suposição.

## 8. Checks e aceite hospedado

Arquivos examinados: Dockerfile, docker-compose.yml, .dockerignore, next.config.mjs, package.json, workflows ci.yml/migrations.yml e contratos locais do escritório. Nenhum .env, credencial ou .aureon-local foi lido.

CI executa lint, typecheck, testes, test:office-package e build. Preservar next build --webpack, conforme AGENTS.md. CI não entrega o pacote privado, não ativa flag e não prova migração do banco hospedado. Healthcheck genérico também não prova prontidão.

### Evidência local confirmada

| Execução | Resultado confirmado | Limite |
| --- | --- | --- |
| Migração 156 + verificador em PGlite 0.5.10/Postgres 18.6 | C(SQLWASM): 29 PASS, 0 FAIL. Aplicação dos SQL reais, load vazio, CAS inicial/revisão 1 → revisão 2, stale CAS false, contas/entradas inválidas rejeitadas e ACL/RPC negadas. | Banco em memória, fixture mínima e conexão exclusiva única. Não comprova corrida multiconexão, Supabase/PostgREST ou produção. |
| Configuração explícita e loader privado | Recorte focal: 57 PASS, 1 SKIP (58 casos), incluindo 11 novos testes de configuração. ESLint focal passou. | O resultado de trace foi confirmado separadamente no build final abaixo; estes testes isolados não o comprovam. |
| CRM completo, execução anterior | 1.457 PASS, 5 FAIL, 1 SKIP. As cinco falhas de datas/moedas também foram reproduzidas no checkout primário: 18 PASS, 5 FAIL no recorte correspondente. | Não repetida após os últimos deltas. Não declarar suíte completa final verde nem atualizar a contagem por soma. |
| Agregado final de integração do escritório | 311 PASS, 1 SKIP em 15 arquivos de teste, informado pela execução final do responsável. | Substitui o marco antigo de 279 e a estimativa não confirmada de 281; não equivale à suíte completa do CRM. |
| Guardas Node do pacote | 50 PASS, 1 SKIP em 51 casos, execução final informada pelo responsável. | Validações de código/pacote; sem alegar funcionalidade hospedada. |
| Build limpo final e trace | Sessão informada 76821, exit 0; runtime route NFT: 14 arquivos, zero office-runtime, zero office-test. | A: inspeção pontual do artefato; não corrige o glob Windows do Next nem comprova implantação. |

Registro do build final: 190-build-final.json na pasta de auditoria replica-interface do projeto original. O responsável preservou o .next anterior por rename validado em .office-test/build-before-runtime-env e restaurou AGENTS.md após o build. A correção mínima de interface de anotações para o candidato v4 é uma validação separada; o sucesso deste build não declara essa interface ou o piloto hospedado concluídos.

Evidência SQL: .office-test/pg-fixture/result-e61ba4e1bae7.json, SHA-256 e119dfeb1d32e30a83a057ad933e38627e04aef79c040b98a6124e5a0f0236d5. Migração SHA-256 99389b85b203b6a637e2da08ac81c8429d15661706da35d63c210d72a3dda47a; verificador SHA-256 e61ba4e1bae7ded45404dfa30d25bf3f1dc9f708c41653512ed1bc7cf6f8032f. Falhas anteriores do verificador foram preservadas; o autor corrigiu seu SQL antes do resultado final. Package/lock do CRM permaneceram inalterados nessa fixture. Nenhum banco real foi acessado.

| Teste | Critério |
| --- | --- |
| Artefato/código | Commit revisado e checks; manifesto/arquivos conferidos após transporte; release/caminho corretos e imutáveis. |
| Gate | Sem login: 401 em APIs/arquivos. Outra conta ou membership removida: 403. Flag false: serviço indisponível, sem fallback local. |
| Sessão | Identidade do CRM, sem cadastro local; troca de conta/logout encerra escritório e captura. Negação de sala privada não encerra a sessão inteira. |
| Mapa/visual | 122 objetos/296 construção/piso aprovados; recarga conserva tema/preferências; assentos e movimentação conferidos; edição desligada. |
| Persistência | Chat em dois sentidos, preferências e restrições privadas sobrevivem ao restart; sem expor dados alheios nas evidências. |
| 3–5 membros | Presença/movimento nos dois sentidos, pedido/cancelamento de entrada privada, recarga/reconexão; registrar erros/latência reais. |
| Mídia | Microfone/câmera/tela e desconexão nas redes reais. Permissões de iframe/HTTPS não comprovam transporte; conectividade STUN/TURN permanece sujeita ao teste. |
| Proxy | Mesma origem HTTPS; APIs/arquivos privados sem cache compartilhado; iframe só CRM; sem alias público do pacote. |
| Operação | Reinício acompanhado, rollback ensaiado e responsável disponível. |

A aprovação local de código/hashes não substitui esses testes. Este documento não declara nenhum teste hospedado concluído.

## 9. Rollback e releases imutáveis

1. Definir flag false/remover true e **reiniciar/recriar o processo** para aplicar a configuração; não basta editar variável de um processo iniciado.
2. Conferir bloqueio de novas operações/runtime e detecção dos clientes existentes, mantendo o CRM operacional.
3. Preservar snapshots. Não apagar runtime_state, reduzir revision, executar down destrutivo ou restaurar JSON antigo como atalho.
4. Se precisar voltar código/pacote, usar combinação previamente validada, caminho real da versão e flag false durante a troca.
5. Reativar só após checks de acesso/compatibilidade e aceite necessário.

Bytes já carregados podem permanecer na memória do navegador; não prometer remoção instantânea. A flag bloqueia novas operações, e a detecção do cliente depende de suas solicitações. Em incidente de acesso, coordenar revogação de sessão pelo CRM e verificar o bloqueio.

Toda mudança gera nova pasta e manifesto. Não modificar app.js/imagens/manifesto dentro de release ativa. Trocar o caminho configurado e reiniciar em janela acompanhada, preservando a versão anterior; não usar symlink current. A retenção automática limitada da hospedagem não substitui backup do artefato fora das árvores gerenciadas.

## 10. Pendências antes de publicar

- Definir entrega privada e retenção/caminho real compatíveis com a Business, ou aprovar migração.
- Confirmar processo único e recursos; não inferir capacidade só de valores da interface.
- Planejar janela/fluxo de publicação considerando autoimplantação de main.
- Validar migração 156, grants/CAS e persistência real no banco alvo.
- Concluir aceite hospedado com 3–5 membros, reinício, rollback e mídia.
- Registrar responsável e versões exatas antes de ativar.
