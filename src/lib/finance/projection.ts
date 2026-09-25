// ============================================================
// "Até cancelar": a RECURRING contract is open-ended, so an active client keeps
// paying its last known monthly value until it is marked as ended.
// The grid only stores months someone typed (or the closing sheet
// created), so future months are PROJECTED on read (only for clients flagged
// recurring — one-off jobs must never repeat): the last explicit
// value carries forward. Explicit rows always win, and past months are
// never invented — projection starts at the current month.
// ============================================================

export interface ProjectionClient {
  id: string;
  status: string;
  /** Only recurring clients are projected — one-off jobs must not repeat. */
  recurring: boolean;
  /** YYYY-MM-DD; the last month the client is billed (inclusive). */
  ended_at: string | null;
}

export interface ProjectionValue {
  client_id: string;
  year: number;
  month: number;
  amount: number;
}

export interface ProjectedCell {
  amount: number;
  projected: boolean;
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/** Key format shared with the grids: `${clientId}:${month}`. */
export function projectYear(params: {
  clients: ProjectionClient[];
  /** Explicit rows for this year AND earlier years (the last known value may be from before). */
  values: ProjectionValue[];
  year: number;
  now?: Date;
}): Map<string, ProjectedCell> {
  const now = params.now ?? new Date();
  const currentIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);

  const explicit = new Map<string, Map<number, number>>();
  const last = new Map<string, { idx: number; amount: number }>();
  for (const v of params.values) {
    const idx = monthIndex(v.year, v.month);
    const amount = Number(v.amount) || 0;
    let perClient = explicit.get(v.client_id);
    if (!perClient) explicit.set(v.client_id, (perClient = new Map()));
    perClient.set(idx, amount);
    const prev = last.get(v.client_id);
    if (!prev || idx > prev.idx) last.set(v.client_id, { idx, amount });
  }

  const out = new Map<string, ProjectedCell>();
  for (const client of params.clients) {
    const perClient = explicit.get(client.id);
    const lastKnown = last.get(client.id);
    let endIdx = Infinity;
    if (client.ended_at) {
      const y = Number(client.ended_at.slice(0, 4));
      const m = Number(client.ended_at.slice(5, 7));
      if (y && m) endIdx = monthIndex(y, m);
    }
    const canProject =
      client.recurring && client.status === "active" && !!lastKnown && lastKnown.amount > 0;

    for (let month = 1; month <= 12; month++) {
      const idx = monthIndex(params.year, month);
      const typed = perClient?.get(idx);
      if (typed !== undefined) {
        out.set(`${client.id}:${month}`, { amount: typed, projected: false });
      } else if (canProject && idx > lastKnown!.idx && idx >= currentIdx && idx <= endIdx) {
        out.set(`${client.id}:${month}`, { amount: lastKnown!.amount, projected: true });
      }
    }
  }
  return out;
}
