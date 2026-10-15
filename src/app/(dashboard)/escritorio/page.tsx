import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, LockKeyhole } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { getOfficeContext, OfficeConfigurationError } from "@/lib/office/access";
import type { OfficeContext } from "@/lib/office/access";
import { isOfficeEnabled } from "@/lib/office/runtime/server";
import { OfficeFrame } from "@/components/office/office-frame";

export const metadata: Metadata = {
  title: "Escritório Aureon",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OfficePage() {
  let identity: OfficeContext;
  try {
    identity = await getOfficeContext();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login?next=%2Fescritorio");
    if (error instanceof ForbiddenError || error instanceof OfficeConfigurationError) {
      const restricted = error instanceof ForbiddenError;
      return (
        <section className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
          <h1 className="text-2xl font-semibold">Escritório</h1>
          <Alert>
            <LockKeyhole aria-hidden="true" />
            <AlertTitle>
              {restricted ? "Acesso exclusivo à equipe Aureon" : "O escritório está em preparação"}
            </AlertTitle>
            <AlertDescription>
              {restricted
                ? "Entre no CRM com seu usuário vinculado à conta Aureon para acessar este espaço."
                : "Você poderá entrar por aqui quando o escritório estiver disponível."}
            </AlertDescription>
          </Alert>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
            Voltar ao CRM
          </Link>
        </section>
      );
    }
    throw error;
  }
  // The flag stays off until the private bundle and database migration are installed.
  if (isOfficeEnabled()) return <OfficeFrame userId={identity.user.id} accountId={identity.accountId} />;
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Escritório Aureon</h1>
        <p className="text-muted-foreground">Olá, {identity.user.name}.</p>
      </header>
      <Alert>
        <Building2 aria-hidden="true" />
        <AlertTitle>Estamos preparando seu escritório</AlertTitle>
        <AlertDescription>
          Seu acesso foi reconhecido pelo CRM. O espaço de trabalho será disponibilizado
          aqui para a equipe Aureon.
        </AlertDescription>
      </Alert>
      <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
        Voltar ao CRM
      </Link>
    </section>
  );
}
