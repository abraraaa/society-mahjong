'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { SEATS, analysisBot, initialProgress, karachi, nextHand, reduce, startHand, viewFor, type Action, type BotOptions, type HandState, type Seat } from '@society/engine';
import { NO_SCORES, applyResult, type Scores } from '@/lib/ledger';
import { Table } from '@/components/table';
import { tableFlow } from '@/lib/table-flow';
import { analyseFor, coachFor, stageFor, type CoachState } from '@/lib/coach';

const ME: Seat = 0;
const ruleset = karachi;
/** Local flavour only — the engine knows seats, not names. */
const NAMES: Record<Seat, string> = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' };

/** What the coach has watched this player do, which is how it decides how much to say. */
interface Progress {
  readonly handsFinished: number;
  readonly wins: number;
  readonly discardsMade: number;
}
const NO_PROGRESS: Progress = { handsFinished: 0, wins: 0, discardsMade: 0 };

function botStep(state: HandState, bots: BotOptions): HandState {
  let s = state;
  for (const seat of SEATS) {
    if (seat === ME || s.phase === 'finished') continue;
    const a = analysisBot(viewFor(s, ruleset, seat), ruleset, bots);
    if (a) s = reduce(s, a, ruleset);
  }
  return s;
}

/** The solo table: the engine runs in the browser, three bots take the other seats. */
export function SoloTable({ seed }: { seed: string }) {
  // The seed is dealt by the server (see page.tsx) so the first client render
  // matches the HTML it hydrates without a re-seed after mount.
  const [state, setState] = useState<HandState>(() => startHand(ruleset, { seed, progress: initialProgress, dealer: 0 }));
  const [tutorOn, setTutorOn] = useState(true);
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const [scores, setScores] = useState<Scores>(NO_SCORES);
  const [gameOver, setGameOver] = useState(false);
  const [round, setRound] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();

  const view = useMemo(() => viewFor(state, ruleset, ME), [state]);
  const flow = tableFlow(state, view.legal, ME);

  // The analysis is the expensive part (a bounded search per pattern), so it is
  // memoised on the state it was taken from and handed to the coach.
  const analysis = useMemo(() => analyseFor(view, ruleset), [view]);
  const stage = stageFor(progress);
  const coach: CoachState = useMemo(() => coachFor({ view, ruleset, analysis, stage, names: NAMES }), [view, analysis, stage]);
  // Company for a beginner: the bots fumble a little until the player has a few wins.
  const bots: BotOptions = useMemo(() => ({ strength: stage === 'solid' ? 'sharp' : 'gentle' }), [stage]);

  // Let bots act whenever it is not our move, paced so the table reads as a conversation.
  useEffect(() => {
    if (flow === 'over' || flow === 'mine') return;
    // Nothing claimable for us, but the engine still wants our response before
    // the window can close; it is given without the bots' pause.
    const autoPass = (s: HandState) => (s.phase === 'claim' && s.claims[ME] === undefined ? reduce(s, { type: 'pass', seat: ME }, ruleset) : s);
    const t = flow === 'auto-pass' ? setTimeout(() => setState(autoPass), 0) : setTimeout(() => setState((s) => botStep(s, bots)), 450);
    return () => clearTimeout(t);
  }, [state, flow, bots]);

  const act = (a: Action) => {
    if (a.type === 'discard') setProgress((p) => ({ ...p, discardsMade: p.discardsMade + 1 }));
    setState((s) => reduce(s, a, ruleset));
  };

  // The ledger moves when a hand ends, once, before the next one is dealt.
  const settled = useMemo(() => (state.phase === 'finished' ? applyResult(scores, state.result) : scores), [state, scores]);
  const over = state.phase === 'finished' && nextHand(state, ruleset) === null;

  const onNextHand = () => {
    setProgress((p) => ({ ...p, handsFinished: p.handsFinished + 1, wins: p.wins + (state.result?.type === 'win' && state.result.winner === ME ? 1 : 0) }));
    if (over || gameOver) {
      // A new game: scores back to nought, a fresh seed so the deals differ.
      setScores(NO_SCORES);
      setGameOver(false);
      setRound((r) => r + 1);
      setState(startHand(ruleset, { seed: `${seed}-${round + 1}`, progress: initialProgress, dealer: 0 }));
      return;
    }
    setScores(settled);
    const n = nextHand(state, ruleset)!;
    setState(startHand(ruleset, { seed, ...n }));
  };

  return (
    <>
      {leaving && (
        <ConfirmSheet
          title="Leave the table?"
          body="A solo game is not kept. The next one deals fresh."
          confirmLabel="Leave"
          onConfirm={() => router.push('/')}
          onCancel={() => setLeaving(false)}
        />
      )}
      <Table
        view={view}
        label={ruleset.handSpec(state.progress).label}
        names={NAMES}
        onLeave={() => setLeaving(true)}
        coach={coach}
        tutorOn={tutorOn}
        onToggleTutor={() => setTutorOn((v) => !v)}
        onAct={act}
        onNextHand={onNextHand}
        scores={settled}
        handsPerRound={ruleset.handsPerRound}
        gameOver={over}
      />
    </>
  );
}
