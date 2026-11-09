# Conversas por mensagem como indicador e fonte dos leads

- Catálogo Meta Ads: Conversas por mensagem iniciadas e Custo por conversa. Usa o campo já coletado em actions: onsite_conversion.messaging_conversation_started_7d. O custo é investimento dividido por conversas; sem conversas, fica indisponível, nunca custo zero.
- Dashboard geral: cartão de conversas, separado do total de leads. Quantidades ausentes em fotografias antigas não viram zero. O cartão informa sua cobertura.
- Ficha e conexão Meta: Fonte dos leads fica visível. A pessoa pode escolher conversas como o evento que conta os leads do cliente. O evento escolhido também determina CPL, comparação, totais e classificação no geral. Não há fallback automático nem soma lead + conversas. Nenhum cliente real é reconfigurado por esta publicação.
- Novos dashboards incluem os dois indicadores; dashboards editados existentes preservam o layout e podem adicionar esses indicadores pelo catálogo. Relatórios previamente gerados não são reescritos.
- Cache considera a configuração dos eventos para não reapresentar a fonte anterior depois da escolha. Ficha e diálogo sincronizam a seleção.
- Sem nova permissão, migração, reconexão, alteração de anúncios/orçamentos ou dependências.

Validação: 338 testes do módulo aprovados, incluindo seleção exata do evento, ausência de duplicação, CPL, leitura e comparação reais dos widgets, falta de base e snapshots antigos. Build e navegador registrados no backup da entrega.

A API já coletava o campo antes desta mudança. A documentação de referência autenticada da Meta exigiu login na consulta externa; a entrega não assume equivalência com mensagens recebidas ou pessoas únicas. A conciliação com a coluna específica do Gerenciador de Anúncios de cada cliente permanece uma validação operacional separada.
