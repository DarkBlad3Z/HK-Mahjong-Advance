#!/usr/bin/env node
/* HK Mahjong — tests/engine.test.js  (Owner: back end)
 * Scenario tests for src/core/engine.js (SPEC §7.3), built with presetWalls / Game.buildWall.
 *   node tests/engine.test.js            -> run all, exit 1 on any failure
 *   node tests/engine.test.js --verbose  -> list every test
 * Dealer is player 0 unless stated.  Draw order with dealer 0 and no claims: draws[0] -> P1, [1] -> P2, [2] -> P3,
 * [3] -> P0, [4] -> P1 ...  Replacement tiles are taken from the back in the order given.
 */
'use strict';
var path = require('path'), fs = require('fs');
var CORE = path.join(__dirname, '..', 'src', 'core');
var STUBBED = [];
/** Real module if present; the temporary stand-ins in tests/_stubs are used only with --allow-stubs. */
function load(name) {
  var real = path.join(CORE, name + '.js');
  if (fs.existsSync(real)) { require(real); return; }
  if (process.argv.indexOf('--allow-stubs') < 0) {
    console.log('FAIL: src/core/' + name + '.js is missing (run with --allow-stubs to use tests/_stubs)');
    process.exit(1);
  }
  require(path.join(__dirname, '_stubs', name + '.js'));
  STUBBED.push(name);
}
require(path.join(CORE, 'tiles.js'));
require(path.join(CORE, 'rng.js'));
load('hand');
load('scoring');
require(path.join(CORE, 'engine.js'));
load('ai');
var HKMJ = globalThis.HKMJ, T = HKMJ.Tiles, Game = HKMJ.Game;
var VERBOSE = process.argv.indexOf('--verbose') >= 0;
if (STUBBED.length) console.log('NOTE: using test stand-ins (tests/_stubs) for: ' + STUBBED.join(', '));

// ------------------------------------------------------------------------------------------------ harness
var TESTS = [], checks = 0;
function test(name, fn) { TESTS.push({ name: name, fn: fn }); }
function fail(msg) { throw new Error(msg); }
function ok(c, msg) { checks++; if (!c) fail(msg || 'assertion failed'); }
function eq(a, b, msg) {
  checks++;
  var x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) fail((msg ? msg + ': ' : '') + 'got ' + x + ', want ' + y);
}

// ------------------------------------------------------------------------------------------------ helpers
function K(s) { var a = T.parse(s); if (a.length !== 1) fail('K(' + s + ')'); return a[0]; }
function Ks(s) { return T.sort(T.parse(s)); }
function nulls(n) { var a = []; for (var i = 0; i < n; i++) a.push(null); return a; }
function wall(spec, seed) { return Game.buildWall(spec, HKMJ.RNG(seed || 99)); }
function newGame(walls, opts) {
  opts = opts || {};
  var g = new Game({ seed: opts.seed || 1, firstDealer: opts.firstDealer === undefined ? 0 : opts.firstDealer,
    presetWalls: walls, humans: opts.humans || [], settings: opts.settings, names: opts.names });
  if (opts.onEvent) g.on(opts.onEvent);
  var r = g.start();
  if (!r.ok) fail('start: ' + r.error);
  return g;
}
function act(g, p, a) {
  var r = g.act(p, a);
  if (!r || !r.ok) fail('act(' + p + ', ' + JSON.stringify(a) + ') failed: ' + (r && r.error));
  return r;
}
function rej(g, p, a, re) {
  var before = g.serialize();
  var r = g.act(p, a);
  ok(r && r.ok === false, 'expected ' + JSON.stringify(a) + ' by ' + p + ' to be rejected');
  ok(typeof r.error === 'string' && r.error.length > 0, 'rejection carries an error text');
  if (re) ok(re.test(r.error), 'error "' + r.error + '" should match ' + re);
  ok(g.serialize() === before, 'state unchanged after a rejected action');
  return r.error;
}
function discard(g, p, s) { act(g, p, { type: 'discard', tile: typeof s === 'number' ? s : K(s) }); }
function types(g, p) { return g.getActions(p).map(function (a) { return a.type; }); }
function find(g, p, type) { return g.getActions(p).filter(function (a) { return a.type === type; })[0]; }
function pend(g) { return g.getPending(); }
function view(g, p) { return g.getView(p); }
function hand(g, p) { return g.getView(p).players[p].hand; }
/** Counted items of an evaluation as {id: fan}, keys sorted (so eq() ignores item order). */
function items(ev) {
  var m = {}, out = {};
  ev.items.forEach(function (it) { m[it.id] = (m[it.id] || 0) + it.fan; });
  Object.keys(m).sort().forEach(function (k) { out[k] = m[k]; });
  return out;
}
function I(o) { var out = {}; Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; }); return out; }
function passAll(g) {
  var pd = g.getPending();
  while (pd && (pd.type === 'claim' || pd.type === 'robKong')) {
    pd.waiting.forEach(function (q) { act(g, q, { type: 'pass' }); });
    pd = g.getPending();
  }
}
/** One neutral step: pass every claim, or discard the tile just drawn (keeps every hand unchanged). */
function tsumogiri(g) {
  var pd = g.getPending();
  if (pd.type === 'claim' || pd.type === 'robKong') { passAll(g); return; }
  if (pd.type !== 'turn') fail('tsumogiri at ' + pd.type);
  var v = g.getView(pd.player), me = v.players[pd.player];
  var t = me.drawn !== null ? me.drawn : v.actions.filter(function (a) { return a.type === 'discard'; })[0].tile;
  act(g, pd.player, { type: 'discard', tile: t });
}
function driveUntil(g, stop, max) {
  for (var i = 0; i < (max || 2000); i++) { if (stop(g)) return; tsumogiri(g); }
  fail('driveUntil: condition never reached');
}
function lastTurnIs(p) { return function (g) { var pd = g.getPending(); return pd.type === 'turn' && pd.player === p && g.getView(p).wallCount === 0; }; }
function handOver(g) { var t = g.getPending().type; return t === 'handEnd' || t === 'gameEnd'; }
function tileCount(g) {
  var s = g.s, n = s.wall.length;
  s.players.forEach(function (P) { n += P.hand.length + P.flowers.length + P.discards.length; P.melds.forEach(function (m) { n += m.tiles.length; }); });
  return n;
}

// ================================================================================================ deal & bonus tiles
test('deal order (p.11): 4-4-4 round the table from the dealer, 1 each, then the dealer\'s 14th', function () {
  var first = [], i;
  for (i = 0; i < 53; i++) first.push(i % 34);
  var rest = T.fullSet();
  first.forEach(function (k) { rest.splice(rest.indexOf(k), 1); });
  var w = first.concat(rest.filter(function (k) { return !T.isBonus(k); }), rest.filter(T.isBonus));
  var g = newGame([w], { firstDealer: 1 });
  eq(hand(g, 1), [0, 0, 1, 1, 2, 3, 14, 16, 17, 18, 18, 19, 32, 33], 'dealer (player 1): positions 0-3,16-19,32-35,48,52');
  eq(hand(g, 2), [2, 3, 4, 4, 5, 5, 6, 7, 15, 20, 21, 22, 23], 'player 2: 4-7, 20-23, 36-39, 49');
  eq(hand(g, 3), [6, 7, 8, 8, 9, 9, 10, 11, 16, 24, 25, 26, 27], 'player 3: 8-11, 24-27, 40-43, 50');
  eq(hand(g, 0), [10, 11, 12, 12, 13, 13, 14, 15, 17, 28, 29, 30, 31], 'player 0: 12-15, 28-31, 44-47, 51');
  eq(view(g, 1).players[1].drawn, 18, 'the dealer\'s 14th tile (position 52) shows as the drawn tile');
  eq(view(g, 1).wallCount, 91);
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false });
  eq(view(g, 0).players.map(function (p) { return p.seatWind; }), [3, 0, 1, 2], 'seat wind = (p - dealer) mod 4');
  discard(g, 1, 18);
  passAll(g);
  eq(pend(g).player, 2, 'play passes to the dealer\'s right');
  eq(view(g, 2).players[2].drawn, w[53], 'the first live draw is the tile after the deal');
});

test('bonus tiles: dealer first, replaced from the back until none remain; bonus drawn in play replaced at once', function () {
  var ev = [];
  var w = wall({ hands: ['1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 4p 梅', '1s 2s 3s 4s 5s 6s 7s 8s 9s 東 南 西 蘭'],
    draws: ['竹'], replacements: ['菊', '5p', '6p', '7p'] });
  var g = newGame([w], { onEvent: function (e) { ev.push(e); } });
  eq(view(g, 0).players[0].flowers, [K('梅'), K('菊')], 'dealer replaced 梅, drew 菊, replaced again');
  eq(view(g, 1).players[1].flowers, [K('蘭')]);
  eq(hand(g, 0), Ks('123456789m 12345p'));
  eq(hand(g, 1), Ks('123456789s 東南西 6p'), 'player 1 replaces after the dealer');
  eq(view(g, 0).players[0].drawn, K('5p'));
  eq(view(g, 0).wallCount, 144 - 53 - 3);
  eq(ev.filter(function (e) { return e.type === 'bonus'; }).map(function (e) { return [e.player, e.tile]; }),
    [[0, K('梅')], [0, K('菊')], [1, K('蘭')]]);
  eq(ev[0].type, 'handStart');
  discard(g, 0, '9m');
  passAll(g);
  eq(view(g, 1).players[1].flowers, [K('蘭'), K('竹')], '竹 drawn in play is exposed');
  eq(view(g, 1).players[1].drawn, K('7p'), 'and replaced from the back');
  var draws = ev.filter(function (e) { return e.type === 'draw'; }).slice(-2);
  eq(draws, [{ type: 'draw', player: 1, replacement: false }, { type: 'draw', player: 1, replacement: true }]);
  ok(ev.every(function (e) { return e.type !== 'draw' || !('tile' in e); }), 'draw events never carry the tile');
});

// ================================================================================================ claims
var CHOW = { hands: [
  '3m 1p 4p 7p 2p 5p 8p 3s 6s 9s 東 南 西 北',
  '1m 2m 4m 5m 1s 4s 7s 2s 5s 8s 中 發 白',
  '1m 2m 3p 6p 9p 1s 7s 9m 8m 東 南 中 發',
  '4m 5m 3s 6s 9s 1p 4p 7p 2p 5p 8p 白 西'], draws: ['9s', '3p'] };

test('chow only from the left; every sequence is its own option; after a chow only discards', function () {
  var g = newGame([wall(CHOW)]);
  discard(g, 0, '3m');
  eq(pend(g), { type: 'claim', tile: K('3m'), from: 0, waiting: [1] });
  eq(g.getActions(1).map(function (a) { return a.type === 'chow' ? a.tiles : a.type; }), [Ks('123m'), Ks('234m'), Ks('345m'), 'pass']);
  eq(g.getActions(2), [], 'player 2 holds 1m 2m but is not on the discarder\'s right');
  eq(g.getActions(3), [], 'player 3 holds 4m 5m but is not on the discarder\'s right');
  rej(g, 3, { type: 'chow', tiles: Ks('345m') }, /no claim/);
  rej(g, 1, { type: 'chow', tiles: Ks('456m') }, /not possible/);
  rej(g, 1, { type: 'pong' }, /Pong needs two/);
  rej(g, 0, { type: 'pass' }, /own tile/);
  var v2 = view(g, 2);
  eq(v2.pending, { type: 'claim', tile: K('3m'), from: 0, waiting: [] }, 'others do not see who may claim');
  eq(v2.claimTile, { tile: K('3m'), from: 0, kind: 'discard' });
  eq(v2.turn, 0);
  act(g, 1, { type: 'chow', tiles: [K('4m'), K('2m'), K('3m')] });                 // any order is accepted
  eq(pend(g), { type: 'turn', player: 1, afterClaim: true });
  ok(types(g, 1).every(function (t) { return t === 'discard'; }), 'only discards after a chow');
  var v1 = view(g, 1);
  eq(v1.players[1].melds, [{ type: 'chow', tiles: Ks('234m'), concealed: false, from: 0, claimed: K('3m'), added: false }]);
  eq(v1.players[0].discards, [], 'the claimed tile left the river');
  eq(v1.players[1].lastAction, 'chow');
  eq(v1.players[1].handCount, 11);
  eq(v1.players[1].drawn, null);
  ok(/Julie chows 3 Characters 三萬 — 2-3-4 Characters 二三四萬/.test(v1.log.join('\n')), 'chow log line');
  discard(g, 1, '中');
  eq(pend(g).player, 2, 'nobody claims 中; player 2 draws');
  discard(g, 2, '9s');
  discard(g, 3, '3p');
  eq(pend(g).waiting, [0], 'player 0 may chow player 3\'s discard (wrap-around)');
  eq(g.getActions(0).filter(function (a) { return a.type === 'chow'; }).map(function (a) { return a.tiles; }), [Ks('123p'), Ks('234p'), Ks('345p')]);
});

var PRIO = { hands: [
  '1m 1m 1m 2m 3m 4m 5m 6m 7m 中 中 中 9m 北',
  '1p 2p 4p 5p 7p 8p 1s 2s 4s 5s 7s 8s 西',
  '7m 8m 3p 6p 9p 3s 6s 9s 東 南 發 白 西',
  '9m 9m 1p 3p 5p 2s 4s 6s 8s 東 南 發 白'], draws: ['9m'] };
function prioGame(opts) {
  var g = newGame([wall(PRIO)], opts);
  discard(g, 0, '北');
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false });
  discard(g, 1, '9m');
  return g;
}

test('claim priority: win > pong > chow, whatever order the answers arrive in', function () {
  var g = prioGame();
  eq(pend(g), { type: 'claim', tile: K('9m'), from: 1, waiting: [2, 3, 0] });
  eq(types(g, 2), ['chow', 'pass']);
  eq(types(g, 3), ['pong', 'pass']);
  eq(types(g, 0), ['win', 'pass']);
  var w = find(g, 0, 'win');
  eq(w.fan, 6); eq(w.evaluation.fan, 6); ok(w.evaluation.valid, 'win option carries a valid evaluation');
  eq(items(w.evaluation), I({ concealed: 1, mixedFlush: 3, dragon: 1, noFlowers: 1 }));
  act(g, 2, { type: 'chow', tiles: Ks('789m') });
  eq(pend(g).waiting, [3, 0], 'waiting shrinks as players answer');
  rej(g, 2, { type: 'pass' }, /already answered/);
  act(g, 3, { type: 'pong' });
  eq(pend(g).type, 'claim', 'still waiting for player 0');
  act(g, 0, { type: 'win' });
  var r = pend(g).result;
  eq([r.type, r.winner, r.source, r.payer, r.winTile, r.fan], ['win', 0, 'discard', 1, K('9m'), 6]);
  eq(r.payments, [64, -64, 0, 0], 'discarder pays 2 x 32');
  eq(r.scoresAfter, [64, -64, 0, 0]);
  eq([r.dealerStays, r.nextDealer, r.nextRound, r.gameOver], [true, 0, 0, false]);
  eq(r.hands[0].hand.length, 14);
  eq(view(g, 0).players[1].discards, [], 'the winning discard left the river');
  eq(view(g, 0).players[0].lastAction, 'win');
  g = prioGame();
  act(g, 0, { type: 'win' }); act(g, 3, { type: 'pong' }); act(g, 2, { type: 'chow', tiles: Ks('789m') });
  eq(pend(g).result.winner, 0, 'same result when the win answer comes first');
  g = prioGame();
  act(g, 2, { type: 'chow', tiles: Ks('789m') }); act(g, 3, { type: 'pong' }); act(g, 0, { type: 'pass' });
  eq(pend(g), { type: 'turn', player: 3, afterClaim: true }, 'pong beats the earlier chow; play jumps to the ponger');
  eq(view(g, 3).players[3].melds, [{ type: 'pong', tiles: Ks('999m'), concealed: false, from: 1, claimed: K('9m'), added: false }]);
  eq(view(g, 2).players[2].melds, []);
  g = prioGame();
  act(g, 0, { type: 'pass' }); act(g, 3, { type: 'pass' }); act(g, 2, { type: 'chow', tiles: Ks('789m') });
  eq(pend(g), { type: 'turn', player: 2, afterClaim: true }, 'chow when nobody claims higher');
  g = prioGame();
  passAll(g);
  eq(pend(g), { type: 'turn', player: 2, afterClaim: false }, 'all pass: the next player draws');
  eq(view(g, 1).players[1].discards, [K('9m')]);
});

var BUMP = { hands: [
  '1m 1m 1m 2m 3m 4m 5m 6m 7m 中 中 中 9m 北',
  '2p 4p 6p 8p 1s 5s 9s 東 南 西 白 白 中',
  '7m 8m 1p 2p 3p 4p 5p 6p 7p 8p 9p 發 發',
  '9m 9m 1s 3s 5s 7s 9s 2s 4s 6s 東 南 西'], draws: ['9m'] };

test('head bump: several wins on one discard — the first claimant in turn order after the discarder wins', function () {
  var g = newGame([wall(BUMP)]);
  discard(g, 0, '北'); discard(g, 1, '9m');
  eq(pend(g).waiting, [2, 3, 0]);
  eq(types(g, 2), ['win', 'chow', 'pass']);
  eq(find(g, 2, 'win').fan, 3);
  eq(items(find(g, 2, 'win').evaluation), I({ concealed: 1, allSequences: 1, noFlowers: 1 }));
  act(g, 0, { type: 'win' }); act(g, 3, { type: 'pong' }); act(g, 2, { type: 'win' });
  var r = pend(g).result;
  eq([r.winner, r.payer, r.bumped], [2, 1, [0]]);
  eq(r.payments, [0, -16, 16, 0]);
  eq([r.dealerStays, r.nextDealer], [false, 1], 'a non-dealer win passes the deal to the dealer\'s right');
  ok(view(g, 0).log.indexOf('Head bump 截糊: Bel is first in turn order after Julie, ahead of you') >= 0, 'head bump log line');
  g = newGame([wall(BUMP)]);
  discard(g, 0, '北'); discard(g, 1, '9m');
  act(g, 2, { type: 'pass' }); act(g, 3, { type: 'pass' }); act(g, 0, { type: 'win' });
  eq(pend(g).result.winner, 0, 'if the first claimant passes, the next winner in order takes it');
});

// ================================================================================================ kongs
var ROB = { hands: [
  '1m 2m 5m 6m 9m 1s 2s 5s 6s 9s 東 南 北 5p',
  '5p 5p 1p 2p 3p 7p 8p 9p 3s 4s 7s 8s 白',
  '4p 6p 1m 2m 3m 4m 5m 6m 7m 8m 9m 中 白',
  '3m 7m 1s 3s 5s 7s 9s 2p 西 發 北 南 東'], draws: ['中', '8m', '3m', '5p'], replacements: ['2s'] };
function robGame(opts) {
  var g = newGame([wall(ROB)], opts);
  discard(g, 0, '5p');
  eq(pend(g).waiting, [1]);
  act(g, 1, { type: 'pong' });
  discard(g, 1, '白'); discard(g, 2, '白'); discard(g, 3, '8m'); discard(g, 0, '3m');
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false });
  ok(g.getActions(1).some(function (a) { return a.type === 'addKong' && a.tile === K('5p'); }), 'addKong offered');
  act(g, 1, { type: 'addKong', tile: K('5p') });
  return g;
}

test('robbing the kong: an added kong can be robbed; the kong maker pays; the pong stays a pong', function () {
  var ev = [];
  var g = robGame({ onEvent: function (e) { ev.push(e); } });
  eq(pend(g), { type: 'robKong', tile: K('5p'), from: 1, waiting: [2] });
  eq(types(g, 2), ['win', 'pass']);
  var v = view(g, 2);
  eq([v.phase, v.turn], ['robKong', 1]);
  eq(v.claimTile, { tile: K('5p'), from: 1, kind: 'robKong' });
  var w = find(g, 2, 'win');
  eq(w.fan, 4);
  eq(items(w.evaluation), I({ concealed: 1, robKong: 1, allSequences: 1, noFlowers: 1 }));
  rej(g, 2, { type: 'pong' }, /Robbing the Kong/);
  act(g, 2, { type: 'win' });
  var r = pend(g).result;
  eq([r.source, r.winner, r.payer, r.winTile], ['robKong', 2, 1, K('5p')]);
  eq(r.payments, [0, -32, 32, 0], 'the kong maker pays as the discarder');
  eq(r.hands[1].melds[0].type, 'pong', 'the robbed kong never happened');
  eq(r.hands[1].melds[0].tiles, Ks('555p'));
  ok(r.hands[1].hand.indexOf(K('5p')) < 0);
  eq(r.hands[1].hand.length + 3 * r.hands[1].melds.length, 13);
  eq(r.hands[2].hand.length, 14);
  ok(ev.some(function (e) { return e.type === 'robKong' && e.player === 2 && e.from === 1 && e.tile === K('5p'); }), 'robKong event');
  ok(!ev.some(function (e) { return e.type === 'addKong'; }), 'no addKong event for a robbed kong');
  g = robGame();
  act(g, 2, { type: 'pass' });
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false }, 'not robbed: the kong completes');
  eq(view(g, 1).players[1].melds[0], { type: 'kong', tiles: Ks('5555p'), concealed: false, from: 0, claimed: K('5p'), added: true });
  eq(view(g, 1).players[1].drawn, K('2s'), 'replacement from the back');
  eq(view(g, 1).players[1].lastAction, 'addKong');
});

test('concealed kongs and kongs claimed from a discard cannot be robbed', function () {
  var g = newGame([wall({ hands: ['5s 5s 5s 5s 1m 9m 1p 9p 東 南 西 北 中 發', '4s 6s 1m 2m 3m 4m 5m 6m 7m 8m 9m 中 中'], replacements: ['2p'] })]);
  eq(types(g, 0).filter(function (t) { return t !== 'discard'; }), ['concealedKong']);
  act(g, 0, { type: 'concealedKong', tile: K('5s') });
  eq(pend(g), { type: 'turn', player: 0, afterClaim: false }, 'player 1 waits on 5s but may not rob a concealed kong');
  eq(view(g, 0).players[0].melds, [{ type: 'kong', tiles: Ks('5555s'), concealed: true, from: null, claimed: null, added: false }]);
  eq(view(g, 0).players[0].drawn, K('2p'));
  eq(view(g, 1).players[0].melds[0].tiles, Ks('5555s'), 'a concealed kong\'s kind is public');
  var CLK = { hands: [
    '1m 9m 1s 9s 東 南 西 北 中 發 白 5p 5p 2s',
    '2s 2s 2s 1m 2m 3m 4m 5m 6m 7m 8m 中 中',
    '3s 4s 6s 7s 8s 1p 3p 5p 7p 9p 南 西 北',
    '1s 3s 1p 2p 3p 4p 5p 6p 7p 8p 9p 東 東'], replacements: ['9m'] };
  g = newGame([wall(CLK)]);
  discard(g, 0, '2s');
  eq(pend(g).waiting, [1, 3]);
  eq(types(g, 1), ['kong', 'pong', 'pass']);
  eq(types(g, 3), ['win', 'pass']);
  eq(find(g, 3, 'win').evaluation.items.filter(function (i) { return i.id === 'earth'; }).length, 1, 'Earth on the dealer\'s first discard');
  act(g, 3, { type: 'pass' });
  act(g, 1, { type: 'kong' });
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false }, 'claimed kong: no robbing phase; the claimer draws and continues');
  eq(view(g, 1).players[1].melds[0], { type: 'kong', tiles: Ks('2222s'), concealed: false, from: 0, claimed: K('2s'), added: false });
  eq(view(g, 1).players[1].drawn, K('9m'));
  var sw = find(g, 1, 'selfWin');
  ok(sw, 'win on the replacement after a claimed kong');
  eq(items(sw.evaluation), I({ kongReplacement: 2, noFlowers: 1 }));
  act(g, 1, { type: 'selfWin' });
  eq(pend(g).result.flags, { kongReplacement: 1, lastTile: false, blessing: null });
});

test('win on a kong replacement (槓上開花) and on a second kong\'s replacement (槓上槓); no Heaven after a kong', function () {
  var g = newGame([wall({ hands: ['7p 7p 7p 7p 1m 2m 3m 4m 5m 6m 中 中 中 9s'], replacements: ['9s'] })]);
  ok(!find(g, 0, 'selfWin'));
  act(g, 0, { type: 'concealedKong', tile: K('7p') });
  eq(view(g, 0).players[0].drawn, K('9s'));
  var sw = find(g, 0, 'selfWin');
  eq(items(sw.evaluation), I({ kongReplacement: 2, concealed: 1, dragon: 1, noFlowers: 1 }));
  act(g, 0, { type: 'selfWin' });
  var r = pend(g).result;
  eq([r.source, r.fan, r.flags], ['self', 5, { kongReplacement: 1, lastTile: false, blessing: null }]);
  eq(r.payments, [72, -24, -24, -24], 'self-pick: all three pay 24');
  g = newGame([wall({ hands: ['7p 7p 7p 7p 8s 8s 8s 1m 2m 3m 中 中 中 9s'], replacements: ['8s', '9s'] })]);
  act(g, 0, { type: 'concealedKong', tile: K('7p') });
  ok(!find(g, 0, 'selfWin'));
  eq(find(g, 0, 'concealedKong').tile, K('8s'), 'the replacement makes a second kong');
  act(g, 0, { type: 'concealedKong', tile: K('8s') });
  sw = find(g, 0, 'selfWin');
  eq(items(sw.evaluation), I({ doubleKong: 9, concealed: 1, dragon: 1, noFlowers: 1 }));
  act(g, 0, { type: 'selfWin' });
  eq(pend(g).result.flags.kongReplacement, 2);
  eq(pend(g).result.fan, 12);
});

test('kong chains: claimed kong then concealed kong = double kong; a flower drawn as a kong replacement still counts', function () {
  var g = newGame([wall({ hands: ['1m 9m 1s 9s 東 南 西 北 中 發 白 5p 5p 2s', '2s 2s 2s 8p 8p 8p 1m 2m 3m 中 中 7m 8m'], replacements: ['8p', '9m'] })]);
  discard(g, 0, '2s');
  act(g, 1, { type: 'kong' });
  eq(view(g, 1).players[1].drawn, K('8p'));
  act(g, 1, { type: 'concealedKong', tile: K('8p') });
  var sw = find(g, 1, 'selfWin');
  eq(items(sw.evaluation), I({ doubleKong: 9, noFlowers: 1 }), 'claimed kong + concealed kong, win on the 2nd replacement');
  act(g, 1, { type: 'selfWin' });
  eq(pend(g).result.flags.kongReplacement, 2);
  g = newGame([wall({ hands: ['7p 7p 7p 7p 1m 2m 3m 4m 5m 6m 中 中 中 9s'], replacements: ['梅', '9s'] })]);
  act(g, 0, { type: 'concealedKong', tile: K('7p') });
  eq(view(g, 0).players[0].flowers, [K('梅')]);
  eq(view(g, 0).players[0].drawn, K('9s'));
  sw = find(g, 0, 'selfWin');
  eq(items(sw.evaluation), I({ kongReplacement: 2, concealed: 1, dragon: 1, seatFlower: 1 }));
});

test('a kong whose replacement is the last wall tile: kongReplacement and lastTile both set', function () {
  // 8 bonus tiles dealt -> 8 back tiles used; the 82nd live draw (player 2) is the 4th 7p, the wall's last tile is 9s
  var spec = { hands: [
    '蘭 夏 1p 2p 4p 5p 8p 9p 1s 2s 4s 5s 7s 8s',
    '1m 2m 5m 6m 9m 3p 9p 3s 6s 9s 南 梅 春',
    '7p 7p 7p 1m 2m 3m 4m 5m 6m 中 中 竹 冬',
    '3m 7m 8m 1p 6p 3s 6s 東 南 西 白 菊 秋'],
    replacements: ['3p', '6p', '北', '發', '中', '9s', '8m', '2p'], draws: nulls(81).concat(['7p', '9s']) };
  var g = newGame([wall(spec)]);
  driveUntil(g, function (x) { var pd = x.getPending(); return pd.type === 'turn' && pd.player === 2 && x.getView(2).wallCount === 1; });
  eq(view(g, 2).players[2].drawn, K('7p'));
  act(g, 2, { type: 'concealedKong', tile: K('7p') });
  eq(view(g, 2).wallCount, 0);
  var sw = find(g, 2, 'selfWin');
  ok(sw, 'win on the replacement, which was the last tile');
  ok(items(sw.evaluation).kongReplacement === 2, 'kong replacement scored');
  act(g, 2, { type: 'selfWin' });
  eq(pend(g).result.flags, { kongReplacement: 1, lastTile: true, blessing: null });
});

test('robbing the kong with two robbers: head bump in turn order after the kong maker', function () {
  var spec = { hands: ROB.hands.slice(), draws: ROB.draws, replacements: ROB.replacements };
  spec.hands[3] = '3p 4p 1s 2s 3s 7s 8s 9s 西 西 西 發 發';
  var g = newGame([wall(spec)]);
  discard(g, 0, '5p');
  eq(pend(g).waiting, [1, 3], 'player 3 could win by Earth; player 1 could pong');
  act(g, 3, { type: 'pass' }); act(g, 1, { type: 'pong' });
  discard(g, 1, '白'); discard(g, 2, '白'); discard(g, 3, '8m'); discard(g, 0, '3m');
  act(g, 1, { type: 'addKong', tile: K('5p') });
  eq(pend(g), { type: 'robKong', tile: K('5p'), from: 1, waiting: [2, 3] });
  act(g, 3, { type: 'win' }); act(g, 2, { type: 'win' });
  var r = pend(g).result;
  eq([r.winner, r.source, r.payer, r.bumped], [2, 'robKong', 1, [3]]);
});

test('payment styles through the engine: shared (older tables) and chips', function () {
  var g = prioGame({ settings: { payment: 'shared', unit: 'chips' } });
  act(g, 0, { type: 'win' }); act(g, 2, { type: 'pass' }); act(g, 3, { type: 'pass' });
  eq(pend(g).result.payments, [12, -6, -3, -3], '6 Fan = 6 chips: discarder 6, the others 3 each');
  g = prioGame({ settings: { payment: 'shared' } });
  act(g, 0, { type: 'win' }); act(g, 2, { type: 'pass' }); act(g, 3, { type: 'pass' });
  eq(pend(g).result.payments, [64, -32, -16, -16]);
});

// ================================================================================================ end of the wall
// All eight bonus tiles are dealt, so exactly 8 replacements come off the back and 83 live draws remain:
// with dealer 0 and no claims the 83rd (last) draw is player 3's.
var MOON1 = { hands: [
  '蘭 夏 1p 2p 4p 5p 7p 8p 1s 2s 4s 5s 7s 8s',
  '1m 2m 5m 6m 9m 3p 9p 3s 6s 9s 南 梅 春',
  '3m 7m 8m 1p 6p 9p 3s 6s 9s 東 南 竹 冬',
  '1m 2m 3m 4m 5m 6m 中 中 中 西 西 菊 秋'],
  replacements: ['3p', '6p', '北', '發', '白', '4m', '西', '9s'] };

test('Moon Under The Sea on the last wall tile; lastTile flag; no kong without a wall tile', function () {
  var g = newGame([wall(Object.assign({ draws: nulls(82).concat(['9s']) }, MOON1))]);
  eq(hand(g, 3), Ks('123456m 中中中 西西西 9s'));
  driveUntil(g, lastTurnIs(3));
  eq(view(g, 3).players[3].drawn, K('9s'));
  var sw = find(g, 3, 'selfWin');
  ok(sw, 'self-pick on the last tile');
  eq(items(sw.evaluation), I({ selfPick: 1, concealed: 1, moon: 1, dragon: 1 }));
  act(g, 3, { type: 'selfWin' });
  eq(pend(g).result.flags, { kongReplacement: 0, lastTile: true, blessing: null });
  eq(pend(g).result.winTile, K('9s'));
  g = newGame([wall(Object.assign({ draws: nulls(82).concat(['中']) }, MOON1))]);
  driveUntil(g, lastTurnIs(3));
  eq(T.counts(hand(g, 3))[K('中')], 4);
  ok(types(g, 3).every(function (t) { return t === 'discard'; }), 'four 中 but the wall is empty: no kong');
  discard(g, 3, '中');
  var r = pend(g).result;
  eq([r.type, r.reason, r.dealerStays, r.nextDealer, r.payments], ['draw', 'finalDiscard', true, 0, [0, 0, 0, 0]]);
  ok(/Draw game 流局/.test(view(g, 0).log.join('\n')));
  rej(g, 0, { type: 'discard', tile: 0 }, /hand is over/);
});

var MOON2 = { hands: [
  '蘭 夏 4s 6s 1m 2m 3m 4m 5m 6m 中 中 中 北',
  '5s 5s 5s 1p 3p 5p 7p 東 南 西 發 梅 春',
  '7m 8m 9m 4p 6p 8p 1s 2s 3s 7s 9s 竹 冬',
  '2m 3m 6p 9p 3s 6s 9s 南 西 發 白 菊 秋'],
  replacements: ['北', '9p', '白', '8s', '東', '中', '1m', '4p'], draws: nulls(82).concat(['5s']) };

test('the final discard can only be won (Moon Under The Sea); not won -> draw game; dealer stays', function () {
  var g = newGame([wall(MOON2)]);
  discard(g, 0, '9p');
  eq(hand(g, 0), Ks('46s 123456m 中中中 北北'));
  driveUntil(g, function (x) { var v = x.getView(0); return v.wallCount === 0 && x.getPending().type === 'turn'; });
  eq(pend(g).player, 3, 'player 3 draws the last tile');
  discard(g, 3, '5s');
  eq(pend(g), { type: 'claim', tile: K('5s'), from: 3, waiting: [0] }, 'player 1 holds three 5s but may not pong or kong the final discard');
  eq(types(g, 0), ['win', 'pass'], 'no chow on the final discard either');
  var w = find(g, 0, 'win');
  eq(items(w.evaluation), I({ concealed: 1, moon: 1, dragon: 1 }));
  act(g, 0, { type: 'win' });
  var r = pend(g).result;
  eq([r.winner, r.payer, r.source, r.flags.lastTile], [0, 3, 'discard', true]);
  g = newGame([wall(MOON2)]);
  discard(g, 0, '9p');
  driveUntil(g, function (x) { return x.getView(0).wallCount === 0 && x.getPending().type === 'turn'; });
  discard(g, 3, '5s');
  act(g, 0, { type: 'pass' });
  r = pend(g).result;
  eq([r.type, r.reason, r.dealerStays, r.nextDealer, r.nextRound, r.gameOver], ['draw', 'finalDiscard', true, 0, 0, false]);
  eq(r.hands.map(function (h) { return h.hand.length + 3 * h.melds.length; }), [13, 13, 13, 13]);
});

test('draw game when the wall runs out; next hand: same dealer, dealerRepeat + 1', function () {
  var g = newGame([wall({ hands: [] }, 5), null], { seed: 3 });
  var v0 = view(g, 0);
  driveUntil(g, handOver, 5000);                                        // nobody ever takes a win
  var r = pend(g).result;
  eq([r.type, r.dealerStays, r.nextDealer, r.nextRound, r.payments], ['draw', true, 0, 0, [0, 0, 0, 0]]);
  eq(view(g, 0).wallCount, 0);
  eq(tileCount(g), 144);
  eq(view(g, 2).players[0].hand.length, 13, 'hands are revealed at a draw');
  ok(g.nextHand().ok);
  var v = view(g, 0);
  eq([v.handNo, v.dealer, v.dealerRepeat, v.round, v.phase], [2, 0, 1, 0, 'turn']);
  ok(v.dice.every(function (d) { return d >= 1 && d <= 6; }) && v0.dice.length === 3, 'three dice per hand');
});

// ================================================================================================ blessings
var EARTH = { hands: [
  '1m 9m 1p 2p 3p 4p 5p 9p 1s 9s 東 南 西 白',
  '2s 3s 4s 5s 6s 7s 3m 4m 5m 6m 7m 8m 白',
  '6p 7p 8p 1m 2m 9m 8s 9s 1s 北 中 發 東',
  '2m 1p 3p 5p 7p 9p 2s 8s 北 中 發 南 西'] };

test('Blessing of Heaven: the dealer\'s opening 14 wins, paid 384 each', function () {
  var g = newGame([wall({ hands: ['1p 2p 3p 4p 5p 6p 7p 8p 9p 發 發 發 東 東'] })]);
  var sw = find(g, 0, 'selfWin');
  ok(sw && sw.fan === 13, 'selfWin offered at 13 Fan');
  eq(items(sw.evaluation).heaven, 13);
  act(g, 0, { type: 'selfWin' });
  var r = pend(g).result;
  eq([r.flags.blessing, r.dealerStays, r.payments], ['heaven', true, [1152, -384, -384, -384]]);
  ok(/You win by Self-Pick — Blessing of Heaven 天糊 — 13 Fan \(limit\)/.test(view(g, 0).log.join('\n')));
});

test('Blessing of Earth: a non-dealer wins on the dealer\'s first discard (chicken hand), the dealer pays', function () {
  var g = newGame([wall(EARTH)]);
  discard(g, 0, '白');
  eq(pend(g).waiting, [1]);
  var w = find(g, 1, 'win');
  eq(w.fan, 13); eq(items(w.evaluation).earth, 13);
  act(g, 1, { type: 'win' });
  var r = pend(g).result;
  eq([r.flags.blessing, r.payer, r.payments, r.dealerStays, r.nextDealer], ['earth', 0, [-768, 768, 0, 0], false, 1]);
  // not the first discard: with a (non-seat) flower the hand is only All Sequences 1 + Concealed 1 = 2 Fan
  var bw = [];
  var E2 = { hands: EARTH.hands.slice(), draws: ['北', '9p', '5p', '6s'], replacements: ['白'] };
  E2.hands[1] = '2s 3s 4s 5s 6s 7s 3m 4m 5m 6m 7m 8m 梅';
  g = newGame([wall(E2)], { humans: [1], onEvent: function (e) { if (e.type === 'blockedWin') bw.push(e); } });
  eq(hand(g, 1), Ks('234567s 345678m 白'));
  discard(g, 0, '1m'); passAll(g);
  tsumogiri(g); passAll(g);
  tsumogiri(g); passAll(g);
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 0);
  discard(g, 0, '白');
  eq(pend(g), { type: 'turn', player: 1, afterClaim: false }, 'player 1 is auto-passed');
  eq(bw, [{ type: 'blockedWin', player: 1, tile: K('白'), fan: 2, minFan: 3 }], 'blockedWin event for the human');
});

test('Blessing of Man: a non-dealer\'s first draw wins; not after someone has ponged', function () {
  var MAN = { hands: [
    '1m 9m 1p 2p 3p 4p 5p 9p 1s 9s 東 南 西 北',
    '1m 2m 3m 4p 5p 6p 7p 8p 9p 3s 4s 5s 梅',
    '6p 7p 8p 1m 2m 9m 8s 9s 1s 北 中 發 東',
    '2m 1p 3p 5p 7p 9p 2s 8s 北 中 發 南 西'], replacements: ['8m'], draws: ['8m'] };
  var g = newGame([wall(MAN)]);
  discard(g, 0, '北');
  eq(pend(g).player, 1);
  var sw = find(g, 1, 'selfWin');
  ok(sw && sw.fan === 13 && items(sw.evaluation).man === 13, 'Man on the first draw');
  act(g, 1, { type: 'selfWin' });
  eq(pend(g).result.flags.blessing, 'man');
  eq(pend(g).result.payments, [-384, 1152, -384, -384]);
  var MAN2 = { hands: [
    '9m 2p 3p 4p 5p 9p 1s 9s 東 南 西 發 白 北',
    '6p 7p 8p 2m 3m 9m 8s 9s 1s 中 發 東 南',
    '北 北 2m 1p 3p 5p 7p 2s 8s 中 發 南 西',
    '1m 1m 1m 4p 5p 6p 7p 8p 9p 3s 4s 5s 梅'], replacements: ['8m'], draws: ['8m'] };
  g = newGame([wall(MAN2)]);
  discard(g, 0, '北');
  eq(pend(g).waiting, [2]);
  act(g, 2, { type: 'pong' });
  discard(g, 2, '西');
  eq(pend(g).player, 3);
  eq(view(g, 3).players[3].drawn, K('8m'));
  ok(!find(g, 3, 'selfWin'), 'no Man after a pong: 2 Fan is below the minimum');
  eq(view(g, 3).blockedWin, { fan: 2, minFan: 3 });
});

// ================================================================================================ flowers
test('Seven Flowers: offered when the 7th bonus tile is drawn; paid like a self-pick', function () {
  var g = newGame([wall({ hands: [null, '1m 2m 3m 4m 5m 6m 7m 梅 蘭 菊 竹 春 夏', null, ['冬']], draws: ['秋'] })]);
  eq(view(g, 1).players[1].flowers.length, 6);
  ok(g.getActions(1).length === 0);
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 1);
  eq(view(g, 1).players[1].flowers.length, 7);
  var fw = find(g, 1, 'flowerWin');
  ok(fw && fw.fan === 3, 'flowerWin offered at 3 Fan');
  eq(items(fw.evaluation), I({ sevenFlowers: 3 }));
  act(g, 1, { type: 'flowerWin' });
  var r = pend(g).result;
  eq([r.source, r.winTile, r.fan, r.payments], ['flowers', null, 3, [-8, 24, -8, -8]]);
  eq(view(g, 1).players[1].lastAction, 'flowerWin');
});

test('Seven Flowers from the opening: offered on the first turn (dealer and non-dealer)', function () {
  var g = newGame([wall({ hands: [null, null, '1p 2p 3p 4p 5p 6p 梅 蘭 菊 竹 春 夏 秋', ['冬']] })]);
  eq(view(g, 2).players[2].flowers.length, 7);
  eq(g.getActions(2), [], 'not before the player\'s own turn');
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 1);
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 2);
  ok(find(g, 2, 'flowerWin'), 'offered on player 2\'s first turn');
  g = newGame([wall({ hands: ['1m 2m 3m 4m 5m 6m 7m 梅 蘭 菊 竹 春 夏 秋', null, null, ['冬']] })]);
  ok(find(g, 0, 'flowerWin'), 'offered on the dealer\'s first turn');
  act(g, 0, { type: 'flowerWin' });
  eq(pend(g).result.payments, [24, -8, -8, -8]);
});

test('Eight Flowers: after declining at 7, the offer returns with the 8th bonus tile', function () {
  var g = newGame([wall({ hands: [null, '1m 2m 3m 4m 5m 6m 梅 蘭 菊 竹 春 夏 秋', null, null], draws: nulls(8).concat(['冬']) })]);
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 1);
  ok(find(g, 1, 'flowerWin'), 'offered at 7');
  tsumogiri(g);                                                         // declines by discarding
  var safety = 0;
  while (!(pend(g).type === 'turn' && pend(g).player === 1)) { tsumogiri(g); if (++safety > 20) fail('never back to player 1'); }
  ok(!find(g, 1, 'flowerWin'), 'not offered again without a new bonus tile');
  tsumogiri(g);
  safety = 0;
  while (!(pend(g).type === 'turn' && pend(g).player === 1)) { tsumogiri(g); if (++safety > 20) fail('never back to player 1'); }
  eq(view(g, 1).players[1].flowers.length, 8);
  var fw = find(g, 1, 'flowerWin');
  ok(fw && fw.fan === 8, 'Eight Flowers offered at 8 Fan');
  eq(items(fw.evaluation), I({ eightFlowers: 8 }));
});

test('7th bonus tile as the very last tile: the flower win is taken at once; a 6th instead ends in a draw', function () {
  // dealer holds 6 bonus tiles, player 1 one: 7 replacements, 84 live draws -> the 84th (last) is the dealer's
  var g = newGame([wall({ hands: ['1m 2m 3m 4m 5m 6m 7m 8m 梅 蘭 菊 竹 春 夏', '1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 2s 3s 秋'], draws: nulls(83).concat(['冬']) })]);
  driveUntil(g, handOver, 3000);
  var r = pend(g).result;
  eq([r.type, r.winner, r.source, r.fan], ['win', 0, 'flowers', 3]);
  eq(tileCount(g), 144);
  g = newGame([wall({ hands: ['1m 2m 3m 4m 5m 6m 7m 8m 9m 梅 蘭 菊 竹 春', '1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 2s 夏 秋'], draws: nulls(83).concat(['冬']) })]);
  driveUntil(g, handOver, 3000);
  r = pend(g).result;
  eq([r.type, r.reason], ['draw', 'wall'], 'a bonus tile that cannot be replaced ends the hand');
  eq(view(g, 0).players[0].flowers.length, 6);
});

// ================================================================================================ minimum Fan
test('minimum Fan blocks a self-pick; view.blockedWin and getHints report it', function () {
  var spec = { hands: [nulls(13).concat(['9p']), '1m 1m 1m 4p 5p 6p 7p 8p 9p 3s 4s 5s 8m', null, null], draws: ['東', '南', '西', '北', '8m'] };
  var g = newGame([wall(spec)], { settings: { minFan: 4 } });
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 1);
  tsumogiri(g);
  var h = g.getHints(1);
  eq(h.shanten, 0);
  eq(h.waits, [{ tile: K('8m'), left: 3, fan: 2, valid: false, selfFan: 3, selfValid: false }]);
  eq(h.blockedWin, null);
  driveUntil(g, function (x) { return x.getPending().type === 'turn' && x.getPending().player === 1; });
  eq(view(g, 1).players[1].drawn, K('8m'));
  ok(!find(g, 1, 'selfWin'), 'no selfWin below the table minimum');
  eq(view(g, 1).blockedWin, { fan: 3, minFan: 4 });
  eq(g.getHints(1).blockedWin, { fan: 3, minFan: 4 });
  eq(view(g, 0).blockedWin, null, 'only the viewer\'s own blocked win is reported');
  rej(g, 1, { type: 'selfWin' }, /only 3 Fan — this table needs 4/);
});

test('minimum Fan blocks a discard win: blockedWin while the player decides on a pong', function () {
  var spec = { hands: [nulls(13).concat(['9p']), '1m 2m 3m 4m 5m 6m 7p 8p 9p 2s 2s 5s 5s', null, null], draws: ['東', '南', '2s'] };
  var g = newGame([wall(spec)]);
  tsumogiri(g); passAll(g);
  tsumogiri(g); passAll(g);
  tsumogiri(g); passAll(g);
  eq(pend(g).player, 3);
  discard(g, 3, '2s');
  ok(pend(g).waiting.indexOf(1) >= 0);
  eq(types(g, 1), ['pong', 'pass']);
  eq(view(g, 1).blockedWin, { fan: 2, minFan: 3 });
  rej(g, 1, { type: 'win' }, /only 2 Fan/);
});

// ================================================================================================ rotation & rounds
var JUNK_D = '1m 9m 1p 2p 3p 4p 5p 9p 1s 9s 東 南 西', WIN13 = '2s 3s 4s 5s 6s 7s 3m 4m 5m 6m 7m 8m 白',
  JUNK_A = '6p 7p 8p 1m 2m 9m 8s 9s 1s 北 中 發 東', JUNK_B = '2m 1p 3p 5p 7p 9p 2s 8s 北 中 發 南 西';
/** A hand that ends at once: 'pass' = the next player wins on the dealer's first discard; 'stay' = dealer Heaven. */
function quick(dealer, mode) {
  var h = [];
  if (mode === 'stay') { h[dealer] = WIN13 + ' 白'; h[(dealer + 1) % 4] = JUNK_D; }
  else { h[dealer] = JUNK_D + ' 白'; h[(dealer + 1) % 4] = WIN13; }
  h[(dealer + 2) % 4] = JUNK_A; h[(dealer + 3) % 4] = JUNK_B;
  return wall({ hands: h, dealer: dealer });
}
function playQuick(g) {
  var d = view(g, 0).dealer;
  var sw = find(g, d, 'selfWin');
  if (sw) { act(g, d, { type: 'selfWin' }); return 'stay'; }
  discard(g, d, '白');
  act(g, (d + 1) % 4, { type: 'win' });
  return 'pass';
}
function planWalls(firstDealer, modes) {
  var d = firstDealer, out = [];
  modes.forEach(function (m) { out.push(quick(d, m)); if (m === 'pass') d = (d + 1) % 4; });
  return out;
}

test('dealer rotation and East-round-only game end (rounds: 1)', function () {
  var modes = ['stay', 'pass', 'pass', 'stay', 'stay', 'pass', 'pass'];
  var g = newGame(planWalls(0, modes), { settings: { rounds: 1 } });
  var seen = [];
  for (var i = 0; i < modes.length; i++) {
    var v = view(g, 0);
    seen.push([v.handNo, v.round, v.dealer, v.dealerRepeat]);
    eq(v.players[v.dealer].seatWind, 0, 'the dealer is East');
    eq(playQuick(g), modes[i]);
    var r = pend(g).result;
    eq(r.dealerStays, modes[i] === 'stay');
    eq(r.gameOver, i === modes.length - 1, 'game over only after the deal returns to the first dealer');
    var n = g.nextHand();
    ok(n.ok, 'nextHand ' + (n.error || ''));
  }
  eq(seen, [[1, 0, 0, 0], [2, 0, 0, 1], [3, 0, 1, 0], [4, 0, 2, 0], [5, 0, 2, 1], [6, 0, 2, 2], [7, 0, 3, 0]]);
  var pd = pend(g);
  eq(pd.type, 'gameEnd');
  eq(pd.standings.map(function (e) { return e.rank; }).length, 4);
  var sum = pd.standings.reduce(function (a, e) { return a + e.score; }, 0);
  eq(sum, 0, 'scores sum to 4 x startingScore');
  eq(view(g, 0).phase, 'gameEnd');
  ok(view(g, 0).standings !== null);
  rej(g, 0, { type: 'discard', tile: 0 }, /game is over/);
  ok(!g.nextHand().ok, 'nextHand after game over is rejected');
});

test('full game (rounds: 4): round wind advances each time the deal returns to the first dealer; ends after North', function () {
  var modes = [];
  for (var i = 0; i < 16; i++) modes.push('pass');
  var g = newGame(planWalls(2, modes), { firstDealer: 2 });
  var rounds = [], dealers = [];
  for (i = 0; i < 16; i++) {
    var v = view(g, 0);
    rounds.push(v.round); dealers.push(v.dealer);
    playQuick(g);
    var r = pend(g).result;
    eq(r.gameOver, i === 15);
    if (i === 3) { eq([r.nextDealer, r.nextRound], [2, 1]); ok(/South Round 南風 begins/.test(view(g, 0).log.join('\n'))); }
    ok(g.nextHand().ok);
  }
  eq(rounds, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  eq(dealers, [2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  eq(pend(g).type, 'gameEnd');
  eq(pend(g).standings.map(function (e) { return e.score; }), [0, 0, 0, 0], 'every player paid and received one Earth');
  eq(pend(g).standings.map(function (e) { return e.rank; }), [1, 1, 1, 1], 'ties share a rank');
});

// ================================================================================================ API hygiene
test('invalid actions are rejected with an error, never thrown; the state is unchanged', function () {
  var g = newGame([wall(PRIO)]);
  rej(g, -1, { type: 'discard', tile: K('北') }, /Invalid player/);
  rej(g, 4, { type: 'discard', tile: K('北') }, /Invalid player/);
  rej(g, '0', { type: 'discard', tile: K('北') }, /Invalid player/);
  rej(g, 0, null, /Invalid action/);
  rej(g, 0, 'discard', /Invalid action/);
  rej(g, 0, {}, /Invalid action/);
  rej(g, 0, { type: 7 }, /Invalid action/);
  rej(g, 0, { type: 'bogus' }, /Unknown action/);
  rej(g, 1, { type: 'discard', tile: K('西') }, /not Julie's turn/);
  rej(g, 0, { type: 'discard', tile: K('5p') }, /not in your hand/);
  rej(g, 0, { type: 'discard' }, /needs a tile/);
  rej(g, 0, { type: 'discard', tile: 99 }, /needs a tile/);
  rej(g, 0, { type: 'selfWin' }, /not complete/);
  rej(g, 0, { type: 'pong' }, /answers a discard/);
  rej(g, 0, { type: 'concealedKong', tile: K('1m') }, /Kong/);
  rej(g, 0, { type: 'flowerWin' }, /Flowers/);
  act(g, 0, { type: 'discard', tile: String(K('北')) });                     // numeric strings are accepted
  ok(!g.start().ok, 'start() twice is rejected');
  ok(!g.nextHand().ok, 'nextHand() during a hand is rejected');
  discard(g, 1, '9m');
  act(g, 2, { type: 'chow', tiles: Ks('789m') });
  act(g, 3, { type: 'pong' });
  act(g, 0, { type: 'pass' });
  rej(g, 3, { type: 'selfWin' }, /After a Chow or Pong/);
  rej(g, 3, { type: 'concealedKong', tile: K('9m') }, /After a Chow or Pong/);
  var fresh = new Game({ seed: 5 });
  ok(!fresh.act(0, { type: 'discard', tile: 1 }).ok, 'act before start is rejected');
  eq(fresh.getActions(0), []);
  eq(fresh.getPending(), null);
  ok(fresh.getView(0).phase === 'idle');
  // fuzz: garbage never throws and never changes the state
  var rng = HKMJ.RNG(4242), junk = [null, undefined, 0, -3, 1.5, 'x', '12', [], {}, [1, 2, 3], { tile: 3 }, true, NaN, Infinity];
  var TY = ['discard', 'selfWin', 'flowerWin', 'concealedKong', 'addKong', 'win', 'kong', 'pong', 'chow', 'pass', 'x', '', null];
  g = new Game({ seed: 77, humans: [] }); g.start();
  for (var i = 0; i < 3000; i++) {
    var before = g.serialize();
    var a = rng.next() < 0.1 ? rng.pick(junk) : { type: rng.pick(TY), tile: rng.next() < 0.5 ? rng.int(45) - 2 : rng.pick(junk), tiles: rng.next() < 0.5 ? [rng.int(40), rng.int(40), rng.int(40)] : rng.pick(junk) };
    var p = rng.next() < 0.9 ? rng.int(4) : rng.pick(junk);
    var res;
    try { res = g.act(p, a); } catch (e) { fail('act threw on ' + JSON.stringify(a) + ': ' + e.message); }
    ok(res && typeof res.ok === 'boolean', 'act returns {ok}');
    if (!res.ok) ok(g.serialize() === before, 'rejected garbage left the state unchanged');
    if (res.ok) ok(tileCount(g) === 144, 'tiles conserved');
    var pd = g.getPending();
    if (pd.type === 'handEnd') g.nextHand();
    if (pd.type === 'gameEnd') { g = new Game({ seed: i, humans: [] }); g.start(); }
    else if (rng.next() < 0.5) {                                          // also make legal progress
      var who = pd.type === 'turn' ? pd.player : (pd.waiting || [])[0];
      if (who !== undefined && pd.type !== 'handEnd') { var acts = g.getActions(who); if (acts.length) act(g, who, rng.pick(acts)); }
    }
  }
  ok(g._evalErrors === 0, 'no evaluation errors');
});

test('the view never shows hidden tiles; pending reveals only the viewer\'s own claim', function () {
  var g = newGame([wall(PRIO)], { humans: [0] });
  var v = view(g, 1);
  eq(v.players[1].hand.length, 13);
  eq([v.players[0].hand, v.players[2].hand, v.players[3].hand], [null, null, null]);
  eq([v.players[0].drawn, v.players[0].handCount], [null, 14]);
  eq(v.actions, []);
  ok(!('wall' in v) && JSON.stringify(v).indexOf('"wall"') < 0, 'no wall in the view');
  v = view(g, 0);
  eq([v.players[0].drawn, v.players[0].isHuman, v.players[1].isHuman, v.players[0].isDealer], [K('北'), true, false, true]);
  ok(v.actions.length > 0 && v.pending.type === 'turn');
  var all = g.getView(2, { revealAll: true });
  ok(all.players.every(function (p) { return Array.isArray(p.hand); }), 'revealAll shows every hand');
  discard(g, 0, '北'); discard(g, 1, '9m');
  eq(view(g, 0).pending.waiting, [0]);
  eq(view(g, 1).pending.waiting, []);
  eq(view(g, 2).pending.waiting, [2]);
  eq(view(g, 1).actions, []);
  eq(g.getView(7).players.map(function (p) { return p.hand; }), [null, null, null, null], 'no viewer: nothing hidden shown');
  act(g, 0, { type: 'win' }); act(g, 2, { type: 'pass' }); act(g, 3, { type: 'pass' });
  v = view(g, 3);
  ok(v.players.every(function (p) { return Array.isArray(p.hand); }), 'hands are revealed at the end of the hand');
  eq(v.phase, 'handEnd');
  ok(v.result && v.result.evaluation.fan === 6);
});

test('serialize -> deserialize mid-hand (including mid-claim) continues identically, RNG included', function () {
  function policy(rng) {
    return function (g) {
      var pd = g.getPending();
      if (pd.type === 'handEnd') { g.nextHand(); return; }
      var p = pd.type === 'turn' ? pd.player : pd.waiting[0];
      var acts = g.getActions(p);
      act(g, p, HKMJ.AI.decide(g.getView(p), acts, { level: 'normal', rng: rng }));
    };
  }
  [11, 12, 13].forEach(function (seed) {
    var g = new Game({ seed: seed, humans: [], settings: { rounds: 1 } });
    g.start();
    var r1 = HKMJ.RNG(seed * 31), step1 = policy(r1);
    var k = 40 + seed * 7;
    for (var i = 0; i < k && pend(g).type !== 'gameEnd'; i++) step1(g);
    var saved = g.serialize(), savedRng = r1.getState();
    var trace = [];
    for (i = 0; i < 400 && pend(g).type !== 'gameEnd'; i++) { step1(g); trace.push(g.serialize()); }
    var g2 = Game.deserialize(saved), step2 = policy(HKMJ.RNG.fromState(savedRng));
    for (i = 0; i < trace.length; i++) {
      step2(g2);
      if (g2.serialize() !== trace[i]) fail('seed ' + seed + ': continuation differs at step ' + (k + i));
    }
    ok(trace.length > 100, 'long continuation incl. hand boundaries');
  });
  var g = newGame([wall(PRIO)]);
  discard(g, 0, '北'); discard(g, 1, '9m'); act(g, 2, { type: 'chow', tiles: Ks('789m') });
  var g2 = Game.deserialize(g.serialize());
  eq(g2.getPending(), g.getPending(), 'mid-claim pending restored');
  eq(g2.getActions(0), g.getActions(0));
  act(g2, 3, { type: 'pong' }); act(g2, 0, { type: 'win' });
  eq(pend(g2).result.winner, 0);
  var bad = false;
  try { Game.deserialize('{"format":"nope"}'); } catch (e) { bad = true; }
  ok(bad, 'deserialize rejects foreign data');
  bad = false;
  var s = JSON.parse(g.serialize()); s.state.wall.pop();
  try { Game.deserialize(JSON.stringify(s)); } catch (e) { bad = true; }
  ok(bad, 'deserialize rejects a save with a missing tile');
});

test('deterministic for a seed; seeds differ; firstDealer from the seeded RNG', function () {
  function run(seed) {
    var g = new Game({ seed: seed, humans: [], settings: { rounds: 1 } });
    g.start();
    var rng = HKMJ.RNG(5);
    for (var i = 0; i < 300 && pend(g).type !== 'gameEnd'; i++) {
      var pd = pend(g);
      if (pd.type === 'handEnd') { g.nextHand(); continue; }
      var p = pd.type === 'turn' ? pd.player : pd.waiting[0];
      act(g, p, rng.pick(g.getActions(p)));
    }
    return g.serialize();
  }
  eq(run('abc') === run('abc'), true, 'same seed, same game');
  eq(run(1) === run(2), false);
  var d = {};
  for (var s = 1; s <= 40; s++) d[new Game({ seed: s }).s.firstDealer] = 1;
  eq(Object.keys(d).length, 4, 'every seat can be the first dealer');
});

test('log lines: English + Chinese tile names, "You" conjugation', function () {
  var LOG = { hands: [
    '1m 1m 1m 2m 3m 4m 5m 6m 7m 8m 9m 東 東 9p',
    '1s 4s 7s 1p 4p 3m 7m 南 北 發 白 9s 2s',
    '中 中 1s 3s 6s 2p 6p 9m 西 南 北 發 白',
    '2p 3p 7p 8p 5s 6s 8s 8m 9m 西 發 白 南'], draws: ['5p', '9s', '中', '1p', '4m'] };
  var g = newGame([wall(LOG)]);
  discard(g, 0, '9p'); discard(g, 1, '5p'); discard(g, 2, '9s'); discard(g, 3, '中');
  eq(pend(g).waiting, [2]);
  act(g, 2, { type: 'pong' });
  discard(g, 2, '西'); discard(g, 3, '1p');
  act(g, 0, { type: 'selfWin' });
  var log = view(g, 0).log;
  ['You discard 9 Dots 九筒', 'Julie discards 5 Dots 五筒', 'Bel pongs Red Dragon 中', 'You win by Self-Pick — 6 Fan',
    'Payments: You +96, Julie -32, Bel -32, Pat -32', 'You keep the deal.'].forEach(function (line) {
    ok(log.indexOf(line) >= 0, 'log has "' + line + '"; got:\n  ' + log.join('\n  '));
  });
  ok(/^Hand 1 — East Round 東風 · You deal · dice \d·\d·\d$/.test(log[0]), 'hand header: ' + log[0]);
  eq(view(g, 0).logKinds.length, log.length);
});

test('events: order and shapes (handStart, draw, discard, claim, concealedKong, win, handEnd, gameEnd); unsubscribe', function () {
  var ev = [];
  var g = new Game({ seed: 1, firstDealer: 0, presetWalls: [wall(PRIO)], humans: [] });
  var off = g.on(function (e) { ev.push(e); });
  var reported = 0;
  g.on(function () { throw new Error('a broken listener must not break the engine'); });
  var errs = console.error; console.error = function () { reported++; };
  try {
    g.start();
    discard(g, 0, '北'); discard(g, 1, '9m');
    act(g, 2, { type: 'chow', tiles: Ks('789m') }); act(g, 3, { type: 'pong' }); act(g, 0, { type: 'pass' });
    eq(ev.map(function (e) { return e.type; }), ['handStart', 'discard', 'draw', 'discard', 'claim']);
    eq(ev[0], { type: 'handStart', handNo: 1, round: 0, dealer: 0, dice: g.getView(0).dice });
    eq(ev[4], { type: 'claim', player: 3, claim: 'pong', tile: K('9m'), from: 1 });
    off();
    discard(g, 3, '1p');
    eq(ev.length, 5, 'unsubscribed');
    ok(reported >= 6, 'listener errors are reported (console.error), not thrown');
  } finally { console.error = errs; }
});

test('buildWall helper and settings defaults', function () {
  var w = wall({ hands: ['1m 1m 1m 1m'] });
  eq(w.length, 144);
  eq(T.sort(w), T.sort(T.fullSet()));
  var threw = false;
  try { wall({ hands: ['1m 1m 1m 1m 1m'] }); } catch (e) { threw = true; }
  ok(threw, 'five copies are impossible');
  eq(HKMJ.DEFAULT_SETTINGS, { minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0,
    optional: { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true, chicken: 'minimum' } });
  var g = new Game({ seed: 1, settings: { minFan: 1, optional: { kong: true }, rounds: 'x', speed: 'fast', startingScore: 500 } });
  var s = g.getView(0).settings;
  eq([s.minFan, s.optional.kong, s.optional.sevenPairs, s.rounds, s.speed, s.startingScore], [1, true, true, 4, 'fast', 500]);
  eq(g.getView(0).players.map(function (p) { return p.score; }), [500, 500, 500, 500]);
  eq(g.getView(0).players.map(function (p) { return p.name; }), ['You', 'Julie', 'Bel', 'Pat']);
});

// ------------------------------------------------------------------------------------------------ run
var passed = 0, failed = 0;
TESTS.forEach(function (t) {
  try {
    t.fn();
    passed++;
    if (VERBOSE) console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e));
  }
});
console.log('\nengine.test: ' + passed + ' passed, ' + failed + ' failed (' + checks + ' checks)' + (STUBBED.length ? ' [STUBS: ' + STUBBED.join(',') + ']' : ''));
process.exit(failed ? 1 : 0);
