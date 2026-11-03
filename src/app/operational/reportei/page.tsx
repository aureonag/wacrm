import { redirect } from "next/navigation";

// The sections of Reportei live in the sidebar submenu; the entry point is
// the list of clients.
export default function ReporteiIndex() {
  redirect("/operational/reportei/clientes");
}
