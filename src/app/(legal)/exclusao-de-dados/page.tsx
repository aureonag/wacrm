import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Exclusão de dados" };

export default function DataDeletionPage() {
  return (
    <>
      <h1>Exclusão de dados</h1>
      <p>Como remover os seus dados de {LEGAL.product}.</p>

      <h2>1. Remova o aplicativo no Facebook</h2>
      <ul>
        <li>Abra o Facebook, em Configurações e privacidade → Configurações.</li>
        <li>Vá em Aplicativos e sites (ou Integrações de negócios).</li>
        <li>Encontre &ldquo;Aureon Reportei&rdquo; e clique em Remover.</li>
      </ul>
      <p>Isso revoga o acesso na hora: o token deixa de funcionar e não conseguimos mais ler as suas contas de anúncios.</p>

      <h2>2. Peça a exclusão dos dados que guardamos</h2>
      <p>
        Escreva para <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> com o assunto &ldquo;Exclusão de dados — Aureon Reportei&rdquo;, dizendo o
        nome que aparece na sua conta do Facebook. Apagamos o token, a conexão e os dados associados em até {LEGAL.deletionDays} dias e respondemos
        confirmando.
      </p>

      <h2>O que é apagado</h2>
      <ul>
        <li>o token de acesso (criptografado) e o registro da conexão com o seu Facebook;</li>
        <li>o vínculo das contas de anúncios com os clientes, quando feito por essa conexão.</li>
      </ul>
      <p>
        Os relatórios já entregues ao cliente podem ser mantidos pelo prazo exigido em lei ou contrato. Mais detalhes na{" "}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>
    </>
  );
}
