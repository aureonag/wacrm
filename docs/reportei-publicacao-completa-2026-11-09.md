# Publicação dos dashboards e nova visualização — 09/11/2026

## Escopo

Entrega autorizada por Allan: visualização completa do módulo Reportei, preservando os demais módulos do CRM. Base de produção conferida no Git e na Hostinger: `ea0fa099a2fd664b96a6cdb0eabeb82b4a135883`. Visualização de origem: branch local `feat/reportei-metas`, commit `58e0b83`, com os ajustes de fechamento do seletor já validados em produção.

Inclui cartões de clientes, ficha com relatórios/dashboards/metas/marcos, dashboard geral com séries diárias reais, tabela detalhada, dashboard editável por cliente, editor de relatórios, modelos, seleção de campanhas e automação contextual. As mudanças compartilhadas se limitam à navegação Reportei, tipos de notificação desse módulo, tradução e animações CSS com prefixo `reportei-`.

OAuth, vínculo validado, múltiplas identidades, segredo do app, configurações da hospedagem, dependências, outros módulos e dados existentes foram preservados. Instagram/Facebook orgânicos e Google continuam sem fonte real; não são preenchidos com números fictícios em documentos reais.

## Conferência e ajustes

- Modo real é padrão. Demonstração é explícita e marcada.
- Compatibilidade com relatórios antigos sem campos de lead/conversa: indisponível, sem inventar zero.
- Totais atuais permanecem disponíveis quando a comparação está desligada ou indisponível.
- Moeda real acompanha os indicadores monetários, totais e gráficos. Moedas diferentes não são somadas.
- Atualização preserva a moeda e as edições do documento. Investimento é contexto, sem classificar aumento como melhora.
- CSV de indicador indisponível exporta o motivo, não o zero interno usado pelo editor.
- Cache do dashboard considera a lista completa de clientes e o intervalo de comparação.

## Banco e reversão

Conferência somente leitura confirmou tabelas e colunas utilizadas, com RLS. **Nenhuma migração aplicada nesta entrega.** A coluna opcional de janelas de atribuição (181) continua ausente; o código mantém a atribuição padrão da Meta e informa a indisponibilidade de configuração.

Backup separado: `E:/Claude/Backups/CRM-Aureon-Dashboards-2026-11-09`. Código anterior, configuração privada, dump PostgreSQL e 57 anexos conferidos por hash. Dump de 2.839.845 bytes, SHA256 `9fa1151b8139663ed40d250b1c99eff51637ee3423e70b622d218e6263963f4b`, índice válido com 173 entradas de dados. Isso não equivale a uma restauração integral do Supabase testada.

Reversão de código deve retornar à árvore anterior sem restaurar o banco: preservar relatórios, vínculos e dados criados após a publicação. O identificador do commit final, prova local da inversão e implantação ficam no diretório privado do backup e na auditoria de retomada.

## Validação

- 331 testes do módulo em 32 arquivos passaram.
- Verificação dos arquivos alterados sem erros de lint.
- Compilação webpack e TypeScript com 130 páginas estáticas concluída na cópia isolada, usando banco fictício de homologação.
- Navegação local autenticada confirmou cartões, ficha do cliente e dashboard real sem integrar contas: ausência de dados permanece explícita.

A homologação publicada para análise da Meta não foi substituída. A conferência final de produção e sua evidência são registradas após a implantação; testes automatizados não substituem reconciliação com a tela nativa da Meta. Regras de destaque/atenção continuam identificadas como provisórias. Não foi testada expiração real de token ou a experiência da sessão pessoal de Mauro nesta entrega.
