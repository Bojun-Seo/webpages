import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsOf } from '../site/poll-rules.js';
import {
  bordaIn, cycleIn, decide, mileage, mileageHalves, otherRules, pairwise, rankChoices, rankDates, scoreOf, smithSet,
} from '../site/social-choice.js';

const [X, T, O] = [0, 1, 2];

// Date ballots from voters' answers, one array per voter, ✕ △ ○ as X T O.
function dates(...voters) {
  return voters.map((grades, voter) => ({ name: `v${voter}`, grades }));
}

// Choice ballots from voters' orders, best first, one array per voter.
function orders(...voters) {
  return voters.map((order, voter) => ({ name: `v${voter}`, grades: pointsOf(order) }));
}

const placesOf = (ranked) => ranked.map((t) => [t.index, t.rank, t.by]);

// Three voters whose preferences go round in a circle, the Condorcet
// paradox at its plainest: A beats B, B beats C and C beats A, two to one.
const PARADOX = orders([0, 1, 2], [1, 2, 0], [2, 0, 1]);

// Five voters in a circle whose majorities are not equal: A beats B 3-2, B
// beats C 4-1 and C beats A 3-2.
const UNEVEN = orders([0, 1, 2], [0, 1, 2], [1, 2, 0], [1, 2, 0], [2, 0, 1]);

test('mileage starts whole and loses 1/n for each ✕ and half that for each △', () => {
  assert.equal(mileage([O, O, O, O]), 1);
  assert.equal(mileage([O, T, X, O]), 1 - 1 / 4 - 1 / 8);
  assert.equal(mileage([X, X]), 0);
  assert.equal(mileage([T, T]), 0.5);
  assert.equal(mileage([]), 0);
  assert.equal(mileageHalves([O, T, X, O]), 5);
});

test('a date more can come to comes first, however much the others like another', () => {
  const ballots = dates([O, T], [O, T], [X, O]);
  assert.deepEqual(placesOf(rankDates(ballots, 2)), [[1, 1, 'absent'], [0, 2, 'last']]);
});

test('among dates as many can come to, the ○ of a voter who leaves more open weighs more', () => {
  // 민수 leaves every date open and 영희 shuts two: 민수's △ costs the first
  // date more than 영희's △ costs the second.
  const minsu = [T, O, O, O];
  const younghee = [O, T, X, X];
  const ballots = dates(minsu, younghee);
  const ranked = rankDates(ballots, 4);
  assert.deepEqual(placesOf(ranked), [[1, 1, 'score'], [0, 2, 'absent'], [2, 3, 'tie'], [3, 3, 'tie']]);
  assert.deepEqual(ranked.map((t) => t.score), [7, 3, 7, 7]);
  assert.equal(scoreOf(ranked[0].score, 4), 7 / 8);
  assert.deepEqual(ranked[0].pool, [0, 1]);
  assert.deepEqual(ranked[0].counts, [0, 1, 1]);
});

test('a voter who gives △ to all but a favourite pushes it less than one who is open to more', () => {
  // Each date has one ○, which counted one each would leave all four level.
  const open = [O, O, O, T];
  const picky = [T, T, T, O];
  const ballots = dates(open, picky);
  assert.deepEqual(placesOf(rankDates(ballots, 4)), [[0, 1, 'tie'], [1, 1, 'tie'], [2, 1, 'tie'], [3, 4, 'last']]);
  assert.deepEqual(otherRules('date', ballots, 4).flat, [0, 1, 2, 3]);
});

test('a closed date poll draws among the dates level at the top in the order fixed when it was made', () => {
  const ballots = dates([O, O, X], [O, O, T]);
  assert.deepEqual(decide('date', ballots, 3, [2, 1, 0]), { index: 1, tied: [0, 1], drawn: true });
  assert.deepEqual(decide('date', dates([O, T]), 2, [1, 0]), { index: 0, tied: [0], drawn: false });
  assert.equal(decide('date', [], 2, [1, 0]), null);
});

test('the option that beats every other head to head wins, though Borda and leximin would take another', () => {
  // Three put A, B, C and two B, C, A: A beats both 3-2, B has more points
  // and is nobody's last.
  const ballots = orders([0, 1, 2], [0, 1, 2], [0, 1, 2], [1, 2, 0], [1, 2, 0]);
  const ranked = rankChoices(ballots, 3);
  assert.deepEqual(placesOf(ranked), [[0, 1, 'condorcet'], [1, 2, 'condorcet'], [2, 3, 'last']]);
  assert.deepEqual(ranked[0].record, { won: 2, drew: 0, lost: 0 });
  assert.deepEqual([ranked[0].firsts, ranked[0].total, ranked[1].total], [3, 6, 7]);
  assert.deepEqual(otherRules('choice', ballots, 3), { plurality: [0], borda: [1], copeland: [0], rawls: [1] });
});

test('the Condorcet paradox leaves every option of the circle level when it is perfectly even', () => {
  const ranked = rankChoices(PARADOX, 3);
  assert.deepEqual(placesOf(ranked), [[0, 1, 'tie'], [1, 1, 'tie'], [2, 1, 'tie']]);
  assert.deepEqual(ranked[0].smith, [0, 1, 2]);
  assert.deepEqual(ranked[0].cycle, [0, 1, 2]);
  assert.deepEqual(ranked[0].borda, { 0: 3, 1: 3, 2: 3 });
  // Closing draws in the order fixed when the poll was made, the same way every time.
  assert.deepEqual(decide('choice', PARADOX, 3, [2, 0, 1]), { index: 2, tied: [0, 1, 2], drawn: true });
  assert.deepEqual(decide('choice', PARADOX, 3, [1, 2, 0]), { index: 1, tied: [0, 1, 2], drawn: true });
});

test('a circle of unequal majorities is settled by Borda points, and the rest by head to head', () => {
  const ranked = rankChoices(UNEVEN, 3);
  assert.deepEqual(placesOf(ranked), [[1, 1, 'borda'], [2, 2, 'condorcet'], [0, 3, 'last']]);
  assert.deepEqual(ranked[0].borda, { 0: 5, 1: 6, 2: 4 });
  assert.deepEqual(ranked[0].cycle, [0, 1, 2]);
  assert.deepEqual(decide('choice', UNEVEN, 3, [0, 2, 1]), { index: 1, tied: [1], drawn: false });
});

test('a draw at the top with no circle is settled by Borda points against every option left', () => {
  // A and B draw 2-2; both beat C, B by more.
  const ballots = orders([0, 1, 2], [0, 1, 2], [1, 2, 0], [1, 0, 2]);
  const [first] = rankChoices(ballots, 3);
  assert.deepEqual(first.smith, [0, 1]);
  assert.equal(first.cycle, null);
  assert.deepEqual([first.index, first.by, first.borda], [1, 'borda', { 0: 5, 1: 6 }]);
  // Two voters who swap the first two leave them level all the way.
  const swapped = rankChoices(orders([0, 1, 2], [1, 0, 2]), 3);
  assert.deepEqual(placesOf(swapped), [[0, 1, 'tie'], [1, 1, 'tie'], [2, 3, 'last']]);
});

// A random number from 0 to n - 1, the same run after run.
function generator(seed) {
  return (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
}

function shuffled(count, random) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = random(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

test('an option every voter puts above another is never placed below it', () => {
  const random = generator(7);
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(8);
    const count = 2 + random(5);
    const lists = Array.from({ length: voters }, () => shuffled(count, random));
    // Every voter moves option 0 up to just above option 1, if it was below.
    for (const list of lists) {
      const [a, b] = [list.indexOf(0), list.indexOf(1)];
      if (a > b) {
        list.splice(a, 1);
        list.splice(b, 0, 0);
      }
    }
    const ranked = rankChoices(orders(...lists), count);
    const rankOf = (index) => ranked.find((t) => t.index === index).rank;
    assert.ok(rankOf(0) < rankOf(1), `round ${round}`);
  }
});

test('an option that beats every other head to head always comes first', () => {
  const random = generator(11);
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(9);
    const count = 2 + random(5);
    const ballots = orders(...Array.from({ length: voters }, () => shuffled(count, random)));
    const wins = pairwise(ballots, count);
    const all = [...Array(count).keys()];
    const winner = all.find((a) => all.every((b) => a === b || wins[a][b] > wins[b][a]));
    if (winner === undefined) continue;
    const [first] = rankChoices(ballots, count);
    assert.deepEqual([first.index, first.rank, first.by], [winner, 1, 'condorcet'], `round ${round}`);
  }
});

test('a date everyone answers at least as well as another, and as many can come to, never ranks below it', () => {
  const random = generator(5);
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(8);
    const count = 2 + random(5);
    const ballots = dates(...Array.from({ length: voters }, () => Array.from({ length: count }, () => random(3))));
    // Option 0 copied with one △ raised to ○.
    const raise = ballots.findIndex((ballot) => ballot.grades[0] === T);
    if (raise < 0) continue;
    for (const [voter, ballot] of ballots.entries()) ballot.grades.push(voter === raise ? O : ballot.grades[0]);
    const ranked = rankDates(ballots, count + 1);
    const rankOf = (index) => ranked.find((t) => t.index === index).rank;
    assert.ok(rankOf(count) < rankOf(0), `round ${round}`);
  }
});

test('the top cycle holds the Condorcet winner alone, or every option caught in a circle or a draw', () => {
  assert.deepEqual(smithSet([0, 1, 2], pairwise(PARADOX, 3)), [0, 1, 2]);
  // An option every one of the circle beats stays out of it.
  const four = orders([0, 1, 2, 3], [1, 2, 0, 3], [2, 0, 1, 3]);
  assert.deepEqual(smithSet([0, 1, 2, 3], pairwise(four, 4)), [0, 1, 2]);
  assert.deepEqual(cycleIn([0, 1, 2], pairwise(four, 4)), [0, 1, 2]);
  const draw = orders([0, 1], [1, 0]);
  assert.deepEqual(smithSet([0, 1], pairwise(draw, 2)), [0, 1]);
  assert.equal(cycleIn([0, 1], pairwise(draw, 2)), null);
});

test('Borda gives a point for each option put lower and half for each put level', () => {
  const ballots = [{ grades: [2, 1] }, { grades: [2, 2] }];
  assert.deepEqual(Object.fromEntries(bordaIn([0, 1], [0, 1], pairwise(ballots, 2), 2)), { 0: 1.5, 1: 0.5 });
});

test('the other rules for dates count without mileage, ○ alone, and the sum of grades', () => {
  const ballots = dates([O, T, O], [O, T, T], [X, T, T]);
  assert.deepEqual(otherRules('date', ballots, 3), { flat: [2], likes: [0], sum: [0, 2] });
  assert.equal(otherRules('date', [], 3), null);
});
