// Personal order of the cards inside a board column (migration 119).
//
// Each person can drag cards up/down inside a column; the order is theirs only
// and is kept as a list of ids per stage. The cards' own `position` (shared by
// everyone) is not touched. Cards that are not in the saved list yet — a task
// created after the person organized the column — show at the TOP.
//
// Everything here is pure: the screens feed it the cards and the saved list.

/** Prefix of the droppable id of a card (a stage's droppable id is the stage id). */
export const CARD_DROP_PREFIX = "card:";

export type DropTarget = { beforeId: string } | { afterId: string } | "top" | "end";

/** Cards in the person's order: new ones first (natural order), then the saved order. */
export function applyColumnOrder<T extends { id: string }>(items: T[], saved: string[] | null | undefined): T[] {
  if (!saved || saved.length === 0) return items;
  const rank = new Map(saved.map((id, index) => [id, index]));
  const fresh: T[] = [];
  const placed: T[] = [];
  for (const item of items) (rank.has(item.id) ? placed : fresh).push(item);
  placed.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...placed];
}

/** Puts `movedId` at `target` in the list of ids (it is first taken out if already there). */
export function moveInOrder(ids: string[], movedId: string, target: DropTarget): string[] {
  const rest = ids.filter((id) => id !== movedId);
  if (target === "top") return [movedId, ...rest];
  if (target === "end") return [...rest, movedId];
  const anchorId = "beforeId" in target ? target.beforeId : target.afterId;
  const index = rest.indexOf(anchorId);
  if (index === -1) return [movedId, ...rest];
  const at = "beforeId" in target ? index : index + 1;
  return [...rest.slice(0, at), movedId, ...rest.slice(at)];
}

/** Applies the saved order of each stage to a flat list of cards (stage by stage). */
export function applyOrderByStage<T extends { id: string }>(
  items: T[],
  stageOf: (item: T) => string,
  orders: Record<string, string[] | undefined>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = stageOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  const out: T[] = [];
  for (const [stageId, bucket] of groups) out.push(...applyColumnOrder(bucket, orders[stageId]));
  return out;
}

export interface DropResolution {
  stageId: string;
  target: DropTarget;
  /** The card the drop is next to (null when dropped on the column itself). */
  overCardId: string | null;
}

interface RectLike {
  top: number;
  height: number;
}

/**
 * Where a dragged card lands, from what it is over. Over a card: before or
 * after it, depending on which half the dragged card's center is in. Over the
 * column itself (the free space): at the end.
 */
export function resolveDrop(args: {
  overId: string | null | undefined;
  /** Stage of a card (null if it is not on the board). */
  stageOfCard: (cardId: string) => string | null;
  overRect?: RectLike | null;
  activeRect?: RectLike | null;
  /** The dragged card itself: dropping on it means "no change". */
  activeId: string;
}): DropResolution | null {
  const { overId, stageOfCard, overRect, activeRect, activeId } = args;
  if (!overId) return null;

  if (overId.startsWith(CARD_DROP_PREFIX)) {
    const cardId = overId.slice(CARD_DROP_PREFIX.length);
    if (cardId === activeId) return null;
    const stageId = stageOfCard(cardId);
    if (!stageId) return null;
    const overCenter = overRect ? overRect.top + overRect.height / 2 : 0;
    const activeCenter = activeRect ? activeRect.top + activeRect.height / 2 : overCenter;
    return {
      stageId,
      target: activeCenter < overCenter ? { beforeId: cardId } : { afterId: cardId },
      overCardId: cardId,
    };
  }

  return { stageId: overId, target: "end", overCardId: null };
}
