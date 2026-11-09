# Dashboard geral: leads e conversas separados

Solicitação de 09/11/2026: tabela com leads/CPL e conversas/custo por conversa na mesma linha de cada cliente. Cartões superiores em pares: Leads gerados, CPL médio, Conversas por mensagem iniciadas, Custo por conversa. O cartão de ROAS foi retirado por enquanto; não foi criada seção de e-commerce nesta entrega.

A tabela preserva faturamento e apresenta zero real/sem base para leads quando o cliente só gerou conversas, sem esconder suas conversas ou calcular custo zero sem resultado. As contagens se mantêm separadas mesmo quando conversas são a fonte do resultado configurado do cliente. A escolha individual é preservada para os dashboards daquele cliente; a ficha explica a distinção.

Custos por cliente: investimento da conta dividido pela respectiva quantidade. Custo consolidado por conversa: soma do investimento dividida pela soma das conversas sobre a mesma população lida, sem média simples dos custos individuais. Sem base ou moeda incompatível, valor indisponível. A comparação usa o mesmo período anterior existente. Cada cartão informa sua cobertura.

A tabela permite rolagem horizontal em telas estreitas; os cartões passam de quatro para dois ou um por linha, preservando a ordem dos pares. Mantidos tema, tipografia, badges e links do CRM.

Sem migração, escrita nas configurações dos clientes, alteração de anúncios/orçamentos ou dependências. Os novos campos de leitura são opcionais para compatibilidade com fotografias anteriores. Testes de regressão cobrem separação das contagens, coexistência, fonte configurada como conversas, falta de dados, divisão por zero, consolidação ponderada, comparação e moeda.

Ajuste visual posterior: na coluna Leads gerados da tabela, quantidade zero ou indisponível aparece somente como traço, sem zero nem badge de comparação/sem base. Quantidades positivas mantêm valor e comparação. As contagens de origem, CPL, conversas e seus custos não são alterados.
