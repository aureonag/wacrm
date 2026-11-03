// Who the public legal pages (/privacidade, /termos, /exclusao-de-dados) speak
// for. These pages are what Meta's app review and Facebook Login ask for, so the
// contact must be a mailbox the company really reads: set
// NEXT_PUBLIC_LEGAL_CONTACT_EMAIL on the server to change it.

export const LEGAL = {
  company: "Aureon Publicidade Ltda.",
  brand: "Aureon",
  product: "Aureon Reportei",
  site: "https://aureonag.com",
  contactEmail: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "contato@aureonag.com",
  updatedAt: "3 de novembro de 2026",
  /** Days the company commits to finish a deletion request. */
  deletionDays: 30,
} as const;
