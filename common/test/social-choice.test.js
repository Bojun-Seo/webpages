import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bordaIn, cycleIn, decide, geometricMean, majorityValue, otherRules, pairwise, rank, smithSet, tally,
} from '../site/social-choice.js';

// Ballots from columns of grades, one array per option, each listing every
// voter's grade in the same voter order.
function ballotsOf(...options) {
  return options[0].map((_, voter) => ({ name: `v${voter}`, grades: options.map((grades) => grades[voter]) }));
}

// Ballots from voters' grades, one array per voter, each grading every option.
function votersOf(...voters) {
  return voters.map((grades, voter) => ({ name: `v${voter}`, grades }));
}

const CHOICE_TOP = 4;
const DATE_TOP = 2;

const ranked = (ballots, top = CHOICE_TOP) => rank(ballots, ballots[0].grades.length, top);
const order = (ballots, top) => ranked(ballots, top).map((t) => t.index);

// Three voters whose preferences go round in a circle, the Condorcet
// paradox at its plainest: A beats B, B beats C and C beats A, two to one.
const PARADOX = votersOf([4, 3, 2], [2, 4, 3], [3, 2, 4]);

// Five voters in a circle whose majorities are not equal: A beats B 3-2, B
// beats C 4-1 and C beats A 3-2.
const UNEVEN = votersOf([4, 3, 2], [4, 3, 2], [2, 4, 3], [2, 4, 3], [3, 2, 4]);

test('an option everyone can share comes before one someone cannot, even one that wins head to head', () => {
  const ballots = ballotsOf([4, 4, 4, 4, 0], [3, 3, 3, 3, 3]);
  const [first, second] = ranked(ballots);
  assert.deepEqual([first.index, first.by, second.index, second.by], [1, 'veto', 0, 'last']);
});

test('among the options everyone can share, the one that beats every other head to head wins', () => {
  // Three grade A above B and two B above A: the majority's choice, though
  // the product and leximin would take B.
  const ballots = ballotsOf([4, 4, 4, 1, 1], [3, 3, 3, 3, 3]);
  const [first, second] = ranked(ballots);
  assert.deepEqual([first.index, first.by, first.rank, second.rank], [0, 'condorcet', 1, 2]);
  assert.deepEqual(first.record, { won: 1, drew: 0, lost: 0 });
  const others = otherRules(ballots, 2, CHOICE_TOP, 2);
  assert.deepEqual([others.condorcet, others.nash, others.rawls], [[0], [1], [1]]);
});

test('the Condorcet paradox leaves every option of the circle level when it is perfectly even', () => {
  const result = ranked(PARADOX);
  assert.deepEqual(result.map((t) => [t.index, t.rank, t.by]), [[0, 1, 'tie'], [1, 1, 'tie'], [2, 1, 'tie']]);
  assert.deepEqual(result[0].smith, [0, 1, 2]);
  assert.deepEqual(result[0].cycle, [0, 1, 2]);
  assert.deepEqual(result[0].borda, { 0: 3, 1: 3, 2: 3 });
  // Closing draws in the order fixed when the poll was made, the same way every time.
  assert.deepEqual(decide(PARADOX, 3, CHOICE_TOP, [2, 0, 1]), { index: 2, tied: [0, 1, 2], drawn: true });
  assert.deepEqual(decide(PARADOX, 3, CHOICE_TOP, [1, 2, 0]), { index: 1, tied: [0, 1, 2], drawn: true });
});

test('a circle of unequal majorities is settled by Borda points, and the rest by head to head', () => {
  const result = ranked(UNEVEN);
  const [first, second, third] = result;
  assert.deepEqual([first.index, first.by], [1, 'borda']);
  assert.deepEqual(first.borda, { 0: 5, 1: 6, 2: 4 });
  assert.deepEqual(first.cycle, [0, 1, 2]);
  // With B placed, C beats A head to head.
  assert.deepEqual([second.index, second.by, third.index, third.by], [2, 'condorcet', 0, 'last']);
  assert.deepEqual(decide(UNEVEN, 3, CHOICE_TOP, [0, 2, 1]), { index: 1, tied: [1], drawn: false });
});

test('draws with no circle are settled by Borda points against every option still in the running', () => {
  // A and B draw, B and C draw, and A beats C: no one beats everyone, no circle.
  const ballots = votersOf([4, 2, 3], [3, 4, 1]);
  const [first] = ranked(ballots);
  assert.deepEqual(first.smith, [0, 1, 2]);
  assert.equal(first.cycle, null);
  assert.deepEqual([first.index, first.by], [0, 'borda']);
  assert.deepEqual(first.borda, { 0: 3, 1: 2, 2: 1 });
});

test('level on Borda points, the larger product of the grades wins, then the happier least happy voter', () => {
  // A and B draw head to head and on Borda points.
  const nash = ranked(ballotsOf([4, 1], [2, 3]));
  assert.deepEqual([nash[0].index, nash[0].by], [1, 'nash']);
  const leximin = ranked(ballotsOf([4, 1], [2, 2]));
  assert.deepEqual([leximin[0].index, leximin[0].by], [1, 'leximin']);
});

test('a date is first that fewest cannot make, then by head to head and points', () => {
  const ballots = ballotsOf([2, 2, 1], [2, 0, 2], [1, 1, 1], [2, 1, 2]);
  const result = ranked(ballots, DATE_TOP);
  // The first and the fourth date draw, beat the third, and are level on
  // points and on the product; the second leaves someone out.
  assert.deepEqual(result.map((t) => [t.index, t.rank, t.by]), [[0, 1, 'tie'], [3, 1, 'tie'], [2, 3, 'veto'], [1, 4, 'last']]);
  assert.deepEqual(result[0].pool, [0, 2, 3]);
  assert.deepEqual(result[0].smith, [0, 3]);
});

test('majority and intensity can disagree, and the rule sides with the majority once nobody is left out', () => {
  // Three grade the barbecue above the fish place, two the other way; the
  // barbecue and the Chinese place draw; the fish place beats the Chinese.
  const barbecue = [4, 4, 4, 3, 2, 1];
  const fish = [3, 3, 3, 3, 3, 3];
  const chinese = [2, 4, 3, 4, 2, 2];
  const ballots = ballotsOf(barbecue, fish, chinese);
  const result = ranked(ballots);
  assert.deepEqual(result.map((t) => [t.index, t.by]), [[0, 'borda'], [1, 'condorcet'], [2, 'last']]);
  assert.deepEqual(result[0].borda, { 0: 6.5, 1: 6, 2: 5.5 });
  assert.equal(result[0].cycle, null);
  // Nash's product would take the fish place, which nobody grades below 좋아요.
  assert.deepEqual(otherRules(ballots, 3, CHOICE_TOP, 2).nash, [1]);
});

test('an option everyone grades at least as high always ranks above', () => {
  // Random ballots, and an option that copies another with one grade
  // raised: Pareto efficiency.
  let seed = 7;
  const random = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(8);
    const options = 2 + random(4);
    const columns = Array.from({ length: options }, () => Array.from({ length: voters }, () => random(5)));
    const better = [...columns[0]];
    const raise = better.findIndex((grade) => grade < 4);
    if (raise < 0) continue;
    better[raise] += 1;
    const result = ranked(ballotsOf(...columns, better));
    const rankOf = (index) => result.find((t) => t.index === index).rank;
    assert.ok(rankOf(options) < rankOf(0), `round ${round}`);
  }
});

test('an option that beats every other it is in the running with is never placed below them', () => {
  // Condorcet consistency, on random ballots without zeros.
  let seed = 11;
  const random = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (let round = 0; round < 400; round++) {
    const voters = 1 + random(9);
    const options = 2 + random(5);
    const ballots = Array.from({ length: voters }, (_, v) => ({
      name: `v${v}`, grades: Array.from({ length: options }, () => 1 + random(4)),
    }));
    const wins = pairwise(ballots, options);
    const winner = [...Array(options).keys()].find((a) => [...Array(options).keys()].every((b) => a === b || wins[a][b] > wins[b][a]));
    if (winner === undefined) continue;
    const [first] = ranked(ballots);
    assert.deepEqual([first.index, first.rank], [winner, 1], `round ${round}`);
  }
});

test('the top cycle holds the Condorcet winner alone, or every option caught in a circle or a draw', () => {
  const wins = pairwise(PARADOX, 3);
  assert.deepEqual(smithSet([0, 1, 2], wins), [0, 1, 2]);
  // An option every one of the circle beats stays out of it.
  const four = votersOf([4, 3, 2, 1], [2, 4, 3, 1], [3, 2, 4, 1]);
  assert.deepEqual(smithSet([0, 1, 2, 3], pairwise(four, 4)), [0, 1, 2]);
  assert.deepEqual(smithSet([0, 1], pairwise(ballotsOf([4, 4, 4, 1, 1], [3, 3, 3, 3, 3]), 2)), [0]);
  assert.deepEqual(cycleIn([0, 1, 2], pairwise(four, 4)), [0, 1, 2]);
  assert.equal(cycleIn([0, 1], pairwise(ballotsOf([4, 1], [2, 3]), 2)), null);
});

test('Borda gives a point for each option graded lower and half for each graded the same', () => {
  const ballots = ballotsOf([2, 1], [2, 2]);
  const points = bordaIn([0, 1], [0, 1], pairwise(ballots, 2), 2);
  assert.deepEqual(Object.fromEntries(points), { 0: 0.5, 1: 1.5 });
});

test('the product stays exact past what a double holds', () => {
  const many = 60;
  const ballots = ballotsOf(Array(many).fill(4), [...Array(many - 1).fill(4), 3]);
  const [first, second] = ranked(ballots);
  assert.equal(first.index, 0);
  assert.equal(first.product, 4n ** 60n);
  assert.equal(second.product, 4n ** 59n * 3n);
});

test('closing without a tie needs no draw, and without ballots decides nothing', () => {
  const ballots = ballotsOf([2, 2], [2, 1]);
  assert.deepEqual(decide(ballots, 2, DATE_TOP, [1, 0]), { index: 0, tied: [0], drawn: false });
  assert.equal(decide([], 2, DATE_TOP, [1, 0]), null);
});

test('the geometric mean reads the grades above zero', () => {
  const [t] = tally(ballotsOf([4, 1, 0]), 1, CHOICE_TOP);
  assert.ok(Math.abs(geometricMean(t) - 2) < 1e-12);
  assert.equal(geometricMean(tally(ballotsOf([0, 0]), 1, CHOICE_TOP)[0]), null);
});

test('the tally counts each grade, the sum, the lowest and the lower median', () => {
  const [t] = tally(ballotsOf([3, 0, 4, 1]), 1, CHOICE_TOP);
  assert.deepEqual(t.counts, [1, 1, 0, 1, 1]);
  assert.deepEqual([t.vetoes, t.sum, t.min, t.median, t.product], [1, 8, 0, 1, 12n]);
});

test('majority judgment takes medians one after another', () => {
  assert.deepEqual(majorityValue([1, 1, 4, 4, 4]), [4, 1, 4, 1, 4]);
  assert.deepEqual(majorityValue([0, 4, 4, 4, 4]), [4, 4, 4, 0, 4]);
  assert.deepEqual(majorityValue([]), []);
});

test('the other rules pick what each is known to pick, and name the circle when there is no Condorcet winner', () => {
  const ballots = ballotsOf([4, 4, 4, 1, 1], [3, 3, 3, 3, 3], [4, 4, 4, 4, 0]);
  assert.deepEqual(otherRules(ballots, 3, CHOICE_TOP, 2), {
    approval: [1], sum: [2], borda: [2], nash: [1], rawls: [1], median: [2], condorcet: [], cycle: null,
  });
  const paradox = otherRules(UNEVEN, 3, CHOICE_TOP, 2);
  assert.deepEqual([paradox.condorcet, paradox.cycle, paradox.borda], [[], [0, 1, 2], [1]]);
  assert.deepEqual(otherRules([], 2, CHOICE_TOP, 2).condorcet, []);
});
