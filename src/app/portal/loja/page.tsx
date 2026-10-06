import { redirect } from "next/navigation";

// /portal/loja has no content of its own: /portal decides where to go.
export default function StoreRoot() {
  redirect("/portal");
}
