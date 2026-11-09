# Dashboards — abertura no mês atual (2026-11-09)

O dashboard geral, a tabela e o painel ao vivo dos clientes passam a abrir no mês até hoje. Novos dashboards usam o mesmo padrão. Dashboards editáveis existentes também abrem no mês atual, independentemente de um intervalo anteriormente salvo.

As datas usam America/Sao_Paulo. A comparação inicial permanece a janela imediatamente anterior, de igual duração: 01–09/11 compara com 23–31/10. O seletor de períodos continua disponível; ao reabrir, o padrão volta ao mês atual. Não foram alteradas as datas de relatórios já gerados.

A abertura do dashboard editável relê os indicadores para o intervalo apresentado, preservando o layout e os textos. Não escreve no banco. Falha total de leitura retorna erro, sem reaproveitar uma fotografia antiga sob novas datas. A seleção manual mantém a atualização existente pelo servidor.

Validação: 29 testes de períodos, comparação e documentos; lint dos arquivos alterados. Compilação e verificação no navegador registradas no diretório de backup da entrega. Sem migração ou alteração de configurações, anúncios e orçamentos.
