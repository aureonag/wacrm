import { redirect } from "next/navigation";

// The sections of Afiliados live in the sidebar submenu; the entry point is
// the list of client accounts.
export default function AffiliatesIndex() {
  redirect("/operational/afiliados/clientes");
}
