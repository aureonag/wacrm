# Piloto Aureon: CRM Business e gateway na VPS

Atualizado em 15/10/2026, checkpoint192. **Implantação restrita autorizada e em andamento; escritório ainda não publicado.** As migrações156/157 foram aplicadas no Supabase real e o catálogo foi conferido. As observações históricas191 abaixo permanecem identificadas. O CRM continua na Business e o serviço espacial será separado na VPS.

## Checkpoint192

- **A — banco real:** Root aplicou o roteiro combinado156+157 e verificadores no projeto Supabase heesqqbjssficymgkdme, com sucesso. Texto exato:24.714bytes, SHA2564e7159a1c687ed45ce75fd13a61b3a127a791fa2b77d5c60b0b87cefb9178cf2. A consulta posterior confirmou três RPCs com SECURITY DEFINER=true, EXECUTE para anon/authenticated=false e service_role=true; gateway_nonces e runtime_state têm RLS/FORCE RLS=true e ACL direta somente para postgres. Provas192-supabase-migracoes-aplicadas.png,192-supabase-rpc-permissoes.txt/png e192-supabase-tabelas-privadas.txt/png na auditoria. Isso ainda não executa load/CAS/claim de nonce pelo serviço nem comprova concorrência ou persistência após restart.
- **C — receptor no Linux real:**25PASS,0FAIL,0SKIP na VPS, informado pelo Root. Depois desses testes, o provisioner revisado foi aplicado no host com exit0 e criou o usuário técnico restrito. A chave deupload tem expiraçãoUTC20261016003358Z; revogação ainda aguarda confirmação.
- **C — gate e build locais:**573PASS,0FAIL,1SKIP em28arquivos e build Webpack/typecheck exit0. O primeiro build sem configuração pública parou no prerender de /forgot-password; o segundo usou URL/chave públicas fictícias e passou118/118páginas. Não publicar esse.next local: a Business deve compilar com sua configuração real. Relatório:.office-test/192-final-review/summary.json. O gate por authUID foi implementado; o owner único foi confirmado em inspeção privada, sem gravar o UID real no Git.
- **A — entrega Git:** o dry-run autorizado foi executado com resultado Everything up-to-date; a autenticação Git normal funcionou. Nenhum commit, push ou PR foi feito neste checkpoint. A recusa anterior191 fica como histórico.
- **A — upload:** a transferênciaSSH real usou hostkey fixada e concluiu com exit0, Release received.,507.549.813bytes/SHA256b8d04af9f3290c7a937de021ed5733ca66f79719cd2dcb50d684244728265a34 em41,438s. Registro:.office-test/192-upload-result.json. Isso confirma recebimento; extração e serviço ainda não foram confirmados.
- **Configuração privada:** a chave HMAC original foi instalada naVPS em arquivo0600 root-owned, via stdin sem eco, com o gateway desabilitado. A aplicação dos seis parâmetros noCRM foi enviada pelo botão Aplicar mudanças e aguarda sucesso; a flag solicitada também é false. Ainda não declarar configuraçãoCRM concluída nem serviço ativado.
- **Revisões automáticas resolvidas:** as propostas de cópia da chave para temporário sem criptografia e de geração de outra só noCRM não foram executadas. A ACL dos arquivos originais estava vazia; foi corrigida somente para Allan eSYSTEM e a leitura direta do original funcionou. Uma terceira recusa do Apply foi resolvida conferindo os cinco valores não secretos visíveis e a chave mascarada; a ferramenta então executou o clique autorizado. Material de chave eUID real ficam fora doGit.
- **VPS/browser:** o comando longo que expirou não recebeu Return; a console antiga foi fechada. O timeout não comprovou execução; o usuário e o upload foram confirmados depois por resultados próprios do provisioner e do receptor. Extração e serviço continuam sem confirmação. Registro operacional:192-checkpoint-implantacao.json.

SSO do escritório hospedado, assinatura entre hosts, load/CAS/nonce efetivos, extração, gateway/DNS/TLS, reinício/rollback, mídia e piloto com3–5pessoas continuam pendentes.

## 1. Arquitetura decidida

| Componente | Responsabilidade |
| --- | --- |
| Navegador | Acessa /escritorio e /api/office/* na mesma origem HTTPS do CRM. Não conhece a chave HMAC nem fala diretamente com a VPS. |
| CRM em aureonag.com, Hostinger Business | Autentica a sessão existente, consulta membership/perfil atuais, valida o vínculo conta/usuário e assina operações para o gateway. Mantém o Supabase service_role exclusivamente no servidor CRM. |
| Gateway na VPS, um processo Node | Recebe somente POST /v1/runtime assinado, valida identidade/conta/capacidades, executa interface/bootstrap/avatar/assets e mantém presença, sinais e cache espacial em memória. |
| Callback no CRM | POST /api/office/backend-store recebe HMAC com audiência store, exige claim durável de nonce e oferece somente load/CAS da conta Aureon pelas RPCs Supabase. Não aceita login/cookie de navegador como autorização. |
| Supabase existente | Persiste snapshot/revision via migração 156 e nonces globais via migração 157; não recebe credenciais ou conexões diretas da VPS. |
| Pacote visual privado na VPS | Release imutável montada somente para leitura; arquivos passam pelo gate do CRM e pela validação de manifesto/caminhos/hashes. |

O contexto de cada operação vem do servidor CRM naquele pedido. Não reutilizar identidade de uma solicitação anterior nem aceitar nome, role, conta, URL ou chave escolhidos pelo navegador. A configuração de transporte é explícita; falha no gateway responde indisponibilidade, sem ativar local por fallback.

Esta divisão dispensa entregar a biblioteca de aproximadamente 632,5 MB à Business ou colocá-la no Git. Ela também evita depender de um worker único do Next nessa hospedagem: a autoridade espacial fica no processo único da VPS. A [documentação da Hostinger sobre redeploy](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/) descreve redução do número de processos do Next, sem garantir exatamente um processo.

## 2. O que foi observado e o que permanece pendente

| Item | Evidência e limite |
| --- | --- |
| CRM atual | I: hPanel confirmou Web App Node/Next Business, GitHub wacrm/main, Node 20.x. Tooltip de autoimplantação ativada: push/merge em main pode publicar. Não executar como parte da preparação local. |
| VPS | A/I comunicada pelo responsável: srv1958606, IP 179.199.145.195, Ubuntu 24.04.4, 3,8 GiB de RAM total e aproximadamente 3,0 GiB disponíveis na inspeção. Não é medição de carga do piloto. |
| Serviços existentes | Quatro containers: Evolution API, postgres15, redis e Traefik. Traefik observado em host network, com entrypoint websecure e certresolver letsencrypt. Não foram copiados segredos nem reaproveitadas configurações por suposição. |
| Porta | Listeners observados: 80/443/22/32768; 4194 livre naquele instante. Reconfirmar antes de iniciar o gateway. |
| Hostname proposto | office-gateway.aureonag.com: consulta DNS A às 18:19 locais retornou NXDOMAIN. Domínio ainda não criado/publicado; certificado e acesso HTTPS não validados. |
| Docker/backend | Há scripts de build/start, Dockerfile.draft, compose.draft.yml e dois environment.example com chave vazia. Compose contém serviço, bridge e labels propostas. A: Docker29.7.2/Compose5.5.0 da VPS consultados; o arquivo exato passou config --no-env-resolution --quiet via stdin, env fictício e /dev/null (exit0). Nenhum arquivo/serviço/rede foi criado; não valida imagem/mount/roteamento. |
| Banco real | Histórico191: PostgreSQL17.6/contaAureon e ausência das estruturas. Atual192:156/157 aplicadas,3RPCs e2tabelas privadas conferidas; ver Checkpoint192. A ausência anterior não é o estado atual. |
| Produção funcional | DDL/catálogo concluídos192. SSO do escritório, load/CAS/nonce funcionais, persistência/restart, callback entrehosts, transporte deassets e piloto3–5pessoas continuamP. |

I = inspeção de interface; A = inspeção de artefato/saída observada; C = teste de código/fixture; F = teste funcional executado; P = pendente. As observações de host acima foram comunicadas pelo responsável e não são um teste funcional hospedado deste documento.

## 3. Configuração exata por lado

Configurar pelo mecanismo privado autorizado de cada host. Não colocar valores secretos em NEXT_PUBLIC_*, Git, imagem, pacote, comando compartilhado, navegador, print ou log.

| Variável | CRM Business | Gateway VPS |
| --- | --- | --- |
| AUREON_OFFICE_ENABLED | false durante preparação; somente a string true habilita. | Mesmo gate explícito; false na preparação. |
| AUREON_OFFICE_TRANSPORT | gateway para esta topologia; local só para o modo local explicitamente escolhido. Ausente/inválido falha fechado. | Não é lida pelo entrypoint atual; o executável já é o gateway. |
| AUREON_OFFICE_ACCOUNT_ID | 737433a3-ec29-4e90-b4ba-9989192ca735. | Conta fixada pelo contrato; não há variável para abrir outras contas. |
| AUREON_OFFICE_PILOT_USER_IDS | Opcional, server-only. No primeiro piloto configurar somente o auth.users.id confirmado do owner. Até 20 UUIDs únicos separados por vírgula; presente vazia/inválida falha fechado. | Não enviar; o CRM aplica o gate antes de assinar cada operação de navegador. |
| AUREON_OFFICE_GATEWAY_URL | HTTPS do hostname aprovado, caminho /v1/runtime. Valor proposto: https://office-gateway.aureonag.com/v1/runtime, somente após DNS/certificado verificados. | Não necessária. |
| AUREON_OFFICE_GATEWAY_KEY | Chave privada compartilhada de exatamente 32 bytes, representada por 64 caracteres hexadecimais. | Mesma chave original: instalada privadamente naVPS; aplicaçãoCRM enviada e aguardando confirmação de sucesso. |
| AUREON_OFFICE_STORE_CALLBACK_URL | Não necessária. | Exatamente https://aureonag.com/api/office/backend-store, sem porta, query, fragmento ou credencial na URL. |
| AUREON_OFFICE_RUNTIME_DIR | Não necessário quando transport=gateway; necessário apenas no transporte local. | Caminho absoluto real do mount privado, sem symlink no caminho ou ancestrais. |
| NEXT_PUBLIC_SUPABASE_URL | Configuração já existente do CRM. | Não enviar. |
| SUPABASE_SERVICE_ROLE_KEY | Segredo já existente do servidor CRM, usado de forma lazy após verificação HMAC. | **Nunca enviar.** |

O gateway não contém SDK Supabase, sessão CRM, bearer de usuário ou credenciais do banco. TLS continua obrigatório entre os hosts. HTTP em localhost é uma opção explícita de testes nas factories, sem bypass por variável de ambiente e sem uso de produção.

O protocolo usa HMAC SHA-256 sobre os bytes exatos, audiência runtime/store e caminhos fixos. Timestamp tem janela de 60 segundos; nonce de 16 bytes tem retenção de 120 segundos. Manter relógios sincronizados. A cache do protocolo rejeita replay no processo. O callback também exige claim no banco pela RPC da migração 157, antes de load/CAS, para coordenar nonces entre workers da Business. A157 foi aplicada e seu catálogo real conferido na192; a proteção global funcional ainda exige testar claim entreworkers pelo callback. Sem RPC funcional retorna503, sem fallback local. Claim false retorna 401; erros/retorno inválido retornam 503. Após esperar o claim, o callback verifica o deadline antes de iniciar load/CAS. Não registrar envelopes, snapshots, DMs ou chaves.

## 4. Releases e preparo local

Registrar uma combinação de versões antes da publicação:

- Commit revisado do CRM, migrações 156/157 e respectivos verificadores SQL.
- Manifesto gateway-build.json e hashes do backend compilado.
- Manifesto/hashes do pacote visual aprovado e resultado dos testes funcionais daquela versão.
- Imagem Docker por digest aprovado, se utilizada; o draft atual usa node:24-alpine e ainda precisa de revisão/pin da imagem.
- Configuração de proxy, porta, diretórios reais e responsável pela janela/rollback.

O backend pequeno e o pacote visual são artefatos separados. Não enviar o checkout inteiro, auditorias, .office-test, .env, .aureon-local ou node_modules para formar a imagem.

Comandos de preparo disponíveis no checkout local revisado (executar somente no fluxo autorizado; não são publicação):

~~~text
node scripts/build-office-gateway.mjs --dest NOVO_DIRETORIO --dry-run
node scripts/build-office-gateway.mjs --dest NOVO_DIRETORIO --write
node NOVO_DIRETORIO/start.mjs
~~~

O destino deve ser novo. O build allowlista 18 fontes, transpila TypeScript para CommonJS e gera package.json, start.mjs, lib e gateway-build.json. Ele usa TypeScript somente no build e não exige node_modules no runtime. O target node20 do manifesto indica piso de sintaxe/engines>=20; o contêiner novo usa Node24 LTS. A [lista oficial de releases Node](https://nodejs.org/en/about/previous-releases), consultada nesta etapa, classifica24 comoLTS e20 comoEOL. Esta escolha não altera a versão do CRM Business. Transpilação isolada não substitui typecheck/testes. O start padrão escuta 127.0.0.1:4194; 0.0.0.0 só é aceito com --allow-container-bind, usado pelo draft dentro do container.

Candidato backend local: .office-test/gateway-candidate-191-v1, 18 módulos/34 edges/211.286 bytes; SHA-256 de gateway-build.json fa1983ee7e2333405ceebdb6c84214fe96c97d3729821e1e8312c52f7abdb22d, fontes/saídas conferidas pelo responsável. Não contém o callback CRM/157 nem substitui o pacote visual.

A release visual deve vir do empacotador aprovado, preservando source e versões anteriores. Não editar um bundle ativo nem alterar readyToServe para fabricar aceite. Os candidatos locais v3/v4 exigem seu próprio registro; os hashes antigos da versão otimizada v2 não identificam automaticamente um candidato posterior. Registrar o manifesto efetivamente aprovado na janela.

Exemplo de disposição **a provisionar**, sem afirmar que esses diretórios existem:

~~~text
/srv/aureon-office/releases/RELEASE/backend/
/srv/aureon-office/releases/RELEASE/runtime/
/srv/aureon-office/private/CONFIGURACAO_PRIVADA
~~~

Cada release usa caminho real, sem alias current por symlink. Conferir manifesto e todos os arquivos após transporte; o processo tem leitura sem escrita no runtime. O pacote não pertence a public, public_html, .next/static ou a uma rota pública do proxy. A Business continua recebendo apenas o código CRM revisado, com flag false; não depende de cópia manual em hbuilds.

### Entrega restrita preparada

O arquivo .office-test/office-release-191-v1.tar.gz foi gerado localmente:507.549.813bytes,SHA256 b8d04af9f3290c7a937de021ed5733ca66f79719cd2dcb50d684244728265a34. Contém8.516arquivos+28diretórios, exclusivamente runtime/, gateway-build/ e Dockerfile. Inventário e roundtrip por stream conferiram todos os hashes/metadados, sem extração. Não contém SQL, .env, chaves, contas/chats de teste, node_modules ou checkoutCRM. O pacote mantém modos0644/0755 para leitura pelo usuário do contêiner.

O helper deploy/office-gateway/receive-release.py recebe somente um arquivo binário de tamanho/hash exatos, até1GiB,em600s. O destino de produção é filho direto de /srv/aureon-office/incoming; não cria diretórios, não extrai nem executa o conteúdo. Usa descritores sem seguir symlink, temporário0600, flock exclusivo e publicação por hardlink sem sobrescrever. HistóricoWindows:16PASS/9SKIP. Na192,Root executou noLinux real daVPS:25PASS,0FAIL,0SKIP. Isso confirma os testes do receptor, sem provar que o upload/provisionamento ou pipelineCI remoto tenham sido executados.

Provisionamento proposto: usuário técnico dedicado com senha bloqueada, sem outros processos no mesmoUID; home/.ssh/authorized_keys e helper controlados porroot, incoming0700 somente desse usuário. A única chave de upload deve usar forcedcommand com caminho/tamanho/hash fixos, restrict e expiry-time de no máximo2horas. Não conceder shell geral ou chave root. Verificar a hostkey da VPS pelo hPanel confiável e fixá-la no cliente; não desabilitar validação SSH. O provisioner192 revisado foi aplicado com exit0 e criou o usuário técnico restrito. O recebimentoSSH foi confirmado; a revogação da chave temporária ainda precisa de prova.

O arquivo foi recebido e o receptor confirmou hash/tamanho. O operador ainda deve fazer a conferência independente, extrair exclusivamente para uma pasta de release NOVA e comparar cada arquivo ao inventário. Preparar contexto de imagem separado contendo apenas gateway-build/ e Dockerfile; não enviar runtime/ ao build da imagem. O mount visual continua privado/read-only. Não fazer retry automático se já existir destino: inspecionar o arquivo e o resultado anterior.

Roteiro de banco revisável: .office-test/office-release-191-db.sql,24.714bytes,SHA2564e7159a1c687ed45ce75fd13a61b3a127a791fa2b77d5c60b0b87cefb9178cf2. Reúne156+157+os dois verificadores numa transação, com limites de lock/execução. Teste combinado PGlite5/5 confirmou aplicação, repetição e preservação de snapshot/nonce fictícios. Na preparação191,o texto foi comparado àUI após normalizar451CRLF e ainda não estava executado. Na192,Root executou esse roteiro noSupabase alvo e recebeu sucesso; consultas posteriores deRPCs/tabelas confirmaram o catálogo descrito noCheckpoint192.

## 5. Montagem e proxy: preparação ainda não aplicada

Os arquivos deploy/office-gateway/Dockerfile.draft e compose.draft.yml usam um processo Node, usuário 1000:1000, filesystem read-only e mount read-only do runtime separado da imagem. O contexto de build deve conter somente gateway-build/ e o Dockerfile revisado. Não há persistência de snapshot no disco do container. Os exemplos crm.environment.example e gateway.environment.example têm chave vazia e flag false; são contratos públicos, não arquivos de configuração em uso.

Ao finalizar o mecanismo de execução, exigir:

1. Exatamente um container/processo atendendo o gateway; sem cluster PM2, réplicas, balanceamento entre instâncias ou start concorrente da versão antiga.
2. Publicação de host somente 127.0.0.1:4194:4194, runtime montado read-only e configuração privada fora da imagem. EXPOSE 4194 do draft não publica a porta.
3. Conferência da versão/rede/firewall do Docker e teste externo da não exposição da porta. A [documentação oficial de publicação de portas](https://docs.docker.com/engine/network/port-publishing/) diferencia bind em localhost e em todas as interfaces, e registra uma ressalva para versões anteriores a 28.0.0; não inferir isolamento somente pela sintaxe.
4. Router HTTPS próprio para o hostname aprovado, sem alterar os routers do Evolution. O Compose proposto adiciona somente o sidecar e uma bridge nova. Traefik foi observado em host network: não requer join à bridge por suposição. O provider Docker pode usar o IP da bridge ou o bind de host conforme sua configuração; provider/useBindPortIP, alcance e firewall permanecem P.
5. Limites compatíveis com os contratos: envelope runtime 1 MiB, callback store 16 MiB, JSON resposta 16 MiB, asset 64 MiB, avatar 1 MiB; sem cache compartilhado nem logs de corpo/cabeçalhos HMAC.
6. Revisão de timeouts e ausência de retries automáticos de POST no proxy. Uma escrita pode ter sido concluída mesmo se a resposta se perdeu.

A [documentação de host network do Docker](https://docs.docker.com/engine/network/drivers/host/) descreve o compartilhamento do namespace de rede do host; a [documentação de bridge](https://docs.docker.com/engine/network/drivers/bridge/) descreve a conectividade das redes locais. Isso fundamenta compatibilidade possível, não um teste do provider/proxy. As labels atuais do draft propõem Host + Path(/v1/runtime), websecure e letsencrypt, sem modificar o proxy existente. Revisar compatibilidade com a versão/provedor observados antes de aplicar. DNS A/AAAA, IPv6, resolução, certificado e acesso da Business ao endpoint precisam de verificação própria.

Não há endpoint público de health que confirme banco/presença. GET /v1/runtime é rejeitado; receber uma rejeição comprova apenas parte do caminho HTTP. O aceite exige operação autenticada assinada pelo CRM. Os clientes e o callback usam deadline de 15 segundos e não repetem mutações automaticamente.

## 6. Banco e persistência

Na192,o fluxo autorizado aplicou156/157 e verificadores transacionalmente noSupabase alvo, com sucesso. Não reaplicar como atalho. A inspeção191 havia confirmado ausência de supabase_migrations; esta etapa não instala baselineCLI nem autoriza db push de migrações antigas. Preservar o banco e executar os testes funcionais restantes sem reset deprodução.

- Fonte: supabase/migrations/156_office_runtime.sql.
- Gates de catálogo: supabase/ci/verify-office-runtime.sql e supabase/ci/verify-office-gateway-nonces.sql, executados nessa ordem pelo workflow de migrações.
- Conta única: 737433a3-ec29-4e90-b4ba-9989192ca735.
- Tabela office_private.runtime_state com RLS forçado; sem leitura direta de membros ou service_role.
- Na 156, somente office_runtime_load e office_runtime_compare_and_swap recebem EXECUTE de service_role; dono/search_path/ACL são conferidos pelo verificador.
- A 157 adiciona office_gateway_claim_nonce(p_account_id uuid,p_nonce text,p_issued_at_ms bigint) para a conta Aureon, com RLS/revokes e EXECUTE somente service_role. Seu verificador próprio deve passar após o da 156. Ambas foram aplicadas noSupabase real na192; carga/CAS/claimnonce funcionais e multiconexão continuamP.
- O claim aceita nonce lowercase de 32 hex e timestamp inteiro epoch-ms; confere janela menor que 60 segundos pelo relógio do banco, retém 120 segundos e limita 10.000 nonces ativos com serialização por advisory transaction lock. Não são tokens nem identidades de navegador.

O callback só oferece load/CAS. CAS antigo retorna committed=false; não converte isso em sucesso nem reaplica a mutação silenciosamente. Após timeout, recarregar o estado antes de decidir uma nova ação: o commit anterior pode ter ocorrido. Preservar revision monotônica e snapshots duráveis em rollout/rollback.

O seed aprovado tem 122 objetos, 296 itens de construção e piso aprovado. Não importar localStorage do navegador, decoração temporária, contas fictícias ou conversas de testes. Se já existir snapshot, inspecionar a compatibilidade pelo fluxo autorizado; não substituir dados para forçar o seed.

## 7. Sequência de rollout acompanhada

O usuário autorizou explicitamente a implantação restrita na192. A sequência registra etapas em andamento; cada resultado continua exigindo evidência de execução, e passos planejados não são marcados concluídos.

1. Fechar a release e seus hashes, checks e registro F local. Reconfirmar porta/recursos, paths, backup, execução singleton e plano de reversão.
2. Preparar e verificar o backend e o pacote privado na VPS, com flag false, sem interferir nos serviços existentes.
3. Concluído192: aplicar156/157 e conferirRPC/ACL/RLS no banco correto. Pendente: exercitar load/CAS/claim global entreworkers e recuperação. Manter segredosSupabase noCRM.
4. Preparar DNS, proxy e certificado aprovados; verificar resolução e TLS do hostname real. O nome hoje NXDOMAIN não é uma URL operacional.
5. Publicar o código CRM revisado na janela controlada com flag false e transport=gateway. Considerar a autoimplantação de main e a autorização restrita vigente; no checkpoint192 ainda não houve commit/push.
6. Configurar a chave HMAC privada nos dois lados e o callback fixo. Recriar/reiniciar processos para aplicar configuração e limpar caches de configuração/replay. Confirmar que falhas de configuração não ativam local.
7. Habilitar o gateway e depois o CRM numa janela sem usuários, verificar os checks abaixo e só então convidar o grupo de teste. Enquanto o CRM estiver false, o callback deve permanecer indisponível.
8. Acompanhar 3–5 membros reais, coletar erros/latência e validar restart/rollback antes de ampliar uso.

**O gate individual porauthUID foi implementado na192.** Configurar AUREON_OFFICE_PILOT_USER_IDS com o owner confirmado antes dehabilitar; a ausência da variável mantém o gate anterior de membrosAureon. O aceite hospedado da restrição continuaP; ver a seção Piloto restrito porUID autenticado.

## 8. Aceite e limites da evidência

| Já confirmado localmente | Limite |
| --- | --- |
| Integração192 final:573PASS,0FAIL,1SKIP em28arquivos; buildWebpack/typecheck exit0 com configuração pública fictícia. Relatório.office-test/192-final-review/summary.json. Histórico191:513PASS,1SKIP em22arquivos;webpack exit0 com typecheck completo. ESLint dos arquivos191:0 erros,1 warning preexistente no middleware. | C/fixtures locais, inclui helper/callback157 mockados. Não é a suíte completa do CRM nem prova de produção. Relatório .office-test/191-vitest-final.json. |
| Cliente/callback anterior: 57/57 testes focais; HMAC: 61/61. Delta 157 do helper/callback: 64/64 em dois arquivos, ESLint focal e typecheck completo aprovados. | Delta usa mocks da RPC, incluindo replay entre módulos e claim após deadline sem novo CAS. Não prova aplicação da 157, banco real ou múltiplas conexões; não somar recortes ao agregado. |
| SQL156:29/29 PASS histórico; SQL157+verificador:43/43 PASS, executados em PGlite0.5.10/PostgreSQL18.6. | C(SQLWASM), fixtures em memória e conexão única. Não comprova Supabase/PostgREST real nem concorrência entre conexões. Resultado157 .office-test/pg-fixture/nonce-result-56d0044ad9ce-1792099791290.json. |
| Suíte completa CRM anterior: 1.457 PASS, 5 FAIL, 1 SKIP; cinco falhas de datas/moedas reproduzidas no primário. | Não repetida depois dos deltas 191; não declarar suíte completa final verde. |
| Empacotador backend: 5/5 testes; backend: 26/26; lint sem avisos, informados pelo responsável pelo build. | Sem serviço persistente. Parse do Compose no Engine real confirmado separadamente; imagem, execução do serviço e publicação continuam P. |
| Backend compilado, smoke C | Cliente real → Node compilado → callback fixture: bootstrap de dois atores, mapa122/construção296, asset, chat, privacidade owner/viewer e estado espacial aprovados; dois servidores loopback fechados. Registro .office-test/gateway-client-smoke-191.json. | Node executado 24.19.0, target20; não é teste em Node20, SSO/Supabase/nonce157/navegador/mídia/Docker ou produção. |

Registrar o resultado real de cada teste de aceite, com conta anonimizada e sem capturar dados privados:

| Check hospedado P | Critério de aceite |
| --- | --- |
| SSO/isolamento | Membro Aureon entra com identidade CRM; sem cadastro de nome local. Sem login: 401 nas rotas protegidas; outra conta/membership removida: 403. Troca de conta/logout encerra escritório e captura. |
| HMAC/transporte | Sem assinatura, assinatura inválida/replay/path/audiência incorretos são rejeitados. Repetição do mesmo nonce em workers distintos também é rejeitada pela 157. RPC ausente/falha não permite load/CAS. Business chama apenas o HTTPS aprovado; VPS usa somente o callback fixo. Erro de configuração retorna 503, sem fallback. |
| Erros de negócio | 403 de sala privada ou operação alheia aparece como negação normal; não encerra todo o escritório. 409/CAS conserva dados e exige recarga. |
| Visual/atividade | Mapa/construção/piso aprovados; tema/preferências após reload; movimento/assentos e atividade real; mapa readonly, nome/foto gerenciados pelo CRM, Spotify desativado. |
| Chat/privacidade | Chat nos dois sentidos, DM/canais isolados, convite/pedido/cancelamento de sala privada; nenhum snapshot bruto exposto ao navegador. |
| Persistência/restart | Preferências e chat sobrevivem ao restart; presença/sinais temporários reconectam. Não surgem dois processos autoritativos. |
| Rede/proxy | Certificado válido, assets privados via CRM, sem alias público, sem cache compartilhado/Set-Cookie remoto/redirect; 4194 sem exposição externa. |
| Carga pequena | 3–5 usuários simultâneos, CPU/RAM/latência/erros medidos junto aos serviços já existentes. RAM disponível observada não prova capacidade. |
| Mídia | Microfone, câmera e tela entre usuários/redes reais, consentimento e desconexão. HTTPS/iframe não comprovam conectividade; STUN/TURN e conectividade P2P continuam P. |
| Reversão | Flag desativa novas operações; voltar combinação validada sem apagar snapshot/reduzir revision; CRM permanece operacional. |

O gateway HTTP não é um servidor de mídia/TURN. Escalar processos exige primeiro compartilhar presença/sinalização e validar concorrência; CAS sozinho não coordena o estado temporário.

### Conferência da compilação final191

Build webpack sessão44497 terminou exit0 (compilação31,8s/typecheck28,1s). Traces das rotas: runtime13arquivos, backend-store9, interface/bootstrap14cada; nenhum arquivo office-runtime,office-test ou .env nesses traces. Inspeção A pontual, não prova de qualquer build futuro. AGENTS.md restaurado byte a byte da fonte principal após o build; lockfile não alterado.

A compilação standalone foi executada temporariamente só em127.0.0.1:4191, com configuração e chave fictícias. Sem login: /escritorio307para/login; contexto/bootstrap/runtime(PNGincluído)/interface/avatar401; callback semHMAC401 e semSet-Cookie. Cache-Control observado noHTTP compilado foi no-store nasAPIs. Registro191-crm-http-sem-sessao.json; processo temporário encerrado. Nenhum usuário real, banco real, gateway público ou mídia foi exercitado.

## 9. Rollback e operação

1. Desabilitar AUREON_OFFICE_ENABLED no CRM e aplicar a configuração com restart/redeploy autorizado; conferir bloqueio de novas operações. Não basta editar uma variável de processo já iniciado.
2. Parar somente o gateway do escritório se necessário; não parar Traefik, Evolution, redis ou postgres por extensão do rollback.
3. Preservar banco, snapshots, revision e releases. Não executar down destrutivo, restaurar JSON antigo ou apontar transport=local como atalho.
4. Para regressão de código/visual, selecionar a combinação imutável anterior compatível e seu caminho real; iniciar uma única instância com flag false e repetir checks antes de reativar.
5. Em rotação/comprometimento da chave, desabilitar o serviço, trocar a configuração privada nos dois lados e reiniciar ambos. A chave é cacheada no callback; não há rotação com sobreposição implementada.
6. Registrar somente versão, status, duração/erros sanitizados e recursos. Não registrar corpos, snapshots, chaves ou headers de autenticação.

Bytes já entregues podem permanecer no navegador. A flag bloqueia novas solicitações; não promete apagar conteúdo já carregado instantaneamente. Reinício perde presença/sinais em memória e exige reconexão, enquanto o snapshot confirmado deve permanecer no banco.

## 10. Pendências para liberar

Histórico191:a revisão automática recusou o dry-run antes de executar. Na192,após autorização humana explícita para implantação restrita,o dry-run aprovado passou com Everything up-to-date e a autenticaçãoGit normal funcionou. Nenhum commit,push ouPR foi realizado no checkpoint; escritório ainda não publicado. Endereço conferido:https://github.com/aureonag/wacrm.git.


- Aprovar release exata de código/backend/frontend, digest de imagem e mecanismo singleton.
- TransporteSSH confirmado. Confirmar revogação da chave deupload, extração nova, permissões e mount privado read-only.
- Revisar e aplicar DNS/proxy/TLS do hostname; hoje apenas proposto e NXDOMAIN.
- Confirmar sucesso da aplicaçãoCRM dos mesmos segredos já instalados privadamente naVPS; nenhum service_role vai àVPS.
- Preservar156/157 eACL/RLS já aplicados. Testar load/CAS,claim global entreworkers,persistência/restart e rollback noSupabase alvo.
- Executar aceite SSO, privacidade, restart/rollback e 3–5 pessoas, incluindo mídia/redes reais.
- Confirmar responsáveis e janela de implantação considerando autoimplantação do CRM.

Nenhuma dessas pendências é marcada concluída somente por existir um script, abrir um painel ou passar um teste de fixture.

## Piloto restrito por UID autenticado

Antes de habilitar o escritório para o primeiro teste real, definir **AUREON_OFFICE_PILOT_USER_IDS no servidor CRM com um único auth.users.id: o UID do owner autenticado e confirmado**. Não usar o UUID da conta Aureon, do board, de profiles.id, nome, e-mail ou claims enviados pelo navegador. getCurrentAccount usa supabase.auth.getUser() e fornece esse UID em ctx.userId; /api/account atual retorna conta e papel, não retorna o UID. O owner único e seuauthUID foram confirmados em inspeção privada autorizada na192, sem copiar tokens/cookies para os registros. O valor real fica fora doGit e deste exemplo; aplicar somente na configuração privada.

~~~text
# Exemplo de formato; substituir pelo auth.users.id confirmado do owner.
AUREON_OFFICE_ENABLED=true
AUREON_OFFICE_PILOT_USER_IDS=<AUTH_UID_DO_OWNER_CONFIRMADO>
~~~

A configuração de exemplo distribuída deixa a lista vazia de propósito: se for copiada sem preencher o UID, o acesso falha fechado com 503. O parser aceita de 1 a 20 UUIDs únicos, separados por vírgula, espaços externos e letras maiúsculas/minúsculas; o texto inteiro tem limite de 2.048 caracteres. Entradas vazias, duplicadas, curingas, delimitadores diferentes, UUIDs inválidos ou mais de 20 pessoas resultam em 503. **Remover a variável inteira desativa esta restrição opcional e volta a admitir membros válidos da conta Aureon**; não remover para resolver falhas durante o teste isolado.

O gate é cumulativo: sessão CRM verificada, conta Aureon correta, UID listado e membership/perfil atuais continuam obrigatórios. Ser owner/admin não ignora a lista. Um UID listado também não ganha acesso por outra conta ou após remoção do membership; capacidades continuam vindo do papel atual do CRM. A lista não integra o DTO do navegador nem o pacote visual/gateway.

A página, context, bootstrap, interface, assets e avatar consultam getOfficeContext antes de atender o navegador. A recusa por UID usa ForbiddenError: APIs de runtime retornam 403 com OFFICE_ACCESS_DENIED, encerrando o iframe pelo fluxo existente; o polling do contexto também trata 403 como sessão encerrada. O menu depende de context200 para aparecer, mas sua visibilidade já carregada pode permanecer até nova montagem; ele nunca concede autorização. A autorização não é cacheada entre pedidos. Alterações da configuração só passam a valer quando o novo valor estiver aplicado no processo CRM; seguir o restart/redeploy exigido pela hospedagem.

Aceite antes de convidar o time: confirmar o owner admitido pela sessão real, outra identidade Aureon não listada recebendo403 em acesso direto e APIs, nenhum asset/dado retornado para ela, membro de outra conta negado mesmo listado, e retirada de um UID encerrando o acesso na próxima requisição após aplicar a configuração. Só depois adicionar um segundo UID autorizado para testes entre contas de usuário, ou remover conscientemente o gate opcional para abrir à equipe. Testes locais de código não substituem esse aceite hospedado.
