import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsOf } from '../site/poll-rules.js';
import {
  bordaIn, cycleIn, decide, mileage, mileageHalves, otherRules, pairwise, pickChoice, pickDate, scoreOf, smithSet,
  tieKey,
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

// What a pick took, and how.
const firstOf = (picked) => [picked.first, picked.by];

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
  assert.deepEqual(firstOf(pickDate(ballots, 2)), [[1], 'absent']);
});

test('among dates as many can come to, the ○ of a voter who leaves more open weighs more', () => {
  // 민수 leaves every date open and 영희 shuts two: 민수's △ costs the first
  // date more than 영희's △ costs the second.
  const minsu = [T, O, O, O];
  const younghee = [O, T, X, X];
  const ballots = dates(minsu, younghee);
  const picked = pickDate(ballots, 4);
  assert.deepEqual(firstOf(picked), [[1], 'score']);
  assert.deepEqual(picked.pool, [0, 1]);
  // Each date's tally, in the poll's order.
  assert.deepEqual(picked.tallies.map((t) => t.score), [3, 7, 7, 7]);
  assert.deepEqual(picked.tallies.map((t) => t.absent), [0, 0, 1, 1]);
  assert.deepEqual(picked.tallies[1].counts, [0, 1, 1]);
  assert.equal(scoreOf(picked.tallies[1].score, 4), 7 / 8);
});

test('a voter who gives △ to all but a favourite pushes it less than one who is open to more', () => {
  // Each date has one ○, which counted one each would leave all four level.
  const open = [O, O, O, T];
  const picky = [T, T, T, O];
  const ballots = dates(open, picky);
  assert.deepEqual(firstOf(pickDate(ballots, 4)), [[0, 1, 2], 'tie']);
  assert.deepEqual(otherRules('date', ballots, 4).flat, [0, 1, 2, 3]);
});

test('a closed poll level at the top waits for the roulette, and goes with what it drew for those very options', () => {
  const ballots = dates([O, O, X], [O, O, T]);
  assert.deepEqual(decide('date', ballots, 3), { index: null, tied: [0, 1], drawn: false, pending: true });
  assert.deepEqual(decide('date', ballots, 3, { '0,1': 1 }), { index: 1, tied: [0, 1], drawn: true });
  // A draw among other options, or of an option not level at the top, does not count.
  assert.equal(decide('date', ballots, 3, { '0,1,2': 1 }).pending, true);
  assert.equal(decide('date', ballots, 3, { '0,1': 2 }).pending, true);
  assert.deepEqual(decide('date', dates([O, T]), 2), { index: 0, tied: [0], drawn: false });
  assert.equal(decide('date', [], 2), null);
  assert.equal(tieKey([4, 0, 3]), '0,3,4');
});

test('the option that beats every other head to head wins, though Borda and leximin would take another', () => {
  // Three put A, B, C and two B, C, A: A beats both 3-2, B has more points
  // and is nobody's last.
  const ballots = orders([0, 1, 2], [0, 1, 2], [0, 1, 2], [1, 2, 0], [1, 2, 0]);
  const picked = pickChoice(ballots, 3);
  assert.deepEqual(firstOf(picked), [[0], 'condorcet']);
  assert.deepEqual(picked.tallies[0].record, { won: 2, drew: 0, lost: 0 });
  assert.deepEqual(picked.tallies.map((t) => [t.firsts, t.total]), [[3, 6], [2, 7], [0, 2]]);
  assert.deepEqual(otherRules('choice', ballots, 3), { plurality: [0], borda: [1], copeland: [0], rawls: [1] });
});

test('the Condorcet paradox leaves every option of the circle level when it is perfectly even', () => {
  const picked = pickChoice(PARADOX, 3);
  assert.deepEqual(firstOf(picked), [[0, 1, 2], 'tie']);
  assert.deepEqual(picked.smith, [0, 1, 2]);
  assert.deepEqual(picked.cycle, [0, 1, 2]);
  assert.deepEqual(picked.borda, { 0: 3, 1: 3, 2: 3 });
  // Closing leaves the three for the roulette.
  assert.deepEqual(decide('choice', PARADOX, 3), { index: null, tied: [0, 1, 2], drawn: false, pending: true });
});

test('a circle of unequal majorities is settled by Borda points', () => {
  const picked = pickChoice(UNEVEN, 3);
  assert.deepEqual(firstOf(picked), [[1], 'borda']);
  assert.deepEqual(picked.borda, { 0: 5, 1: 6, 2: 4 });
  assert.deepEqual(picked.cycle, [0, 1, 2]);
  assert.deepEqual(decide('choice', UNEVEN, 3), { index: 1, tied: [1], drawn: false });
});

test('a draw at the top with no circle is settled by Borda points against every option', () => {
  // A and B draw 2-2; both beat C, B by more.
  const ballots = orders([0, 1, 2], [0, 1, 2], [1, 2, 0], [1, 0, 2]);
  const picked = pickChoice(ballots, 3);
  assert.deepEqual(picked.smith, [0, 1]);
  assert.equal(picked.cycle, null);
  assert.deepEqual([...firstOf(picked), picked.borda], [[1], 'borda', { 0: 5, 1: 6 }]);
  // Two voters who swap the first two leave them level all the way.
  assert.deepEqual(firstOf(pickChoice(orders([0, 1, 2], [1, 0, 2]), 3)), [[0, 1], 'tie']);
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

test('an option every voter puts below another is never picked', () => {
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
    assert.ok(!pickChoice(orders(...lists), count).first.includes(1), `round ${round}`);
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
    assert.deepEqual(firstOf(pickChoice(ballots, count)), [[winner], 'condorcet'], `round ${round}`);
  }
});

test('a date answered worse than another by one voter, and better by none, is never picked', () => {
  const random = generator(5);
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(8);
    const count = 2 + random(5);
    const ballots = dates(...Array.from({ length: voters }, () => Array.from({ length: count }, () => random(3))));
    // Option 0 copied with one △ raised to ○.
    const raise = ballots.findIndex((ballot) => ballot.grades[0] === T);
    if (raise < 0) continue;
    for (const [voter, ballot] of ballots.entries()) ballot.grades.push(voter === raise ? O : ballot.grades[0]);
    assert.ok(!pickDate(ballots, count + 1).first.includes(0), `round ${round}`);
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
