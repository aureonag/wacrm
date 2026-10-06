// The client / contract number shown next to a client's name ("00351"), the
// same one that appears in the kickoff task title and in the Financeiro list
// ("00351 - CG Complemento"). One client can share it across scopes
// (Tráfego, Social…), so it is a label, never a unique key.

export function ClientCode({ code }: { code: string | null | undefined }) {
  if (!code) return null;
  return (
    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">{code}</span>
  );
}
