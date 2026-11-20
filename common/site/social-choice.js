// How a group settles on one option from everyone's grades, and what the
// other well-known voting rules would pick, with no DOM, so that Node can
// test it and fair-pick's API can decide with it.
//
// A ballot grades every option on a scale whose index is the score, 0 for
// "cannot come" or "cannot have it". The rule places the options one place
// at a time, first place first. Of the options not yet placed it takes:
//
// 1. Those the fewest cannot make. An option someone cannot make leaves
//    them out, so the worst off come first, after Rawls.
// 2. Of those, the one that beats every other head to head, each voter
//    siding with the option they grade higher: the Condorcet winner.
// 3. When there is none, because majorities go round in a circle (A beats
//    B, B beats C and C beats A: the Condorcet paradox) or draw, the
//    option with the most Borda points among those caught in it, the top
//    cycle (Smith set). A voter gives an option a point for each other
//    option of step 1 they grade lower, and half a point for each they
//    grade the same. Borda adds up every head-to-head contest at once, so
//    what goes round in a circle cancels out (Saari); a Condorcet winner
//    else Borda's is Black's method (1958).
// 4. If still level, the largest product of the grades of those who can
//    come, the Nash social welfare, then the happier least happy voter
//    (leximin).
//
// Options level after all of that share the place. When a poll closes with
// several first, `decide` takes the one that comes first in an order drawn
// at random when the poll was made, which no one has seen.

// What the rules read of each of `count` options under `ballots`, graded
// 0 to `top`: the grades in ballot order and sorted, how many gave each
// grade, the zeros, the product of the grades above zero (a BigInt, since
// it outgrows a double), the sum, the lowest and the median grade.
export function tally(ballots, count, top) {
  return Array.from({ length: count }, (_, index) => {
    const grades = ballots.map((ballot) => ballot.grades[index]);
    const sorted = [...grades].sort((a, b) => a - b);
    const counts = Array(top + 1).fill(0);
    let product = 1n;
    let sum = 0;
    for (const grade of grades) {
      counts[grade] += 1;
      if (grade > 0) product *= BigInt(grade);
      sum += grade;
    }
    return {
      index,
      grades,
      sorted,
      counts,
      vetoes: counts[0],
      product,
      sum,
      min: sorted.length ? sorted[0] : null,
      // The lower median, as majority judgment takes it.
      median: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
    };
  });
}

// The geometric mean of the grades above zero, which orders options with
// as many zeros as their product does and reads like an average; null
// when every grade is zero.
export function geometricMean(t) {
  const above = t.grades.filter((grade) => grade > 0);
  if (above.length === 0) return null;
  return Math.exp(above.reduce((sum, grade) => sum + Math.log(grade), 0) / above.length);
}

// wins[a][b]: how many voters grade option a above option b.
export function pairwise(ballots, count) {
  const wins = Array.from({ length: count }, () => Array(count).fill(0));
  for (const { grades } of ballots) {
    for (let a = 0; a < count; a++) {
      for (let b = 0; b < count; b++) if (grades[a] > grades[b]) wins[a][b] += 1;
    }
  }
  return wins;
}

// Whether `a` beats `b` head to head: more voters grade it higher.
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
// of `voters`, a point for every other option of the pool they grade lower
// and half a point for every one they grade the same.
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

// Negative when `a` comes first, positive when `b` does, 0 when level.
function bigOrder(a, b) {
  return a > b ? -1 : a < b ? 1 : 0;
}

// Leximin: the higher lowest grade comes first, then the higher next one.
function leximinOrder(a, b) {
  for (let i = 0; i < a.sorted.length; i++) {
    if (a.sorted[i] !== b.sorted[i]) return b.sorted[i] - a.sorted[i];
  }
  return 0;
}

// Those of `group` that come first under `order`.
function bestOf(group, order) {
  const first = [...group].sort(order)[0];
  return group.filter((t) => order(t, first) === 0);
}

// The options in the rule's order, first place first: each option's tally
// with its `rank`, options level sharing one (1, 1, 3), and how its place
// was settled:
// - `by`: 'last' for the one option left, 'veto' for the only one of those
//   left that the fewest cannot make, 'condorcet' for the one of those that
//   beat every other head to head, 'borda', 'nash' or 'leximin' for what
//   settled it in their top cycle, and 'tie' when nothing did;
// - `pool`: the options left that the fewest cannot make, which it was
//   placed among; `smith`: their top cycle; `cycle`: a circle of wins in
//   it, if there is one; `borda`: the Borda points of the top cycle's
//   options, when there are several;
// - `record`: its wins, draws and losses head to head against every other
//   option.
export function rank(ballots, count, top) {
  const tallies = tally(ballots, count, top);
  const wins = pairwise(ballots, count);
  const record = (a) => {
    const out = { won: 0, drew: 0, lost: 0 };
    for (let b = 0; b < count; b++) {
      if (b === a) continue;
      if (beats(wins, a, b)) out.won += 1;
      else if (beats(wins, b, a)) out.lost += 1;
      else out.drew += 1;
    }
    return out;
  };
  const placedAll = [];
  let left = tallies.map((t) => t.index);
  while (left.length > 0) {
    const fewest = Math.min(...left.map((index) => tallies[index].vetoes));
    const pool = left.filter((index) => tallies[index].vetoes === fewest);
    const smith = smithSet(pool, wins);
    let placed = smith;
    let by;
    let borda = null;
    let cycle = null;
    if (left.length === 1) by = 'last';
    else if (pool.length === 1) by = 'veto';
    else if (smith.length === 1) by = 'condorcet';
    else {
      borda = bordaIn(smith, pool, wins, ballots.length);
      cycle = cycleIn(smith, wins);
      const most = Math.max(...borda.values());
      placed = smith.filter((index) => borda.get(index) === most);
      by = 'borda';
      for (const [next, order] of [['nash', (a, b) => bigOrder(a.product, b.product)], ['leximin', leximinOrder]]) {
        if (placed.length === 1) break;
        placed = bestOf(placed.map((index) => tallies[index]), order).map((t) => t.index);
        by = next;
      }
      if (placed.length > 1) by = 'tie';
    }
    const place = placedAll.length + 1;
    for (const index of [...placed].sort((a, b) => a - b)) {
      placedAll.push({
        ...tallies[index],
        rank: place,
        by,
        pool,
        smith,
        cycle,
        borda: borda && Object.fromEntries(borda),
        record: record(index),
      });
    }
    left = left.filter((index) => !placed.includes(index));
  }
  return placedAll;
}

// The option a closed poll goes with: { index, tied, drawn }, where `tied`
// lists the options ranked first and `drawn` says whether `tieOrder`, a
// permutation of the options drawn when the poll was made, picked among
// them. Null when nobody voted.
export function decide(ballots, count, top, tieOrder) {
  if (ballots.length === 0) return null;
  const first = rank(ballots, count, top).filter((t) => t.rank === 1).map((t) => t.index);
  if (first.length === 1) return { index: first[0], tied: first, drawn: false };
  const index = tieOrder.find((i) => first.includes(i)) ?? Math.min(...first);
  return { index, tied: [...first].sort((a, b) => a - b), drawn: true };
}

// The indexes of `tallies` that come first under `order`.
function firsts(tallies, order) {
  return bestOf(tallies, order).map((t) => t.index);
}

// The majority value of majority judgment (Balinski and Laraki 2007): the
// median grade, then the median once that grade is taken out, and so on.
export function majorityValue(sorted) {
  const rest = [...sorted];
  const values = [];
  while (rest.length) {
    const k = Math.floor((rest.length - 1) / 2);
    values.push(rest[k]);
    rest.splice(k, 1);
  }
  return values;
}

function lexicographic(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

// What the other well-known rules pick from `ballots`, each as the indexes
// that come first under it, several when they are level:
// - approval: most voters at `approveAt` or above (approval voting, Brams
//   and Fishburn), the usual way of finding a date;
// - sum: the largest sum of grades (utilitarian);
// - borda: the most Borda points against every other option (Borda);
// - nash: the fewest zeros, then the largest product of the rest (Nash);
// - rawls: the best lowest grade, then the next lowest (leximin);
// - median: the best majority value (majority judgment);
// - condorcet: the option that beats every other head to head, if there
//   is one; when there is none, `cycle` is a circle of wins at the top.
export function otherRules(ballots, count, top, approveAt) {
  if (ballots.length === 0 || count === 0) {
    return { approval: [], sum: [], borda: [], nash: [], rawls: [], median: [], condorcet: [], cycle: null };
  }
  const tallies = tally(ballots, count, top);
  const wins = pairwise(ballots, count);
  const all = tallies.map((t) => t.index);
  const borda = bordaIn(all, all, wins, ballots.length);
  const smith = smithSet(all, wins);
  const approvals = (t) => t.grades.filter((grade) => grade >= approveAt).length;
  const majority = new Map(tallies.map((t) => [t.index, majorityValue(t.sorted)]));
  return {
    approval: firsts(tallies, (a, b) => approvals(b) - approvals(a)),
    sum: firsts(tallies, (a, b) => b.sum - a.sum),
    borda: firsts(tallies, (a, b) => borda.get(b.index) - borda.get(a.index)),
    nash: firsts(tallies, (a, b) => (a.vetoes - b.vetoes) || bigOrder(a.product, b.product)),
    rawls: firsts(tallies, leximinOrder),
    median: firsts(tallies, (a, b) => lexicographic(majority.get(a.index), majority.get(b.index))),
    condorcet: smith.length === 1 ? smith : [],
    cycle: smith.length > 1 ? cycleIn(smith, wins) : null,
  };
}
