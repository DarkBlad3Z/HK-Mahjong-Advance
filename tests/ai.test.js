#!/usr/bin/env node
/* HK Mahjong — tests/ai.test.js  (Owner: back end)
 * Computer players: legality & robustness through the real engine, always winning, Fan planning, claims, kongs,
 * defence, determinism, hint text and decision time.
 *   node tests/ai.test.js [--quick]
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', 'src', 'core');
['tiles.js', 'rng.js', 'hand.js', 'scoring.js', 'engine.js', 'ai.js'].forEach(function (f) { require(path.join(CORE, f)); });
var HK = globalThis.HKMJ, T = HK.Tiles, AI = HK.AI;
var QUICK = process.argv.indexOf('--quick') >= 0;

var passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('FAIL ' + msg); } }
function P(s) { return T.parse(s); }
function meld(s, from) {
  var p = s.split(' '), t = P(p[1]);
  if (p[0] === 'chow') return { type: 'chow', tiles: T.sort(t), concealed: false, from: from === undefined ? null : from, claimed: t[0], added: false };
  var k = t[0];
  if (p[0] === 'pong') return { type: 'pong', tiles: [k, k, k], concealed: false, from: from === undefined ? null : from, claimed: k, added: false };
  return { type: 'kong', tiles: [k, k, k, k], concealed: p[0] === 'ckong', from: null, claimed: null, added: false };
}
var OPT = { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true };
/** a minimal view model (SPEC §5.4) for viewer 0 */
function mkView(o) {
  var players = [0, 1, 2, 3].map(function (i) {
    var x = (o.players && o.players[i]) || {};
    return { index: i, name: ['You', 'Julie', 'Bel', 'Pat'][i], isHuman: i === 0, seatWind: (i - (o.dealer || 0) + 4) % 4, isDealer: i === (o.dealer || 0),
      score: 0, handCount: x.handCount || 13, hand: i === 0 ? P(o.hand) : null, drawn: null,
      melds: (x.melds || []).map(function (m) { return typeof m === 'string' ? meld(m) : m; }), flowers: x.flowers ? P(x.flowers) : [34 + ((i + 1) % 4)],
      discards: x.discards ? P(x.discards) : [], lastAction: null };
  });
  if (o.melds) players[0].melds = o.melds.map(function (m) { return meld(m); });
  if (o.flowers !== undefined) players[0].flowers = P(o.flowers);
  return {
    viewer: 0, handNo: 1, round: o.round || 0, dealer: o.dealer || 0, firstDealer: 0, dealerRepeat: 0, dice: [1, 2, 3],
    wallCount: o.wall === undefined ? 70 : o.wall, phase: o.claimTile ? 'claim' : 'turn', turn: o.turn || 0,
    pending: o.claimTile ? { type: 'claim', tile: P(o.claimTile)[0], from: o.from, waiting: [0] } : { type: 'turn', player: 0, afterClaim: false },
    actions: [], blockedWin: null, lastDiscard: null,
    claimTile: o.claimTile ? { tile: P(o.claimTile)[0], from: o.from, kind: 'discard' } : null,
    players: players,
    settings: { minFan: o.minFan === undefined ? 3 : o.minFan, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0, optional: Object.assign({}, OPT, o.opt || {}) },
    result: null, standings: null, log: []
  };
}
function discardActs(hand) { var seen = {}, out = []; P(hand).forEach(function (k) { if (!seen[k]) { seen[k] = true; out.push({ type: 'discard', tile: k }); } }); return out; }
var LEVELS = ['easy', 'normal', 'hard'];

// ------------------------------------------------------------------------------------------------ always win
(function () {
  var v = mkView({ hand: '123m 456m 789m 東東東 55p' });
  var acts = [{ type: 'selfWin', fan: 5 }].concat(discardActs('123m 456m 789m 東東東 55p'));
  LEVELS.forEach(function (l) { ok(AI.decide(v, acts, { level: l, rng: HK.RNG(1) }) === acts[0], l + ' takes a Self-Pick win'); });
  var v2 = mkView({ hand: '123m 456m 789m 東東東 5p', claimTile: '5p', from: 2 });
  var a2 = [{ type: 'win', fan: 4 }, { type: 'pong' }, { type: 'pass' }];
  LEVELS.forEach(function (l) { ok(AI.decide(v2, a2, { level: l }) === a2[0], l + ' takes a discard win over a pong'); });
  var a3 = [{ type: 'flowerWin', fan: 3 }].concat(discardActs('123m 456m 789m 東東東 55p'));
  LEVELS.forEach(function (l) { ok(AI.decide(v, a3, { level: l }) === a3[0], l + ' takes a flower win'); });
  ok(AI.decide(v, [{ type: 'pass' }], {}) !== null, 'a single action is returned as is');
})();

// ------------------------------------------------------------------------------------------------ Fan planning
(function () {
  // clear Mixed Flush in Characters (we sit North in the South round, so 東 is not a scoring wind):
  // throw the off-suit tiles, not the honours
  var hand = '123m 456m 78m 東東 中 9p 2s';
  var v = mkView({ hand: hand, wall: 80, dealer: 1, round: 1 });
  var an = AI.decide(v, discardActs(hand), { level: 'normal', rng: HK.RNG(3) });
  ok(an && (an.tile === P('9p')[0] || an.tile === P('2s')[0]), 'normal: Mixed Flush hand throws an off-suit tile (got ' + T.code(an.tile) + ')');
  var ah = AI.decide(v, discardActs(hand), { level: 'hard', rng: HK.RNG(3) });
  ok(ah && T.suitOf(ah.tile) !== 0, 'hard: keeps every Characters tile (flush), got ' + T.code(ah.tile));
  // a concealed All Sequences hand whose 3 Fan need Concealed Hand: a Chow would kill the minimum -> pass
  var h2 = '23m 456m 234p 67p 99s 5s';
  var v2 = mkView({ hand: h2, claimTile: '1m', from: 3, flowers: '', wall: 70 });
  var a2 = [{ type: 'chow', tiles: P('123m') }, { type: 'pass' }];
  ['normal', 'hard'].forEach(function (l) {
    var r = AI.decide(v2, a2, { level: l });
    ok(r === a2[1], l + ': refuses a Chow that loses Concealed Hand the hand needs (got ' + r.type + ')');
  });
  // an open Characters hand with a 中 pair: Pong the 中 (Dragon Fan toward the minimum)
  var v3 = mkView({ hand: '456m 78m 中中 東 9p', melds: ['chow 123m'], claimTile: '中', from: 2, wall: 60 });
  var a3 = [{ type: 'pong' }, { type: 'pass' }];
  ['normal', 'hard'].forEach(function (l) {
    var r = AI.decide(v3, a3, { level: l });
    ok(r === a3[0], l + ': pongs the 中 that gives the hand its Fan (got ' + r.type + ')');
  });
  // plans never include a target below the minimum
  var st = AI._readState(mkView({ hand: '123m 456p 789s 12m 34p 5s', flowers: '竹' }), AI.LEVELS.normal);
  var plans = AI._genPlans(st, AI._makePos(HK.Hand.counts(P('123m 456p 789s 12m 34p 5s')), []));
  ok(plans.length > 0 && plans.every(function (pl) { return pl.fanS + pl.nf >= st.minFan; }), 'every generated plan can reach the minimum (' + plans.length + ' plans)');
  // a ready hand below the minimum is worth nothing: ready value 0 on a 2-Fan wait
  var st2 = AI._readState(mkView({ hand: '123m 456p 777s 11m 34p', flowers: '竹' }), AI.LEVELS.normal);
  var pv = AI._positionValue(st2, AI._makePos(HK.Hand.counts(P('123m 456p 777s 11m 34p')), []), null, 2);
  ok(!pv.ready || pv.ready.value === 0, 'being ready at 2 Fan (Concealed + Self-Pick only) is worth nothing as such');
})();

// ------------------------------------------------------------------------------------------------ kongs
(function () {
  var hand = '123m 456m 789p 西西西西 5s';
  var v = mkView({ hand: hand });
  var acts = [{ type: 'concealedKong', tile: T.WEST }].concat(discardActs(hand));
  ['normal', 'hard'].forEach(function (l) {
    var r = AI.decide(v, acts, { level: l });
    ok(r === acts[0], l + ': declares a concealed Kong of an idle quad (got ' + r.type + ')');
  });
  // a quad that is needed as pong + sequence: 4 x 3m in 2333345m — do not break the hand
  var h2 = '123m 3334m 55p 678p 99s';   // 1233334m: 123 333 4 ... concealed Kong of 3m would leave 124m
  var acts2 = [{ type: 'concealedKong', tile: P('3m')[0] }].concat(discardActs(h2));
  var r2 = AI.decide(mkView({ hand: h2 }), acts2, { level: 'hard' });
  ok(r2 && acts2.indexOf(r2) >= 0, 'kong decision on a useful quad returns a legal action (' + r2.type + ')');
})();

// ------------------------------------------------------------------------------------------------ defence
(function () {
  // Wing (2) shows three Dots melds and has thrown no Dots: a Dots flush, likely ready.  Our hand is far from ready.
  var hand = '2m 3m 6m 7m 3s 4s 7s 8s 5p 6p 9p 1s 1m 2s';
  var o = { hand: hand, wall: 30, players: [null, { discards: '1m 9s 東 2s 8m 5s 北 3m 7s' }, { melds: ['pong 2p', 'chow 456p', 'pong 8p'], discards: '1m 9m 東 3s 7m 南 5s 西 9s 1s' }, { discards: '1s 9m 白 7s 2m 4s 北 6m 8s' }] };
  var v = mkView(o);
  var st = AI._readState(v, AI.LEVELS.hard);
  var wing = st.opps.filter(function (x) { return x.p === 2; })[0];
  ok(wing.flushSuit === 1 && wing.flushStr >= 0.5 && wing.pReady > 0.3, 'Wing read as a ready Dots flush (' + JSON.stringify({ s: wing.flushSuit, f: wing.flushStr, r: wing.pReady }) + ')');
  ok(AI._danger(st, P('9p')[0]) > 5 * AI._danger(st, P('1s')[0]), 'a Dots tile is far more dangerous than a Sticks tile against the Dots flush');
  var r = AI.decide(v, discardActs(hand), { level: 'hard' });
  ok(T.suitOf(r.tile) !== 1, 'hard does not feed the Dots flush while far from ready (got ' + T.code(r.tile) + ')');
  // dead honours are safe: all four 白 accounted for
  var v2 = mkView({ hand: '白 123m 456p 789s 23m 5p', players: [null, { melds: ['pong 白'] }, null, null] });
  var st2 = AI._readState(v2, AI.LEVELS.hard);
  ok(AI._danger(st2, T.WHITE) === 0, 'an honour with all copies visible is completely safe');
})();

// ------------------------------------------------------------------------------------------------ determinism & hints
(function () {
  var hand = '13m 257p 3689s 東南中發白';
  var v = mkView({ hand: hand });
  var a = AI.decide(v, discardActs(hand), { level: 'easy', rng: HK.RNG(42) });
  var b = AI.decide(v, discardActs(hand), { level: 'easy', rng: HK.RNG(42) });
  ok(a && b && a.tile === b.tile, 'same view + same rng seed -> same decision');
  var s = AI.suggest(v, discardActs(hand));
  ok(s && s.action && s.action.type === 'discard' && typeof s.reason === 'string' && s.reason.length > 10, 'suggest gives an action and a reason: ' + (s && s.reason));
  var s2 = AI.suggest(mkView({ hand: '456m 78m 中中 東 9p', melds: ['chow 123m'], claimTile: '中', from: 2 }), [{ type: 'pong' }, { type: 'pass' }]);
  ok(s2.action.type === 'pong' && /Pong/.test(s2.reason), 'suggest explains a claim: ' + s2.reason);
  var s3 = AI.suggest(v, [{ type: 'selfWin', fan: 4, evaluation: { items: [{ name: 'Mixed Flush', fan: 3 }, { name: 'Self-Pick', fan: 1 }] } }].concat(discardActs(hand)));
  ok(s3.action.type === 'selfWin' && /4 Fan/.test(s3.reason), 'suggest explains a win: ' + s3.reason);
  ok(AI.suggest(v, []).action === null, 'suggest with no actions');
  // malformed input never throws and still returns a legal action
  var weird = mkView({ hand: hand });
  weird.players[1].melds = null; weird.settings = null;
  var w = AI.decide(weird, discardActs(hand), { level: 'hard' });
  ok(w && w.type === 'discard', 'malformed view still gives a legal action');
})();

// ------------------------------------------------------------------------------------------------ engine fuzz: legality, robustness, speed
(function () {
  var errors = [];
  var origErr = console.error;
  console.error = function () { errors.push(Array.prototype.slice.call(arguments).join(' ')); };
  var games = QUICK ? 6 : 24, decisions = 0, illegal = 0, suggestBad = 0, times = [], wins = 0, hands = 0;
  var variants = [
    {}, { minFan: 0 }, { minFan: 5 }, { optional: { kong: true } },
    { optional: { sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false } },
    { payment: 'shared', unit: 'chips' }
  ];
  for (var g = 0; g < games; g++) {
    var settings = Object.assign({ rounds: 1 }, variants[g % variants.length]);
    var game = new HK.Game({ seed: 'ai-test-' + g, humans: [], settings: settings });
    game.start();
    var levels = [LEVELS[g % 3], LEVELS[(g + 1) % 3], LEVELS[(g + 2) % 3], 'hard'];
    var rng = HK.RNG(g);
    for (var guard = 0; guard < 40000; guard++) {
      var pd = game.getPending();
      if (pd.type === 'gameEnd') break;
      if (pd.type === 'handEnd') { hands++; if (pd.result.type === 'win') wins++; game.nextHand(); continue; }
      var ps = pd.type === 'turn' ? [pd.player] : pd.waiting.slice();
      for (var q = 0; q < ps.length; q++) {
        var p = ps[q], v = game.getView(p), acts = v.actions;
        var t0 = process.hrtime.bigint();
        var a = AI.decide(v, acts, { level: levels[p], rng: rng });
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
        decisions++;
        if (acts.indexOf(a) < 0) { illegal++; a = acts[0]; }
        if (decisions % 97 === 0) {
          var sg = AI.suggest(v, acts);
          if (!sg || acts.indexOf(sg.action) < 0 || !sg.reason) suggestBad++;
        }
        var res = game.act(p, a);
        if (!res.ok) { illegal++; break; }
      }
    }
  }
  console.error = origErr;
  ok(illegal === 0, 'every AI decision is one of the offered actions and accepted by the engine (' + illegal + ' bad of ' + decisions + ')');
  ok(errors.length === 0, 'no AI errors / fallbacks logged (' + errors.length + ')' + (errors.length ? ': ' + errors[0] : ''));
  ok(suggestBad === 0, 'suggest() always returns an offered action with a reason');
  times.sort(function (a, b) { return a - b; });
  var mean = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
  var p95 = times[Math.floor(0.95 * times.length)], mx = times[times.length - 1];
  console.log('  engine fuzz: ' + games + ' games, ' + hands + ' hands (' + (100 * wins / hands).toFixed(0) + '% won), ' + decisions + ' decisions; ms mean ' + mean.toFixed(2) + ', p95 ' + p95.toFixed(2) + ', max ' + mx.toFixed(1));
  ok(mean < 30 && p95 < 30, 'typical decision under 30 ms (mean ' + mean.toFixed(2) + ', p95 ' + p95.toFixed(2) + ')');
  ok(mx < 250, 'worst decision under 250 ms (' + mx.toFixed(1) + ')');
})();

console.log('ai.test: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
