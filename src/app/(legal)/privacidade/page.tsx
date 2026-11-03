import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Política de Privacidade</h1>
      <p>Atualizada em {LEGAL.updatedAt}.</p>

      <h2>Quem somos</h2>
      <p>
        {LEGAL.company} (&ldquo;{LEGAL.brand}&rdquo;) é uma agência de publicidade. {LEGAL.product} é o módulo de relatórios do nosso CRM ({LEGAL.site}),
        usado pela nossa equipe para acompanhar os resultados de anúncios dos nossos clientes. Esta política explica quais dados esse módulo
        trata e por quê.
      </p>

      <h2>Que dados tratamos</h2>
      <p>Quando alguém da nossa equipe entra com o Facebook em {LEGAL.product}, e somente depois de autorizar, tratamos:</p>
      <ul>
        <li>nome e identificador da conta do Facebook, apenas para mostrar &ldquo;Conectado como …&rdquo; e saber de quem é a conexão;</li>
        <li>
          das contas de anúncios que a própria pessoa escolhe e já acessa: nome, identificador, moeda, fuso horário e os números de desempenho
          (valor gasto, impressões, alcance, cliques, CTR, CPC e CPM), lidos com a permissão <strong>ads_read</strong> (somente leitura);
        </li>
        <li>um token de acesso, que guardamos criptografado e usamos só para ler os dados acima.</li>
      </ul>
      <p>
        Não alteramos campanhas, anúncios, orçamentos nem configurações. Não acessamos mensagens, amigos, publicações ou outros dados pessoais do
        Facebook.
      </p>

      <h2>Para que usamos</h2>
      <ul>
        <li>mostrar à nossa equipe e ao cliente dono da conta os relatórios de desempenho dos anúncios;</li>
        <li>manter a conexão funcionando, renovando o token antes de ele vencer.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <p>
        Não vendemos nem cedemos esses dados. Os números de uma conta aparecem apenas para a nossa equipe e para o cliente a quem a conta
        pertence. Usamos fornecedores de infraestrutura (hospedagem e banco de dados) que tratam os dados em nosso nome, sob contrato.
      </p>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Enquanto a conexão estiver ativa. Quando ela é removida, ou quando você pede a exclusão, apagamos o token e os dados da conexão em até{" "}
        {LEGAL.deletionDays} dias. Veja como em <a href="/exclusao-de-dados">Exclusão de dados</a>.
      </p>

      <h2>Segurança</h2>
      <p>
        O token é criptografado em repouso e só o servidor consegue lê-lo. O acesso ao CRM exige login e permissões por pessoa. Nenhum token ou
        chave é exibido na tela nem enviado ao navegador.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Nos termos da LGPD (Lei 13.709/2018), você pode pedir acesso, correção, eliminação dos seus dados e a revogação do consentimento. Para a
        conta do Facebook, você também pode remover o aplicativo a qualquer momento em Configurações do Facebook → Aplicativos e sites.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas ou pedidos: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
    </>
  );
}
