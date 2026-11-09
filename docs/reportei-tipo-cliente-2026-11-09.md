# Tipo de resultado do cliente

O seletor anterior existia, mas era discreto e ficava junto aos eventos técnicos. A ficha do cliente agora mantém um cartão permanente com Geração de leads, E-commerce e Misto, nas mesmas condições de permissão anteriores. O tipo também aparece nos cartões da lista e no seletor de contas Meta.

A classificação continua no mesmo registro por cliente. Não depende do usuário que conectou, não exige reconexão e não altera anúncios, orçamentos, eventos de conversão, relatórios salvos ou documentos personalizados. Misto permite acompanhar captação e vendas no dashboard geral; a configuração não transforma automaticamente dashboards editados nem cria dados que a Meta não fornece.

O salvamento mostra falha e permite tentar novamente; a ficha não desaparece se a configuração não carregar. Durante a gravação no seletor Meta, a conclusão do vínculo aguarda o término. As duas instâncias do seletor sincronizam após a confirmação do servidor.

Validação: lint dos cinco arquivos, testes de cartões e compilação webpack/TypeScript passaram. Navegação local com banco fictício comprovou leads → e-commerce, persistência após recarregar, Misto no seletor Meta sincronizado com a ficha e selo na lista. Ao final, o cliente fictício foi devolvido a leads. Nenhuma conta Meta real foi conectada ou removida durante esse teste.

Sem migração, dependência, credencial ou permissão nova. Backup e prova de reversão ficam em `E:/Claude/Backups/CRM-Aureon-Tipo-Cliente-2026-11-09`; anexos e configuração já preservados no backup completo anterior, sem alterações nesta entrega. A.N. PETS deve continuar como leads em produção.

## Correção visual dos eventos

O print de Allan mostrou opções nativas brancas com texto sem contraste no tema escuro. Os menus de evento de lead e compra agora reutilizam Select/SelectContent do CRM, com as cores do tema e opções legíveis. O tipo do cliente permanece nos três controles destacados. Teste no Chrome local confirmou os dois menus abertos, seleção de lead persistida após recarregar e restauração ao padrão. Nenhum evento de cliente real foi alterado. Lint e compilação passaram.
