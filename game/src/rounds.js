// Rounds for EMBERLINE: freeze (8 s, buy menu open) -> live (100 s) -> over
// (5 s banner) -> next round. First to 7 wins the match (max 13 rounds).
// A round ends by elimination, by the bomb, or by the clock; the economy pays
// $3000 to the winners, $1900 to the losers, $300 per kill (paid in combat.js).
export const WIN_SCORE = 7;
export const MAX_ROUNDS = 13;
export const ROUND_TIME = 100;
export const FREEZE_TIME = 8;
export const OVER_TIME = 5;

export function createRounds() {
  return {
    num: 1,
    phase: 'freeze', // freeze | live | over
    phaseT: FREEZE_TIME,
    timer: ROUND_TIME,
    score: { atk: 0, def: 0 },
    lastReason: '',
    matchOver: false,
    matchWinner: null,
  };
}

function aliveCount(G, team) {
  let n = 0;
  for (const f of G.fighters) if (f.alive && f.team === team) n += 1;
  return n;
}

export function stepRounds(G, dt) {
  const r = G.rounds;
  if (r.matchOver) return;
  if (G.freezeClock) return; // title-screen mode: the clock never runs

  if (r.phase === 'freeze') {
    r.phaseT -= dt;
    if (r.phaseT <= 0) {
      r.phase = 'live';
      r.timer = ROUND_TIME;
      G.audio.roundStart();
    }
    return;
  }

  if (r.phase === 'over') {
    r.phaseT -= dt;
    if (r.phaseT <= 0) {
      if (r.score.atk >= WIN_SCORE || r.score.def >= WIN_SCORE || r.num >= MAX_ROUNDS) {
        r.matchOver = true;
        r.matchWinner = r.score.atk === r.score.def ? 'draw' : r.score.atk > r.score.def ? 'atk' : 'def';
        if (r.matchWinner === 'atk') G.audio.roundWin();
        else if (r.matchWinner === 'def') G.audio.roundLose();
        return;
      }
      r.num += 1;
      G.resetRound();
    }
    return;
  }

  // Live: the clock and the win conditions.
  r.timer -= dt;
  let end = G.roundEnd;
  if (!end) {
    const atkAlive = aliveCount(G, 'atk');
    const defAlive = aliveCount(G, 'def');
    if (G.bomb.state === 'planted') {
      // With the bomb down, the round only ends on defuse, detonation, or
      // the defenders being wiped out.
      if (defAlive === 0) end = { winner: 'atk', reason: 'defenders eliminated' };
    } else if (atkAlive === 0) {
      end = { winner: 'def', reason: 'attackers eliminated' };
    } else if (defAlive === 0) {
      end = { winner: 'atk', reason: 'defenders eliminated' };
    } else if (r.timer <= 0) {
      end = { winner: 'def', reason: 'time expired' };
    }
  }
  if (end) endRound(G, end);
}

function endRound(G, end) {
  const r = G.rounds;
  r.score[end.winner] += 1;
  r.lastReason = end.reason;
  r.phase = 'over';
  r.phaseT = OVER_TIME;
  G.roundEnd = null;
  // Economy: winners $3000, losers $1900.
  for (const f of G.fighters) {
    f.money += f.team === end.winner ? 3000 : 1900;
    if (f.money > 16000) f.money = 16000;
  }
  if (end.winner === 'atk') G.audio.roundWin();
  else G.audio.roundLose();
  G.hud.banner = {
    text: (end.winner === 'atk' ? 'EMBERLINE wins the round' : 'DEFENDERS hold the yard') + ' — ' + end.reason,
    sub: 'Round ' + r.num + '  ·  ' + r.score.atk + ' – ' + r.score.def,
    t: OVER_TIME,
  };
}
