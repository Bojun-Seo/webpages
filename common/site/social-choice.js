// Picks the one option a group goes with from everyone's grades, and
// works out what the other well-known voting rules would pick, kept apart
// from the DOM so that Node can test it and the API can decide with it.
//
// A ballot grades every option on a scale whose index is the score, 0 for
// "cannot come" or "cannot have it". The rule, in order:
//
// 1. Fewest zeros. An option someone cannot make leaves them out, so the
//    options everyone can share come first: the worst off first, after
//    Rawls.
// 2. The largest product of the grades of those who can make it: the Nash
//    social welfare (Nash 1950; Kaneko and Nakamura 1979). A sum lets many
//    people's small gains outweigh one person's large loss; a product falls
//    sharply when anyone is unhappy, so it weighs both.
// 3. The better off its least happy voter, then the next, and so on
//    (leximin).
// 4. Among the options still level, the one that wins more head-to-head
//    contests against the others, each voter siding with the option they
//    grade higher (Copeland, after Condorcet).
//
// Options level after all four share the rank. When a poll closes with
// several first, `decide` takes the one that comes first in an order the
// API drew at random when the poll was made, which no one has seen.

// The grades every ballot gives option `index`.
function gradesOf(ballots, index) {
  return ballots.map((ballot) => ballot.grades[index]);
}

// What the rules read of each of `count` options under `ballots`, graded
// 0 to `top`: the grades in ballot order and sorted, how many gave each
// grade, the zeros, the product of the grades above zero (a BigInt, since
// it outgrows a double), the sum, the lowest and the median grade.
export function tally(ballots, count, top) {
  return Array.from({ length: count }, (_, index) => {
    const grades = gradesOf(ballots, index);
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

// Steps 1 to 3 of the rule.
export function fairOrder(a, b) {
  return (a.vetoes - b.vetoes) || bigOrder(a.product, b.product) || leximinOrder(a, b);
}

// How many voters grade `a` above `b`, and `b` above `a`.
export function duel(a, b) {
  let forA = 0;
  let forB = 0;
  a.grades.forEach((grade, i) => {
    if (grade > b.grades[i]) forA += 1;
    else if (grade < b.grades[i]) forB += 1;
  });
  return { forA, forB };
}

// Copeland scores within `group`: two for each option an option beats head
// to head, one for each it draws with.
function copeland(group) {
  const scores = new Map(group.map((t) => [t.index, 0]));
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const { forA, forB } = duel(group[i], group[j]);
      const [a, b] = forA > forB ? [2, 0] : forA < forB ? [0, 2] : [1, 1];
      scores.set(group[i].index, scores.get(group[i].index) + a);
      scores.set(group[j].index, scores.get(group[j].index) + b);
    }
  }
  return scores;
}

// `tallies` in the rule's order, each with its `rank`, 1 for the first,
// options level sharing one (1, 1, 3), and `level`, the options it is
// level with after steps 1 to 3 (itself included), which step 4 decided
// between.
export function rank(tallies) {
  const sorted = [...tallies].sort((a, b) => fairOrder(a, b) || a.index - b.index);
  const groups = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && fairOrder(last[0], t) === 0) last.push(t);
    else groups.push([t]);
  }
  const out = [];
  for (const group of groups) {
    const scores = copeland(group);
    const level = group.map((t) => t.index);
    const ordered = [...group].sort((a, b) => scores.get(b.index) - scores.get(a.index) || a.index - b.index);
    ordered.forEach((t, i) => {
      const tiedAbove = i > 0 && scores.get(ordered[i - 1].index) === scores.get(t.index);
      const rankHere = tiedAbove ? out[out.length - 1].rank : out.length + 1;
      out.push({ ...t, rank: rankHere, level, copeland: group.length > 1 ? scores.get(t.index) : null });
    });
  }
  return out;
}

// The option a closed poll goes with: { index, tied, drawn }, where `tied`
// lists the options ranked first and `drawn` says whether `tieOrder`, a
// permutation of the options drawn when the poll was made, picked among
// them. Null when nobody voted.
export function decide(ballots, count, top, tieOrder) {
  if (ballots.length === 0) return null;
  const first = rank(tally(ballots, count, top)).filter((t) => t.rank === 1).map((t) => t.index);
  if (first.length === 1) return { index: first[0], tied: first, drawn: false };
  const index = tieOrder.find((i) => first.includes(i)) ?? Math.min(...first);
  return { index, tied: [...first].sort((a, b) => a - b), drawn: true };
}

// The indexes of `tallies` that come first under `order`.
function firsts(tallies, order) {
  let best = [];
  for (const t of tallies) {
    const c = best.length ? order(t, best[0]) : -1;
    if (c < 0) best = [t];
    else if (c === 0) best.push(t);
  }
  return best.map((t) => t.index);
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

// What the other well-known rules pick from `tallies`, each as the indexes
// that come first under it, several when they are level:
// - approval: most voters at `approveAt` or above (approval voting, Brams
//   and Fishburn), the usual way of finding a date;
// - sum: the largest sum of grades (utilitarian, the Borda-like count);
// - rawls: the best lowest grade, then the next lowest (leximin);
// - median: the best majority value (majority judgment);
// - condorcet: the option that beats every other head to head, if there
//   is one; none when they beat each other in a cycle.
export function otherRules(tallies, approveAt) {
  if (tallies.length === 0 || tallies[0].grades.length === 0) {
    return { approval: [], sum: [], rawls: [], median: [], condorcet: [] };
  }
  const approvals = (t) => t.grades.filter((grade) => grade >= approveAt).length;
  const majority = new Map(tallies.map((t) => [t.index, majorityValue(t.sorted)]));
  const condorcet = tallies.filter((t) => tallies.every((u) => {
    if (u === t) return true;
    const { forA, forB } = duel(t, u);
    return forA > forB;
  }));
  return {
    approval: firsts(tallies, (a, b) => approvals(b) - approvals(a)),
    sum: firsts(tallies, (a, b) => b.sum - a.sum),
    rawls: firsts(tallies, leximinOrder),
    median: firsts(tallies, (a, b) => lexicographic(majority.get(a.index), majority.get(b.index))),
    condorcet: condorcet.map((t) => t.index),
  };
}
