// The vertical order of a post's photo and Q&A cards. The defaults below are
// what every post used before the order became editable, and they double as the
// canonical list of slots a stored order is validated against.
export type CardSlot = { type: 'photo' | 'qa'; index: number };

// 3 photos, 3 Q&As.
export const DEFAULT_GROUP_CARD_ORDER: CardSlot[] = [
  { type: 'photo', index: 0 },
  { type: 'qa', index: 0 },
  { type: 'photo', index: 1 },
  { type: 'photo', index: 2 },
  { type: 'qa', index: 1 },
  { type: 'qa', index: 2 },
];

// 2 photos, 2 Q&As.
export const DEFAULT_PERSON_CARD_ORDER: CardSlot[] = [
  { type: 'photo', index: 0 },
  { type: 'qa', index: 0 },
  { type: 'photo', index: 1 },
  { type: 'qa', index: 1 },
];

// How a slot is stored (card_order is a text[]) and keyed in React.
export function slotKey(slot: CardSlot): string {
  return `${slot.type}${slot.index}`;
}

export function toStoredCardOrder(order: CardSlot[]): string[] {
  return order.map(slotKey);
}

// A stored order is user data that can lag the code: a row saved when profiles
// had three photo slots, a row that predates the column entirely, a key that no
// longer exists. Unknown keys are dropped and unmentioned slots keep their
// default position, so the result is always a complete permutation of
// `fallback` — never short, never duplicated.
export function reconcileCardOrder(
  stored: string[] | null | undefined,
  fallback: CardSlot[],
): CardSlot[] {
  if (!stored?.length) return fallback;

  const unplaced = new Map(fallback.map(slot => [slotKey(slot), slot]));
  const order: CardSlot[] = [];
  for (const key of stored) {
    const slot = unplaced.get(key);
    if (slot) {
      order.push(slot);
      unplaced.delete(key);
    }
  }
  for (const slot of fallback) {
    if (unplaced.has(slotKey(slot))) order.push(slot);
  }
  return order;
}

// Photos upload to deterministic paths (img1.jpg, img2.jpg, …), so a URL's own
// filename — not its position in image_urls, which collapses gaps — says which
// slot it belongs to. Edit and view mode both resolve photo cards through this,
// or a saved card order would mean different things to the owner and to
// everyone else.
export function photoSlotsFromUrls(urls: string[], count: number): (string | null)[] {
  const slots: (string | null)[] = Array(count).fill(null);
  for (const url of urls) {
    const match = url.match(/img(\d)\.jpg/);
    const slot = match ? parseInt(match[1]) - 1 : -1;
    if (slot >= 0 && slot < count) slots[slot] = url;
  }
  return slots;
}
