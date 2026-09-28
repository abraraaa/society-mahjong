import type { Seat } from '@society/engine';
import type { GameOver } from './table-state';

/**
 * The final table: who finished where. Pure, and safe to load in the
 * browser: the page ranks the rows it shows, and the server writes the same
 * places to game_players when the game ends.
 */

/** One seat's line on the final table. `rank` is shared by a tie: 1, 1, 3, 4. */
export interface Standing {
  readonly seat: Seat;
  readonly name: string;
  readonly bot: boolean;
  readonly score: number;
  readonly rank: number;
}

/** The seats ranked by score, highest first, a tie in seat order and sharing its rank (1, 1, 3, 4). Empty seats aren't ranked. */
export function finalStandings(seats: readonly ({ readonly name: string; readonly bot: boolean } | null)[], scores: readonly number[]): Standing[] {
  const rows = seats.flatMap((s, i) => (s === null ? [] : [{ seat: i as Seat, name: s.name, bot: s.bot, score: scores[i] ?? 0 }]));
  rows.sort((a, b) => b.score - a.score || a.seat - b.seat);
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.score > r.score).length }));
}

/** One game_players row as the end writes it. */
export interface FinalPlayer {
  readonly seat: Seat;
  readonly user_id: string | null;
  readonly kind: 'human' | 'bot';
  readonly name: string;
  readonly score: number;
  readonly place: number | null;
}

/**
 * The game_players rows for a game that has ended, one per seat it was
 * played with: who sat there at the end (a person's id on a human's row only),
 * their final score as a whole number (the column is an integer, and a
 * fraction must never stop a game ending), and their place. An abandoned game
 * has no places: nobody finished it.
 */
export function finalPlayers(over: GameOver): readonly FinalPlayer[] {
  const scores = over.scores.map((n) => Math.round(n));
  const places = new Map(
    finalStandings(
      over.seats.map((s) => (s ? { name: s.name, bot: s.kind === 'bot' } : null)),
      scores,
    ).map((st) => [st.seat, st.rank]),
  );
  return over.seats.flatMap((s, i) =>
    s === null
      ? []
      : [
          {
            seat: i as Seat,
            user_id: s.kind === 'human' ? s.userId : null,
            kind: s.kind,
            name: s.name,
            score: scores[i]!,
            place: over.how === 'abandoned' ? null : (places.get(i as Seat) ?? null),
          },
        ],
  );
}
