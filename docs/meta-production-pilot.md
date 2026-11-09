# Piloto Meta no CRM principal

## Mudança
Conectar Meta inicia o login da própria pessoa. Escolher contas já autorizadas abre o seletor compartilhado da empresa. Reconectar exige a mesma identidade Meta e preserva os vínculos existentes. Cada conta escolhida é validada na Meta antes de vincular; nome, moeda e fuso vêm da API. Credenciais ficam cifradas no servidor. O retorno OAuth exige assinatura, usuário/empresa, validade e nonce do navegador.

## Escopo
Base ecf7ecb97ffba8e896cc5336faa4baccff5348f2, versão atual conferida na Hostinger e GitHub em09/11/2026. Não inclui as novas telas de dashboard, templates, metas, layout ou demais mudanças da branch de auditoria. Dependências e configurações globais preservadas. Meta Ads somente de leitura; não cria nem altera anúncios/orçamentos.

## Banco e configurações
Sem migração. Preflight somente de leitura confirmou meta_connections_account_identity_key e ad_integrations.last_state/last_verified_at já existentes. META_ADS_APP_ID/SECRET/CONFIG_ID, origem HTTPS e banco produtivo já configurados; nenhuma mudança de variável necessária. Não copiar .env de homologação para produção.

## Validação
153 testes do módulo passaram antes do fechamento final; lint dos componentes e rotas alterados passou; build webpack/TypeScript e131páginas passaram. Build local usou banco de teste. Interface antiga dos relatórios mantida:campos Meta adicionais são opcionais para snapshots anteriores e respostas inválidas continuam erro explícito.

## Backup e reversão
Backup anterior de06/11 preservado; snapshot complementar de09/11 em E:/Claude/Backups/CRM-Aureon-Meta-2026-11-09, pasta restrita. Contém fonte exata publicada, configurações privadas, dump novo PostgreSQL em modo somente leitura, roles sem senhas e57anexos com hash conferido. Índice do dump validado; não afirmar restauração completa do banco,que permanece parcialmente validada na auditoria anterior.

Implantação anterior Hostinger01a1adf4-0821-700e-aa2e-a53d857af4a0,commit ecf7ecb9. A reversão é do commit desta alteração,sem restaurar banco ou apagar novos dados/vínculos. O inverso será verificado localmente contra a árvore original antes do merge. Preservar a configuração e o fluxo GitHub→Hostinger. Se houver falha funcional,interromper testes de vínculos e reverter o commit da publicação.

## Limites do piloto
Aplicativo Meta enviado para análise; isso não equivale a acesso aprovado de terceiros. Cada participante precisa aceitar função adequada de teste no app e ter acesso às contas de anúncios. Validar uma conta por participante antes de ampliar. Segunda identidade Facebook e contas de clientes de outras pessoas ainda precisam de prova real; o teste anterior com dois usuários CRM não prova isso. Não conceder funções administrativas sem aprovação específica.
