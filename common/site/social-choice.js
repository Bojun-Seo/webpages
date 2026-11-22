// How a group settles on one option, and what some other well-known rules
// would pick, with no DOM, so that Node can test it and fair-pick's API
// can decide with it. A poll decides a date or one of the options its
// maker wrote down, and the two are voted differently.
//
// A date: every voter answers each date ○ (would like it), △ (can come but
// would rather not) or ✕ (cannot come). The rule takes:
//
// 1. The dates the fewest cannot come to, every voter counting one, so that
//    as many come as can.
// 2. Of those, the one with the highest preference score: the sum of the
//    mileage of the voters who gave it ○. Every voter starts with a mileage
//    of 1, which each ✕ they give cuts by 1/n and each △ by half of that,
//    n being the number of dates; what is left is the weight of each of
//    their ○. A voter who leaves many dates open says more with each ○,
//    and a date they give △ loses more, than one who shuts many: ✕ and △
//    cost what they ask of the others.
//
// A choice: every voter puts all the options in order, and so hands out
// the same points as everyone else, n - 1 for the first down to 0 for the
// last. The rule takes:
//
// 1. The option that beats every other head to head, more voters putting
//    it above than below: the Condorcet winner.
// 2. When there is none, because majorities go round in a circle (A beats
//    B, B beats C and C beats A: the Condorcet paradox) or draw, the one
//    with the most Borda points among those caught in it, the top cycle
//    (Smith set): from each voter a point for each other option they put
//    below it. Borda adds up every head-to-head contest at once, so what
//    goes round in a circle cancels out (Saari); a Condorcet winner else
//    Borda's is Black's method (1958).
//
// The rule picks one option and ranks no others. When several are still
// level, the poll's maker spins a roulette of them once it closes, and
// `decide` goes with the option drawn.

import { MEH, NO, YES } from './poll-rules.js';

// A date ballot's mileage in halves of 1/n, n its number of dates: two for
// each ○ and one for each △, which is 2n less two for each ✕ and one for
// each △. Whole numbers keep scores exact; the mileage is this over 2n.
export function mileageHalves(grades) {
  return grades.reduce((sum, grade) => sum + (grade === YES ? 2 : grade === MEH ? 1 : 0), 0);
}

// A date ballot's mileage: 1 with every date ○, 0 with every date ✕.
export function mileage(grades) {
  return grades.length === 0 ? 0 : mileageHalves(grades) / (2 * grades.length);
}

// wins[a][b]: how many voters put option a above option b.
export function pairwise(ballots, count) {
  const wins = Array.from({ length: count }, () => Array(count).fill(0));
  for (const { grades } of ballots) {
    for (let a = 0; a < count; a++) {
      for (let b = 0; b < count; b++) if (grades[a] > grades[b]) wins[a][b] += 1;
    }
  }
  return wins;
}

// Whether `a` beats `b` head to head: more voters put it above.
export function beats(wins, a, b) {
  return wins[a][b] > wins[b][a];
}

// The top cycle (Smith set) of `pool`, a list of options: the smallest set
// of them each of which beats every option of the pool outside it. It is
// the Condorcet winner alone when there is one; otherwise every option
// caught in the circle or the draw at the top. An option is in it when it
// reaches every other through options it beats or draws with.
export function smithSet(pool, wins) {
  const reach = new Map(pool.map((a) => [a, new Set(pool.filter((b) => b === a || wins[a][b] >= wins[b][a]))]));
  for (const via of pool) {
    for (const a of pool) {
      if (reach.get(a).has(via)) for (const b of reach.get(via)) reach.get(a).add(b);
    }
  }
  return pool.filter((a) => reach.get(a).size === pool.length);
}

// Borda points of each option of `set` against those of `pool`: from each
// of `voters`, a point for every other option of the pool they put lower
// and half a point for every one they put level.
export function bordaIn(set, pool, wins, voters) {
  return new Map(set.map((a) => [a, pool.reduce((points, b) => (b === a
    ? points
    : points + wins[a][b] + (voters - wins[a][b] - wins[b][a]) / 2), 0)]));
}

// The shortest circle of head-to-head wins among `set`, as the options in
// order, each beating the next and the last the first ([a, b, c]); null
// when there is none, the options only drawing.
export function cycleIn(set, wins) {
  let shortest = null;
  for (const start of set) {
    const before = new Map([[start, null]]);
    let frontier = [start];
    let last = null;
    while (frontier.length > 0 && last === null) {
      const next = [];
      for (const a of frontier) {
        for (const b of set) {
          if (!beats(wins, a, b)) continue;
          if (b === start) {
            last = a;
            break;
          }
          if (!before.has(b)) {
            before.set(b, a);
            next.push(b);
          }
        }
        if (last !== null) break;
      }
      frontier = next;
    }
    if (last === null) continue;
    const circle = [];
    for (let at = last; at !== null; at = before.get(at)) circle.unshift(at);
    if (!shortest || circle.length < shortest.length) shortest = circle;
  }
  return shortest;
}

// How the rule picks among the options of a date poll: `tallies`, each
// date's { index, counts, absent, score } in the poll's order, `counts`
// being how many gave it ✕, △ and ○, `absent` how many cannot come and
// `score` its preference score in halves of 1/n (scoreOf reads it);
// `pool`, the dates the fewest cannot come to; `first`, those of them with
// the highest score; and `by`, what settled it: 'absent' when one date
// alone has the fewest who cannot come, 'score' when the score picks one
// of several, and 'tie' when it leaves several level.
export function pickDate(ballots, count) {
  const halves = ballots.map((ballot) => mileageHalves(ballot.grades));
  const tallies = Array.from({ length: count }, (_, index) => {
    const counts = [0, 0, 0];
    let score = 0;
    ballots.forEach((ballot, voter) => {
      const grade = ballot.grades[index];
      counts[grade] += 1;
      if (grade === YES) score += halves[voter];
    });
    return { index, counts, absent: counts[NO], score };
  });
  const fewest = Math.min(...tallies.map((t) => t.absent));
  const pool = tallies.filter((t) => t.absent === fewest).map((t) => t.index);
  const best = Math.max(...pool.map((index) => tallies[index].score));
  const first = pool.filter((index) => tallies[index].score === best);
  let by = 'tie';
  if (pool.length === 1) by = 'absent';
  else if (first.length === 1) by = 'score';
  return { tallies, pool, first, by };
}

// A date's preference score as the sum of mileages it is: `score` halves
// of 1/`count`.
export function scoreOf(score, count) {
  return count === 0 ? 0 : score / (2 * count);
}

// How the rule picks among the options of a choice poll: `tallies`, each
// option's { index, firsts, total, record } in the poll's order, `firsts`
// being how many put it first, `total` its Borda points against every
// other option and `record` its wins, draws and losses head to head
// against every other option; `smith`, the top cycle; `cycle`, a circle of
// wins in it, if there is one; `borda`, the Borda points of the top
// cycle's options when there are several; `first`, the option picked, or
// those still level; and `by`: 'condorcet' for the one that beats every
// other head to head, 'borda' for the one of the top cycle with the most
// points, and 'tie' when that leaves several level.
export function pickChoice(ballots, count) {
  const wins = pairwise(ballots, count);
  const all = Array.from({ length: count }, (_, index) => index);
  const totals = bordaIn(all, all, wins, ballots.length);
  const record = (a) => {
    const out = { won: 0, drew: 0, lost: 0 };
    for (const b of all) {
      if (b === a) continue;
      if (beats(wins, a, b)) out.won += 1;
      else if (beats(wins, b, a)) out.lost += 1;
      else out.drew += 1;
    }
    return out;
  };
  const tallies = all.map((index) => ({
    index,
    firsts: ballots.filter((ballot) => ballot.grades[index] === count - 1).length,
    total: totals.get(index),
    record: record(index),
  }));
  const smith = smithSet(all, wins);
  if (smith.length === 1) return { tallies, smith, cycle: null, borda: null, first: smith, by: 'condorcet' };
  const borda = bordaIn(smith, all, wins, ballots.length);
  const most = Math.max(...borda.values());
  const first = smith.filter((index) => borda.get(index) === most);
  return {
    tallies, smith, cycle: cycleIn(smith, wins), borda: Object.fromEntries(borda), first,
    by: first.length === 1 ? 'borda' : 'tie',
  };
}

// How the rule picks among the options of a `kind` poll, as pickDate or
// pickChoice says.
export function pick(kind, ballots, count) {
  return kind === 'date' ? pickDate(ballots, count) : pickChoice(ballots, count);
}

// The key a draw among the options `tied` is kept under: "0,3,4".
export function tieKey(tied) {
  return [...tied].sort((a, b) => a - b).join(',');
}

// The option a closed poll goes with: { index, tied, drawn }, where `tied`
// lists the options the rule picks. When there are several, `draws` maps
// the key of each set of options a roulette was spun for to the option
// drawn: with one for this set, `index` is that option and `drawn` true;
// without, `index` is null and `pending` true, for the maker to spin. Null
// when nobody voted.
export function decide(kind, ballots, count, draws = {}) {
  if (ballots.length === 0) return null;
  const tied = [...pick(kind, ballots, count).first].sort((a, b) => a - b);
  if (tied.length === 1) return { index: tied[0], tied, drawn: false };
  const index = draws[tieKey(tied)];
  if (tied.includes(index)) return { index, tied, drawn: true };
  return { index: null, tied, drawn: false, pending: true };
}

// The options of `all` with the highest `value`.
function highest(all, value) {
  const top = Math.max(...all.map(value));
  return all.filter((index) => value(index) === top);
}

// What some other well-known rules would pick from the ballots of a `kind`
// poll, each as the options that come first under it, several when they
// are level. For dates:
// - flat: the fewest ✕, then the most ○, every ○ one vote: the rule
//   without mileage;
// - likes: the most ○, however many cannot come;
// - sum: the largest sum of grades, ○ 2, △ 1 and ✕ 0 (utilitarian).
// For choices:
// - plurality: the most voters putting it first;
// - borda: the most Borda points against every other option (Borda);
// - copeland: the most head-to-head wins, a draw counting half (Copeland);
// - rawls: the best lowest place, then the next lowest (leximin).
export function otherRules(kind, ballots, count) {
  if (ballots.length === 0 || count === 0) return null;
  const all = Array.from({ length: count }, (_, index) => index);
  const column = (index) => ballots.map((ballot) => ballot.grades[index]);
  const many = (index, grade) => column(index).filter((value) => value === grade).length;
  if (kind === 'date') {
    const fewest = Math.min(...all.map((index) => many(index, NO)));
    const pool = all.filter((index) => many(index, NO) === fewest);
    return {
      flat: highest(pool, (index) => many(index, YES)),
      likes: highest(all, (index) => many(index, YES)),
      sum: highest(all, (index) => column(index).reduce((sum, grade) => sum + grade, 0)),
    };
  }
  const wins = pairwise(ballots, count);
  const borda = bordaIn(all, all, wins, ballots.length);
  const sorted = all.map((index) => column(index).sort((a, b) => a - b));
  // Negative when `a` has the better lowest place, then the next lowest.
  const leximin = (a, b) => {
    for (let i = 0; i < ballots.length; i++) if (sorted[a][i] !== sorted[b][i]) return sorted[b][i] - sorted[a][i];
    return 0;
  };
  const best = [...all].sort(leximin)[0];
  return {
    plurality: highest(all, (index) => many(index, count - 1)),
    borda: highest(all, (index) => borda.get(index)),
    copeland: highest(all, (a) => all.reduce((sum, b) => {
      if (b === a || beats(wins, b, a)) return sum;
      return sum + (beats(wins, a, b) ? 1 : 0.5);
    }, 0)),
    rawls: all.filter((index) => leximin(index, best) === 0),
  };
}
