/** The longest name the table has room for. */
export const NAME_MAX = 24;

/** The name as the gate sends it: trimmed and cut to fit. Empty means there's nothing to sit down with yet. */
export function seatName(typed: string): string {
  return typed.trim().slice(0, NAME_MAX);
}
