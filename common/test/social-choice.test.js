import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, duel, geometricMean, majorityValue, otherRules, rank, tally } from '../site/social-choice.js';

// Ballots from columns of grades, one array per option, each listing every
// voter's grade in the same voter order.
function ballotsOf(...options) {
  return options[0].map((_, voter) => ({ name: `v${voter}`, grades: options.map((grades) => grades[voter]) }));
}

const CHOICE_TOP = 4;
const DATE_TOP = 2;

const ranked = (ballots, top) => rank(tally(ballots, ballots[0].grades.length, top));
const order = (ballots, top) => ranked(ballots, top).map((t) => t.index);

test('an option everyone can share beats one someone cannot, however much the rest like it', () => {
  // A pleases three and leaves two cold; B pleases everyone well enough; C
  // delights four and the fifth cannot come at all.
  const ballots = ballotsOf([4, 4, 4, 1, 1], [3, 3, 3, 3, 2], [4, 4, 4, 4, 0]);
  const result = ranked(ballots, CHOICE_TOP);
  assert.deepEqual(result.map((t) => t.index), [1, 0, 2]);
  assert.deepEqual(result.map((t) => t.rank), [1, 2, 3]);
  assert.deepEqual(result.map((t) => t.vetoes), [0, 0, 1]);
  assert.deepEqual(result.map((t) => t.product), [162n, 64n, 256n]);
});

test('the product does not let a few unhappy voters be outweighed, nor overrule a clear gain', () => {
  // A gives four the best and the fifth an average grade; B is a shade
  // better than average for all. The product prefers A, leximin alone B.
  const ballots = ballotsOf([4, 4, 4, 4, 2], [3, 3, 3, 3, 3]);
  assert.deepEqual(order(ballots, CHOICE_TOP), [0, 1]);
  assert.deepEqual(otherRules(tally(ballots, 2, CHOICE_TOP), 2).rawls, [1]);
});

test('a date is first that fewest cannot make, then that most like', () => {
  const ballots = ballotsOf([2, 2, 1], [2, 0, 2], [1, 1, 1], [2, 1, 2]);
  assert.deepEqual(order(ballots, DATE_TOP), [0, 3, 2, 1]);
  const [first, second] = ranked(ballots, DATE_TOP);
  // Level after the product and leximin, so the head-to-head decides: one
  // voter grades the first date above the fourth and one below.
  assert.equal(first.rank, 1);
  assert.equal(second.rank, 1);
  assert.deepEqual(first.level, [0, 3]);
});

test('among options level on the product and leximin, the one that wins head to head comes first', () => {
  const ballots = ballotsOf([4, 3, 1], [3, 1, 4]);
  const [first, second] = ranked(ballots, CHOICE_TOP);
  assert.equal(first.product, second.product);
  assert.deepEqual([first.index, first.rank, second.index, second.rank], [0, 1, 1, 2]);
  assert.deepEqual(first.level, [0, 1]);
  assert.deepEqual(duel(first, second), { forA: 2, forB: 1 });
});

test('an option everyone grades at least as high never ranks below', () => {
  // Random ballots, and an option that copies another with one grade
  // raised: Pareto efficiency.
  let seed = 7;
  const random = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (let round = 0; round < 300; round++) {
    const voters = 1 + random(8);
    const options = 2 + random(4);
    const columns = Array.from({ length: options }, () => Array.from({ length: voters }, () => random(5)));
    const better = [...columns[0]];
    const raise = better.findIndex((grade) => grade < 4);
    if (raise < 0) continue;
    better[raise] += 1;
    const ballots = ballotsOf(...columns, better);
    const result = ranked(ballots, CHOICE_TOP);
    const rankOf = (index) => result.find((t) => t.index === index).rank;
    assert.ok(rankOf(options) < rankOf(0), `round ${round}`);
  }
});

test('options level on everything share a rank, and closing draws between them in the order fixed at the start', () => {
  const ballots = ballotsOf([2, 1], [1, 2], [0, 2]);
  const result = ranked(ballots, DATE_TOP);
  assert.deepEqual(result.map((t) => [t.index, t.rank]), [[0, 1], [1, 1], [2, 3]]);
  assert.deepEqual(decide(ballots, 3, DATE_TOP, [2, 1, 0]), { index: 1, tied: [0, 1], drawn: true });
  assert.deepEqual(decide(ballots, 3, DATE_TOP, [0, 2, 1]), { index: 0, tied: [0, 1], drawn: true });
  // The same ballots and order give the same decision every time.
  assert.deepEqual(decide(ballots, 3, DATE_TOP, [2, 1, 0]), decide(ballots, 3, DATE_TOP, [2, 1, 0]));
});

test('closing without a tie needs no draw, and without ballots decides nothing', () => {
  const ballots = ballotsOf([2, 2], [2, 1]);
  assert.deepEqual(decide(ballots, 2, DATE_TOP, [1, 0]), { index: 0, tied: [0], drawn: false });
  assert.equal(decide([], 2, DATE_TOP, [1, 0]), null);
});

test('the product stays exact past what a double holds', () => {
  const many = 60;
  const ballots = ballotsOf(Array(many).fill(4), [...Array(many - 1).fill(4), 3]);
  const [first, second] = ranked(ballots, CHOICE_TOP);
  assert.equal(first.index, 0);
  assert.equal(first.product, 4n ** 60n);
  assert.equal(second.product, 4n ** 59n * 3n);
  assert.equal(second.rank, 2);
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

test('the other rules pick what each is known to pick', () => {
  const ballots = ballotsOf([4, 4, 4, 1, 1], [3, 3, 3, 3, 2], [4, 4, 4, 4, 0]);
  const rules = otherRules(tally(ballots, 3, CHOICE_TOP), 2);
  assert.deepEqual(rules, { approval: [1], sum: [2], rawls: [1], median: [2], condorcet: [] });

  // A Condorcet winner where there is one.
  const clear = ballotsOf([4, 4, 1], [3, 1, 4], [1, 3, 3]);
  assert.deepEqual(otherRules(tally(clear, 3, CHOICE_TOP), 2).condorcet, [0]);
  // Options level under a rule share its win.
  assert.deepEqual(otherRules(tally(ballotsOf([2, 2], [1, 3]), 2, CHOICE_TOP), 2).sum, [0, 1]);
  assert.deepEqual(otherRules([], 2).condorcet, []);
});
