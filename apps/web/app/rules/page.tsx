import type { Metadata } from 'next';
import Link from 'next/link';
import { karachi, type GameProgress, type Wind } from '@society/engine';
import { Tile } from '@/components/tile';
import { GLOSSARY, TERMS } from '@/lib/coach/glossary';

export const metadata: Metadata = {
  title: 'Karachi mahjong rules: how to play',
  description: 'Karachi mahjong rules in plain English: the tiles, claiming a discard, the hand each wind round asks for, goulash and the exchange, scoring, and the words you will hear.',
  alternates: { canonical: '/rules' },
  // Next replaces a nested object whole, so the site fields from the root layout are repeated here.
  openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB', url: '/rules' },
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
        <p className="eyebrow">The rules</p>
        <h1 className="font-display">How to play Karachi mahjong</h1>
        <p className="lede">Karachi mahjong blends Mumbai and Western play, and has been passed on by word of mouth in Karachi since at least the 1970s. Each wind round asks for a different hand. Four seats, thirteen tiles each, one goal: complete a hand before anyone else. Here is everything a first-timer needs. The tutor covers the rest at the table.</p>
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
          And if a discard completes your whole hand, you call <b>Mahjong</b> and the hand is over. In Karachi rules a <b>chow</b> (a run of three in one suit) is built from tiles you draw
          yourself: you cannot claim a discard to make one, unless that tile completes your whole hand.
        </p>
        <p>On a live table a claim window opens for a few seconds after each discard. If nobody wants the tile, play moves on. The window is longer when a win is on offer.</p>
      </section>

      <section>
        <h2 className="font-display">Karachi rules: four rounds, four asks</h2>
        <p>
          A game is four rounds of four hands, and each round asks for a different kind of hand. Here the deal passes one seat to the right after every hand, so each of you deals once a round. The tutor names the
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
          The first hand of the game and every hand of the West round are <b>goulash</b> hands. Each West hand starts with an <b>exchange</b>: everyone passes three tiles to the right, then
          across, then to the left, before a tile is drawn. Elsewhere a goulash is the hand played after a washed-out hand; here it opens the game.
        </p>
      </section>

      <section>
        <h2 className="font-display">Scoring</h2>
        <p>
          Most hands pay a flat stake: each of the other three pays the winner, and the dealer (East) pays and receives double. Here, if the winner holds their own flower or season (the one
          numbered for their seat: 1 for East, 2 for South, and so on), the stake doubles; if they hold both, it quadruples. The goulash hands are scored differently: points for each set, pair
          and flower, then doubled for each special feature, and winning <b>off the wall</b> is one of those features. It is points only, never money. The table keeps a running tally; you will
          see it next to each name.
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
        <Link href="/room" className="btn btn-primary btn-block min-h-[52px] text-[18px]">
          Host a table for your friends
        </Link>
        <Link href="/play/solo" className="btn btn-ghost btn-block min-h-[52px] text-[18px]">
          Practise on the bots
        </Link>
        <Link href="/" className="link-quiet">
          Society Mahjong home
        </Link>
      </footer>
    </main>
  );
}
