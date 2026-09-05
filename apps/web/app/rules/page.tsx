import type { Metadata } from 'next';
import Link from 'next/link';
import { karachi, type GameProgress, type Wind } from '@society/engine';
import { Tile } from '@/components/tile';
import { GLOSSARY, TERMS } from '@/lib/coach/glossary';

export const metadata: Metadata = {
  title: 'How it plays',
  description: 'How a table of mahjong plays, what Karachi rules ask for in each round, and the words you will hear.',
};

const ROUNDS: readonly { wind: Wind; name: string }[] = [
  { wind: 'E', name: 'East' },
  { wind: 'S', name: 'South' },
  { wind: 'W', name: 'West' },
  { wind: 'N', name: 'North' },
];

/** What each round asks for, from the ruleset itself so this page cannot drift from the engine. */
function roundHands() {
  return ROUNDS.map(({ wind, name }, roundIndex) => {
    const specs = [0, 1].map((handInRound) => {
      const progress: GameProgress = { roundWind: wind, roundIndex, handInRound, handIndex: roundIndex * karachi.handsPerRound + handInRound };
      return karachi.handSpec(progress);
    });
    // The first hand of a round can differ from the rest (East opens with a goulash).
    const first = specs[0]!;
    const rest = specs[1]!;
    return { name, first, rest: rest.label === first.label ? null : rest };
  });
}

/**
 * The page a friend reads before, or during, their first table. Plain
 * sentences, the tiles where they say it better, and the same words the
 * tutor uses so nothing has two names.
 */
export default function RulesPage() {
  const rounds = roundHands();
  return (
    <main className="rules">
      <header>
        <p className="eyebrow">How it plays</p>
        <h1 className="font-display">Mahjong, the way this table plays it</h1>
        <p className="lede">Four seats, thirteen tiles each, one goal: complete a hand before anyone else. Here is everything a first-timer needs, and the tutor sits with you for the rest.</p>
      </header>

      <section>
        <h2 className="font-display">The table</h2>
        <p>
          Four players sit at the winds: East, South, West, North. East is the <b>dealer</b> and plays first. Everyone starts with thirteen tiles; the rest form the <b>wall</b>, face down, that
          you draw from.
        </p>
        <p>
          On your turn you <b>draw</b> a tile and <b>discard</b> one, face up, into the <b>river</b> in the middle. That is the whole rhythm: draw, discard, draw, discard, round and round, until
          someone completes a hand.
        </p>
        <div className="tiles">
          <Tile back size="md" />
          <Tile back size="md" />
          <Tile back size="md" />
          <Tile kind="m5" size="md" />
          <Tile kind="s1" size="md" />
          <Tile kind="DR" size="md" />
        </div>
        <p>
          The tiles come in three suits (characters, bamboo, dots) numbered one to nine, four copies of each, plus the <b>honours</b>: the four winds and three dragons. Karachi tables also carry
          flowers and seasons, <b>bonus tiles</b> that sit aside and count at the end.
        </p>
      </section>

      <section>
        <h2 className="font-display">Claiming a discard</h2>
        <p>
          When someone discards a tile you need, you can <b>claim</b> it instead of waiting to draw. Hold two of it and you may take it for a <b>pung</b>; hold three and you may take it for a{' '}
          <b>kong</b>. A claimed set is laid face up on the table for everyone to see.
        </p>
        <div className="tiles">
          <Tile kind="m5" size="sm" />
          <Tile kind="m5" size="sm" />
          <Tile kind="m5" size="sm" />
          <span className="gap" />
          <Tile kind="p2" size="sm" />
          <Tile kind="p2" size="sm" />
          <Tile kind="p2" size="sm" />
          <Tile kind="p2" size="sm" />
        </div>
        <p>
          And if a discard completes your whole hand, you call <b>Mahjong</b> and the hand is over. In Karachi rules a <b>chow</b> (a run of three in one suit) is built only from tiles you draw
          yourself; it cannot be claimed.
        </p>
        <p>On a live table a claim window opens for a few seconds after each discard. If nobody wants the tile, play moves on. The window is longer when a win is on offer.</p>
      </section>

      <section>
        <h2 className="font-display">Karachi rules: four rounds, four asks</h2>
        <p>
          A game is four rounds of four hands, and each round asks for a different kind of hand. The dealer keeps the deal after winning; otherwise it passes to the right. The tutor names the
          round&apos;s hand at the top of the table and points you towards it.
        </p>
        <dl className="rounds">
          {rounds.map((r) => (
            <div key={r.name}>
              <dt>{r.name}</dt>
              <dd>
                <b>{r.first.label}.</b> {r.first.description}
                {r.rest && (
                  <>
                    {' '}
                    Then <b>{r.rest.label.replace(/^\w+: /, '')}</b>: {r.rest.description}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          A <b>goulash</b> hand starts with an <b>exchange</b>: everyone passes three tiles to the right, then across, then to the left, before a tile is drawn. West round is nothing but goulash.
        </p>
      </section>

      <section>
        <h2 className="font-display">Scoring</h2>
        <p>
          The winner is paid by the other three; the amount depends on the hand and on how it was completed. Winning on a tile you drew yourself (<b>self-drawn</b>) pays more than winning on a
          discard. The table keeps a running tally; you will see it next to each name.
        </p>
      </section>

      <section>
        <h2 className="font-display">Words you will hear</h2>
        <dl className="glossary-list">
          {TERMS.map((t) => {
            const e = GLOSSARY[t];
            return (
              <div key={t}>
                <dt>{e.label}</dt>
                <dd>
                  <p>{e.long}</p>
                  {e.example && (
                    <div className="tiles">
                      {e.example.map((k, i) => (
                        <Tile key={i} kind={k} size="sm" />
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <footer>
        <Link href="/play/solo" className="btn btn-primary btn-block min-h-[52px] text-[18px]">
          Play a hand alone
        </Link>
        <Link href="/" className="link-quiet">
          Back to the front
        </Link>
      </footer>
    </main>
  );
}
