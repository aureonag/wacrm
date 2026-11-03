import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <>
      <h1>Termos de Uso</h1>
      <p>Atualizados em {LEGAL.updatedAt}.</p>

      <h2>O que é</h2>
      <p>
        {LEGAL.product} é o módulo de relatórios do CRM da {LEGAL.company}. Ele reúne, para a nossa equipe e para os nossos clientes, os números das
        contas de anúncios que eles nos autorizam a consultar.
      </p>

      <h2>Quem pode usar</h2>
      <p>
        A equipe da {LEGAL.brand} e as pessoas que ela autorizar. Para conectar uma conta de anúncios, a pessoa precisa já ter acesso a ela e
        concordar, na tela do Facebook, em compartilhar a leitura dos dados.
      </p>

      <h2>O que você autoriza</h2>
      <p>
        Ao entrar com o Facebook, você permite que {LEGAL.product} leia (somente leitura) os dados das contas de anúncios que você escolher. Você
        pode revogar essa autorização quando quiser, em Configurações do Facebook → Aplicativos e sites, ou pedindo a exclusão em{" "}
        <a href="/exclusao-de-dados">Exclusão de dados</a>.
      </p>

      <h2>Responsabilidades</h2>
      <ul>
        <li>usar o serviço apenas para contas e clientes que você pode acessar legitimamente;</li>
        <li>não tentar burlar permissões, acessar dados de terceiros ou sobrecarregar o serviço;</li>
        <li>manter a sua conta do CRM e do Facebook protegidas.</li>
      </ul>

      <h2>Disponibilidade</h2>
      <p>
        O serviço é oferecido como está. Os números vêm do Facebook e podem sofrer ajustes ou atrasos fora do nosso controle. Podemos alterar ou
        encerrar o serviço, avisando quando possível.
      </p>

      <h2>Privacidade</h2>
      <p>
        O tratamento de dados está descrito na <a href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2>Contato</h2>
      <p>
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
    </>
  );
}
