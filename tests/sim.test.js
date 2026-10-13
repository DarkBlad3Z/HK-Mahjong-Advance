#!/usr/bin/env node
/* HK Mahjong — tests/sim.test.js  (Owner: back end)
 * SPEC §7.4 simulation: complete games with 4 computer players (mixed levels & settings, seeds 1..N), with the
 * invariants checked after EVERY step:
 *   - 144 tiles conserved (wall + hands + melds + flowers + rivers, exact multiset)
 *   - concealed + 3 x melds = 13, or 14 for the player to act on their own turn / the kong maker / the winner
 *   - scores sum to 4 x startingScore; payments sum to 0 and match Scoring.payments
 *   - every win is valid (re-scored independently from the result), no valid win is missed
 *   - claim options re-derived independently from the rules (chow only from the left, win > kong/pong > chow,
 *     final discard win-only, kongs need a wall tile, only added kongs robbed) and compared with the engine's
 *   - Blessings / kong-replacement / last-tile flags / flower offers re-derived from the event stream
 *   - views never leak hidden tiles; dealer rotation, rounds and game end follow SPEC §2.2
 *   - no exceptions; every game terminates
 * Plus a "chaos" batch where some seats pick random legal actions (declined wins, odd kongs, chows) to reach rare
 * engine paths, save/resume swaps mid-game, and a determinism re-run.
 *   node tests/sim.test.js [--games 300] [--chaos 150] [--quick] [--verbose]
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
var HKMJ = globalThis.HKMJ, T = HKMJ.Tiles, Game = HKMJ.Game, S = HKMJ.Scoring;

var argv = process.argv.slice(2);
function arg(name, dflt) { var i = argv.indexOf('--' + name); return i >= 0 ? +argv[i + 1] : dflt; }
var QUICK = argv.indexOf('--quick') >= 0, VERBOSE = argv.indexOf('--verbose') >= 0;
var GAMES = arg('games', QUICK ? 40 : 300), CHAOS = arg('chaos', QUICK ? 20 : 150);
var MAX_STEPS_PER_GAME = 60000;
if (STUBBED.length) console.log('NOTE: using test stand-ins (tests/_stubs) for: ' + STUBBED.join(', '));

var LEVELS = ['easy', 'normal', 'hard'];
var FULL = T.sort(T.fullSet());
var failures = [];
var stats = { games: 0, hands: 0, wins: 0, draws: 0, steps: 0, bySource: {}, blessings: {}, flowerWins: 0, robs: 0,
  kongRepl: 0, doubleKong: 0, moon: 0, headBumps: 0, limit: 0, fanSum: 0, claims: {}, kongs: 0, saves: 0,
  aiTimes: { easy: [], normal: [], hard: [] }, maxHandsInGame: 0, chaosGames: 0, chaosHands: 0 };

function problem(ctx, msg) {
  failures.push(ctx + ': ' + msg);
  if (failures.length <= 30) console.log('FAIL ' + ctx + ': ' + msg);
  throw new SimError(msg);
}
function SimError(msg) { this.message = msg; }

function sameAction(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.tile !== undefined || b.tile !== undefined) if (a.tile !== b.tile) return false;
  if (a.tiles || b.tiles) return JSON.stringify(a.tiles) === JSON.stringify(b.tiles);
  return true;
}
function countOf(arr, k) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i] === k) n++; return n; }

/** Rule state re-derived from the event stream (independent of the engine's internals). */
function Tracker() { this.allKongs = 0; this.allClaims = {}; this.reset(); }
Tracker.prototype.reset = function () {
  this.discards = 0; this.interrupted = false; this.draws = [0, 0, 0, 0]; this.chain = [0, 0, 0, 0];
  this.bonus = [0, 0, 0, 0]; this.offer = [false, false, false, false]; this.lastEvent = null; this.kongs = 0;
};
Tracker.prototype.on = function (e) {
  this.lastEvent = e;
  switch (e.type) {
    case 'handStart': this.reset(); break;
    case 'draw': if (!e.replacement) this.draws[e.player]++; break;
    case 'bonus': this.bonus[e.player]++; if (this.bonus[e.player] === 7 || this.bonus[e.player] === 8) this.offer[e.player] = true; break;
    case 'discard': this.discards++; this.chain[e.player] = 0; break;
    case 'claim': this.allClaims[e.claim] = (this.allClaims[e.claim] || 0) + 1; this.interrupted = true; this.chain[e.player] = e.claim === 'kong' ? 1 : 0; if (e.claim === 'kong') { this.kongs++; this.allKongs++; } break;
    case 'concealedKong': case 'addKong': this.interrupted = true; this.chain[e.player]++; this.kongs++; this.allKongs++; break;
  }
};

function ctxFor(v, p, hand, winTile, source, x) {
  var P = v.players[p];
  return { hand: hand, melds: P.melds, winTile: winTile, source: source, kongReplacement: x.kongReplacement || 0,
    lastTile: !!x.lastTile, seatWind: P.seatWind, roundWind: v.round, flowers: P.flowers, blessing: x.blessing || null,
    flowerWin: !!x.flowerWin, settings: { minFan: v.settings.minFan, optional: v.settings.optional } };
}

/** Expected claim options of q on tile t discarded by `from` (types, chow sequences, win fan). */
function expectedClaim(v, q, t, from, tr) {
  var P = v.players[q], out = [], wall = v.wallCount;
  var earth = tr.discards === 1 && from === v.dealer && q !== v.dealer;
  var ev = S.evaluate(ctxFor(v, q, P.hand.concat([t]), t, 'discard', { lastTile: wall === 0, blessing: earth ? 'earth' : null }));
  if (ev.winning && ev.valid) out.push({ type: 'win', fan: ev.fan });
  if (wall > 0) {
    var n = countOf(P.hand, t);
    if (n >= 3) out.push({ type: 'kong' });
    if (n >= 2) out.push({ type: 'pong' });
    if (q === (from + 1) % 4 && T.isSuit(t)) {
      var r = T.rankOf(t);
      [[-2, -1], [-1, 1], [1, 2]].forEach(function (o) {
        if (r + o[0] < 1 || r + o[1] > 9) return;
        if (P.hand.indexOf(t + o[0]) >= 0 && P.hand.indexOf(t + o[1]) >= 0) out.push({ type: 'chow', tiles: T.sort([t + o[0], t + o[1], t]) });
      });
    }
  }
  if (out.length) out.push({ type: 'pass' });
  return { acts: out, blocked: ev.winning && !ev.valid ? { fan: ev.fan, minFan: v.settings.minFan } : null };
}
function brief(acts) { return acts.map(function (a) { return a.type + (a.tiles ? '[' + a.tiles.join(',') + ']' : '') + (a.fan !== undefined ? '(' + a.fan + ')' : ''); }).join(' '); }

// ------------------------------------------------------------------------------------------------ invariants
function checkState(g, ctx, tr, info) {
  var s = g.s, v = g.getView(null, { revealAll: true }), ph = v.phase;
  // tiles
  var all = s.wall.slice();
  s.players.forEach(function (P) { all = all.concat(P.hand, P.flowers, P.discards); P.melds.forEach(function (m) { all = all.concat(m.tiles); }); });
  if (all.length !== 144) problem(ctx, 'tile count ' + all.length);
  var sorted = T.sort(all);
  for (var i = 0; i < 144; i++) if (sorted[i] !== FULL[i]) problem(ctx, 'tile multiset differs at ' + i);
  s.players.forEach(function (P) { P.flowers.forEach(function (f) { if (!T.isBonus(f)) problem(ctx, 'non-bonus tile among flowers'); }); P.hand.forEach(function (k) { if (T.isBonus(k)) problem(ctx, 'bonus tile left in a hand'); }); });
  // sizes
  var res = v.result;
  for (var p = 0; p < 4; p++) {
    var P = v.players[p], units = P.hand.length + 3 * P.melds.length, want = 13;
    if (ph === 'turn' && p === v.turn) want = 14;
    if (ph === 'robKong' && p === v.claimTile.from) want = 14;
    if ((ph === 'handEnd' || ph === 'gameEnd') && res && res.type === 'win' && p === res.winner) want = (res.source === 'flowers' && units === 13) ? 13 : 14;
    if (units !== want) problem(ctx, 'player ' + p + ' has ' + units + ' tile units in phase ' + ph + ' (want ' + want + ')');
    if (P.melds.length > 4) problem(ctx, 'more than 4 melds');
    P.melds.forEach(function (m) {
      var k = m.tiles[0];
      if (m.type === 'chow' && !(T.isSuit(k) && m.tiles[1] === k + 1 && m.tiles[2] === k + 2 && T.suitOf(k) === T.suitOf(k + 2))) problem(ctx, 'bad chow meld');
      if (m.type === 'chow' && m.from !== (p + 3) % 4) problem(ctx, 'chow claimed from player ' + m.from + ' by ' + p + ' (not from the left)');
      if (m.type !== 'chow' && m.tiles.some(function (x) { return x !== k; })) problem(ctx, 'bad set meld');
      if (m.type === 'pong' && m.tiles.length !== 3) problem(ctx, 'pong size');
      if (m.type === 'kong' && m.tiles.length !== 4) problem(ctx, 'kong size');
      if (m.concealed && (m.type !== 'kong' || m.from !== null)) problem(ctx, 'bad concealed meld');
    });
  }
  // scores
  var sum = s.scores.reduce(function (a, b) { return a + b; }, 0);
  if (Math.abs(sum - 4 * g.c.settings.startingScore) > 1e-6) problem(ctx, 'scores sum ' + sum);
  // offered actions follow the rules
  var pend = g.getPending();
  if (ph === 'turn') {
    var acts = g.getActions(v.turn);
    if (!acts.some(function (a) { return a.type === 'discard'; })) problem(ctx, 'turn without a discard option');
    acts.forEach(function (a) {
      if ((a.type === 'concealedKong' || a.type === 'addKong') && v.wallCount < 1) problem(ctx, 'kong offered with an empty wall');
      if (pend.afterClaim && a.type !== 'discard') problem(ctx, a.type + ' offered right after a chow/pong');
      if (/win/i.test(a.type) && !(a.evaluation && a.evaluation.valid && a.fan === a.evaluation.fan)) problem(ctx, 'invalid ' + a.type + ' offered');
      if (['win', 'kong', 'pong', 'chow', 'pass'].indexOf(a.type) >= 0) problem(ctx, a.type + ' offered on a turn');
    });
    if (!pend.afterClaim) checkTurnOptions(g, v, ctx, tr, acts);
  } else if (ph === 'claim' || ph === 'robKong') {
    var from = v.claimTile.from, t = v.claimTile.tile;
    if (ph === 'claim' && v.players[from].discards[v.players[from].discards.length - 1] !== t) problem(ctx, 'claim tile is not the last discard');
    if (!pend.waiting.length) problem(ctx, 'claim phase with nobody waiting');
    pend.waiting.forEach(function (q) {
      var a = g.getActions(q);
      if (q === from) problem(ctx, 'discarder asked to claim');
      if (!a.length || a[a.length - 1].type !== 'pass') problem(ctx, 'waiting player without pass');
      a.forEach(function (x) {
        if (x.type === 'chow' && q !== (from + 1) % 4) problem(ctx, 'chow offered not from the left');
        if (v.wallCount === 0 && x.type !== 'win' && x.type !== 'pass') problem(ctx, x.type + ' offered on the final discard');
        if (ph === 'robKong' && x.type !== 'win' && x.type !== 'pass') problem(ctx, x.type + ' offered on a robbing chance');
        if (x.type === 'win' && !(x.evaluation && x.evaluation.valid)) problem(ctx, 'invalid win offered');
      });
    });
  }
  // the view never leaks
  if (info.checkViews) {
    for (var vw = 0; vw < 4; vw++) {
      var w = g.getView(vw), live = w.phase !== 'handEnd' && w.phase !== 'gameEnd';
      for (var j = 0; j < 4; j++) {
        if (j === vw) continue;
        if (live && w.players[j].hand !== null) problem(ctx, 'view ' + vw + ' shows player ' + j + '\'s hand');
        if (w.players[j].drawn !== null) problem(ctx, 'view ' + vw + ' shows player ' + j + '\'s drawn tile');
      }
      if (w.players[vw].hand === null) problem(ctx, 'viewer cannot see their own hand');
      if (w.pending && w.pending.waiting && w.pending.waiting.some(function (q) { return q !== vw; })) problem(ctx, 'view ' + vw + ' reveals other claimants');
      if (JSON.stringify(w).indexOf('"wall":') >= 0) problem(ctx, 'view contains the wall');
      if (!live && w.result === null) problem(ctx, 'hand over but no result in the view');
      if (live && w.result !== null) problem(ctx, 'result shown mid-hand');
    }
  }
}

/** Turn: selfWin offered iff valid (flags re-derived from events); blockedWin; flowerWin offer rule. */
function checkTurnOptions(g, v, ctx, tr, acts) {
  var p = v.turn, P = v.players[p];
  var blessing = null;
  if (p === v.dealer) { if (tr.discards === 0 && !tr.interrupted) blessing = 'heaven'; }
  else if (tr.draws[p] === 1 && tr.chain[p] === 0 && !tr.interrupted) blessing = 'man';
  var winTile = P.drawn !== null ? P.drawn : P.hand[P.hand.length - 1];
  var ev = S.evaluate(ctxFor(v, p, P.hand.slice(), winTile, 'self', { kongReplacement: Math.min(tr.chain[p], 2), lastTile: v.wallCount === 0, blessing: blessing }));
  var sw = acts.filter(function (a) { return a.type === 'selfWin'; })[0];
  if (ev.winning && ev.valid) {
    if (!sw) problem(ctx, 'valid self-pick not offered (' + ev.fan + ' Fan, ' + T.format(P.hand) + ')');
    if (sw.fan !== ev.fan) problem(ctx, 'selfWin fan ' + sw.fan + ' != ' + ev.fan);
  } else if (sw) problem(ctx, 'selfWin offered but independent scoring says ' + (ev.winning ? ev.fan + ' Fan (invalid)' : 'not winning'));
  var bw = g.getView(p).blockedWin, wantB = (ev.winning && !ev.valid) ? { fan: ev.fan, minFan: v.settings.minFan } : null;
  if (JSON.stringify(bw) !== JSON.stringify(wantB)) problem(ctx, 'blockedWin ' + JSON.stringify(bw) + ' != ' + JSON.stringify(wantB));
  var fw = acts.some(function (a) { return a.type === 'flowerWin'; });
  var wantF = tr.offer[p] && tr.bonus[p] >= 7;
  if (fw !== wantF) problem(ctx, 'flowerWin offered=' + fw + ' expected=' + wantF + ' (bonus ' + tr.bonus[p] + ')');
  if (P.flowers.length !== tr.bonus[p]) problem(ctx, 'bonus count mismatch');
  var cnt = T.counts(P.hand), wantK = [];
  if (v.wallCount >= 1) {
    for (var k = 0; k < 34; k++) if (cnt[k] === 4) wantK.push('c' + k);
    P.melds.forEach(function (m) { if (m.type === 'pong' && cnt[m.tiles[0]]) wantK.push('a' + m.tiles[0]); });
  }
  var gotK = acts.filter(function (a) { return a.type === 'concealedKong' || a.type === 'addKong'; }).map(function (a) { return (a.type === 'concealedKong' ? 'c' : 'a') + a.tile; });
  if (JSON.stringify(gotK.sort()) !== JSON.stringify(wantK.sort())) problem(ctx, 'kong options ' + gotK + ' != ' + wantK);
}

/** Before a discard / addKong is applied: work out who must be asked, then compare with the engine afterwards. */
function expectAfter(g, p, a, tr) {
  var v = g.getView(null, { revealAll: true });
  if (a.type === 'discard') {
    var P = v.players[p], hand = P.hand.slice();
    hand.splice(hand.indexOf(a.tile), 1);
    var v2 = JSON.parse(JSON.stringify(v));
    v2.players[p].hand = hand;
    var trd = { discards: tr.discards + 1 };
    var exp = {};
    for (var i = 1; i < 4; i++) { var q = (p + i) % 4; var o = expectedClaim(v2, q, a.tile, p, trd); if (o.acts.length) exp[q] = o.acts; }
    return { kind: 'discard', from: p, tile: a.tile, exp: exp, wall: v.wallCount };
  }
  if (a.type === 'addKong') {
    var robbers = {};
    for (i = 1; i < 4; i++) {
      q = (p + i) % 4;
      var ev = S.evaluate(ctxFor(v, q, v.players[q].hand.concat([a.tile]), a.tile, 'robKong', {}));
      if (ev.winning && ev.valid) robbers[q] = [{ type: 'win', fan: ev.fan }, { type: 'pass' }];
    }
    return { kind: 'robKong', from: p, tile: a.tile, exp: robbers, wall: v.wallCount };
  }
  return null;
}
function checkExpectation(g, e, ctx) {
  if (!e) return;
  var pend = g.getPending();
  var want = Object.keys(e.exp).map(Number).sort(function (x, y) { return ((x - e.from + 4) % 4) - ((y - e.from + 4) % 4); });
  if (!want.length) {
    if (pend.type === 'claim' || pend.type === 'robKong') problem(ctx, 'claim phase although nobody can claim');
    if (e.kind === 'discard' && e.wall === 0 && !(pend.type === 'handEnd' && pend.result.type === 'draw' && pend.result.reason === 'finalDiscard')) problem(ctx, 'unclaimed final discard must end in a draw');
    return;
  }
  if (pend.type !== (e.kind === 'discard' ? 'claim' : 'robKong')) problem(ctx, 'expected a ' + e.kind + ' claim phase, got ' + pend.type);
  if (JSON.stringify(pend.waiting) !== JSON.stringify(want)) problem(ctx, 'waiting ' + JSON.stringify(pend.waiting) + ' != ' + JSON.stringify(want));
  want.forEach(function (q) {
    var got = g.getActions(q).map(function (a) { var o = { type: a.type }; if (a.tiles) o.tiles = a.tiles; if (a.fan !== undefined) o.fan = a.fan; return o; });
    if (brief(got) !== brief(e.exp[q])) problem(ctx, 'player ' + q + ' options [' + brief(got) + '] != expected [' + brief(e.exp[q]) + ']');
  });
}

function checkResult(g, r, ctx, before) {
  var set = g.c.settings;
  var sumPay = r.payments.reduce(function (a, b) { return a + b; }, 0);
  if (Math.abs(sumPay) > 1e-9) problem(ctx, 'payments do not sum to 0');
  for (var i = 0; i < 4; i++) if (Math.abs(r.scoresAfter[i] - (before.scores[i] + r.payments[i])) > 1e-9) problem(ctx, 'scoresAfter mismatch');
  var stays = r.type === 'draw' || r.winner === before.dealer;
  var nd = stays ? before.dealer : (before.dealer + 1) % 4;
  var nr = before.round + (!stays && nd === before.firstDealer ? 1 : 0);
  if (r.dealerStays !== stays || r.nextDealer !== nd || r.nextRound !== nr) problem(ctx, 'dealer rotation wrong');
  if (r.gameOver !== (nr >= set.rounds || r.handNo >= Game.MAX_HANDS)) problem(ctx, 'gameOver wrong');
  if (r.type === 'draw') {
    if (g.getView(0).wallCount !== 0) problem(ctx, 'draw game with tiles left in the wall');
    if (r.payments.some(function (x) { return x !== 0; })) problem(ctx, 'draw with payments');
    return;
  }
  var h = r.hands[r.winner], ev;
  var base = { melds: h.melds, seatWind: (r.winner - r.dealer + 4) % 4, roundWind: r.round, flowers: h.flowers,
    settings: { minFan: set.minFan, optional: set.optional } };
  if (r.source === 'flowers') ev = S.evaluate(Object.assign({ hand: h.hand, winTile: null, source: 'self', flowerWin: true }, base));
  else ev = S.evaluate(Object.assign({ hand: h.hand, winTile: r.winTile, source: r.source, kongReplacement: r.flags.kongReplacement,
    lastTile: r.flags.lastTile, blessing: r.flags.blessing, flowerWin: false }, base));
  if (!ev.winning || !ev.valid) problem(ctx, 'INVALID WIN recorded: ' + JSON.stringify({ hand: T.format(h.hand), src: r.source, fan: ev.fan }));
  if (ev.fan !== r.evaluation.fan || r.fan !== ev.fan) problem(ctx, 'win fan ' + r.evaluation.fan + ' != re-scored ' + ev.fan);
  if (!r.flags.blessing && r.source !== 'flowers' && ev.fan < set.minFan) problem(ctx, 'win below the minimum');
  var pay = S.payments({ fan: ev.fan, winner: r.winner, source: r.source === 'flowers' ? 'self' : r.source, payer: r.payer, payment: set.payment, unit: set.unit });
  if (JSON.stringify(pay) !== JSON.stringify(r.payments)) problem(ctx, 'payments ' + JSON.stringify(r.payments) + ' != ' + JSON.stringify(pay));
  if ((r.source === 'discard' || r.source === 'robKong') && (r.payer === null || r.payer === r.winner)) problem(ctx, 'bad payer');
  if (r.flags.blessing === 'earth' && r.payer !== r.dealer) problem(ctx, 'Earth not paid by the dealer');
  if (r.flags.blessing === 'heaven' && r.winner !== r.dealer) problem(ctx, 'Heaven for a non-dealer');
  if ((r.flags.blessing === 'earth' || r.flags.blessing === 'man') && r.winner === r.dealer) problem(ctx, 'Earth/Man for the dealer');
}

// ------------------------------------------------------------------------------------------------ one game
function settingsFor(seed, chaos) {
  var R = HKMJ.RNG('settings-' + seed);
  var minFans = [0, 1, 2, 3, 3, 3, 3, 4, 5];
  return {
    minFan: minFans[R.int(minFans.length)],
    payment: R.next() < 0.3 ? 'shared' : 'full',
    unit: R.next() < 0.3 ? 'chips' : 'points',
    rounds: chaos ? 1 : (seed % 10 === 0 ? 4 : 1),
    startingScore: R.next() < 0.3 ? 1000 : 0,
    optional: { kong: R.next() < 0.3, sevenPairs: R.next() < 0.85, luxurySevenPairs: R.next() < 0.8, knitted: R.next() < 0.8,
      lesserHonours: R.next() < 0.8, greaterHonours: R.next() < 0.8 }
  };
}

function playGame(seed, chaos) {
  var settings = settingsFor(seed, chaos);
  var levels = [0, 1, 2, 3].map(function (i) { return LEVELS[(seed + i) % 3]; });
  var chaosSeats = chaos ? [seed % 4, (seed + 2) % 4] : [];
  var g = new Game({ seed: seed + (chaos ? 100000 : 0), settings: settings, humans: [] });
  var tr = new Tracker();
  var unsub = g.on(function (e) { tr.on(e); });
  var aiRng = HKMJ.RNG('ai-' + seed + (chaos ? '-c' : ''));
  var ctx = (chaos ? 'chaos' : 'game') + ' seed ' + seed;
  var r = g.start();
  if (!r.ok) problem(ctx, 'start failed: ' + r.error);
  var steps = 0, hands = 0, before = snap(g);
  function snap(x) { var v = x.getView(0); return { scores: x.s.scores.slice(), dealer: v.dealer, round: v.round, firstDealer: v.firstDealer, repeat: v.dealerRepeat }; }
  var checkViews = chaos || seed % 3 === 0;
  checkState(g, ctx + ' start', tr, { checkViews: true });
  while (true) {
    if (++steps > MAX_STEPS_PER_GAME) problem(ctx, 'game does not terminate');
    var pend = g.getPending(), sctx = ctx + ' hand ' + g.s.handNo + ' step ' + steps;
    if (pend.type === 'gameEnd') break;
    if (pend.type === 'handEnd') {
      var res = pend.result;
      checkResult(g, res, sctx, before);
      hands++; stats.hands++;
      if (chaos) stats.chaosHands++;
      if (res.type === 'draw') stats.draws++;
      else {
        stats.wins++;
        stats.bySource[res.source] = (stats.bySource[res.source] || 0) + 1;
        if (res.flags.blessing) stats.blessings[res.flags.blessing] = (stats.blessings[res.flags.blessing] || 0) + 1;
        if (res.source === 'flowers') stats.flowerWins++;
        if (res.source === 'robKong') stats.robs++;
        if (res.flags.kongReplacement === 1) stats.kongRepl++;
        if (res.flags.kongReplacement === 2) stats.doubleKong++;
        if (res.flags.lastTile) stats.moon++;
        if (res.bumped.length) stats.headBumps++;
        if (res.fan >= 13) stats.limit++;
        stats.fanSum += res.fan;
      }
      var n = g.nextHand();
      if (!n.ok) problem(sctx, 'nextHand failed: ' + n.error);
      if (g.getPending().type !== 'gameEnd') {
        var v = g.getView(0);
        var wantDealer = res.nextDealer, wantRound = res.dealerStays ? before.round : res.nextRound;
        var wantRepeat = res.dealerStays ? before.repeat + 1 : 0;
        if (v.dealer !== wantDealer || v.round !== wantRound || v.dealerRepeat !== wantRepeat) problem(sctx, 'next hand dealer/round/repeat wrong');
        if (v.handNo !== res.handNo + 1) problem(sctx, 'handNo not advanced');
      } else if (!res.gameOver) problem(sctx, 'game ended although the result said it goes on');
      before = snap(g);
      checkState(g, sctx + ' after nextHand', tr, { checkViews: checkViews });
      continue;
    }
    var p = pend.type === 'turn' ? pend.player : pend.waiting[0];
    var acts = g.getActions(p);
    if (!acts.length) problem(sctx, 'pending decision for ' + p + ' without actions');
    var choice;
    if (chaosSeats.indexOf(p) >= 0) {
      var wins = acts.filter(function (a) { return /win/i.test(a.type); });
      choice = (wins.length && aiRng.next() < 0.75) ? wins[0] : acts[aiRng.int(acts.length)];
    } else {
      var t0 = process.hrtime();
      try { choice = HKMJ.AI.decide(g.getView(p), acts, { level: levels[p], rng: aiRng }); }
      catch (e) { problem(sctx, 'AI.decide threw: ' + (e && e.stack || e)); }
      var dt = process.hrtime(t0); stats.aiTimes[levels[p]].push(dt[0] * 1e3 + dt[1] / 1e6);
      if (!acts.some(function (a) { return sameAction(a, choice); })) problem(sctx, 'AI returned an action that is not in actions: ' + JSON.stringify(choice && { type: choice.type, tile: choice.tile, tiles: choice.tiles }));
      if (acts.some(function (a) { return /win/i.test(a.type); }) && !/win/i.test(choice.type)) problem(sctx, 'AI declined a valid win');
    }
    var exp = expectAfter(g, p, choice, tr);
    var offered = pend.type === 'turn' && acts.some(function (a) { return a.type === 'flowerWin'; });
    var ar;
    try { ar = g.act(p, { type: choice.type, tile: choice.tile, tiles: choice.tiles }); }
    catch (e) { problem(sctx, 'act threw: ' + (e && e.stack || e)); }
    if (!ar || !ar.ok) problem(sctx, 'legal action rejected: ' + JSON.stringify({ type: choice.type, tile: choice.tile }) + ' -> ' + (ar && ar.error));
    if (offered && choice.type !== 'flowerWin') tr.offer[p] = false;
    stats.steps++;
    checkExpectation(g, exp, sctx);
    checkState(g, sctx, tr, { checkViews: checkViews });
    if (g._evalErrors) problem(sctx, 'engine reported hand/scoring evaluation errors');
    if (steps % 211 === 0) {                                                // save/resume swap mid-game
      var json = g.serialize(), g2 = Game.deserialize(json);
      if (g2.serialize() !== json) problem(sctx, 'serialize/deserialize is not a round trip');
      unsub(); g = g2; unsub = g.on(function (e) { tr.on(e); });
      stats.saves++;
    }
  }
  var st = g.getPending().standings;
  if (!st || st.length !== 4) problem(ctx, 'no standings at game end');
  var sum = st.reduce(function (a, e) { return a + e.score; }, 0);
  if (Math.abs(sum - 4 * settings.startingScore) > 1e-6) problem(ctx, 'final scores do not sum');
  stats.games++;
  if (chaos) stats.chaosGames++;
  stats.maxHandsInGame = Math.max(stats.maxHandsInGame, hands);
  stats.kongs += tr.allKongs;
  Object.keys(tr.allClaims).forEach(function (k) { stats.claims[k] = (stats.claims[k] || 0) + tr.allClaims[k]; });
  return g.serialize();
}

// ------------------------------------------------------------------------------------------------ run
var t0 = Date.now(), done = 0, crashed = 0;
function runOne(seed, chaos) {
  try { playGame(seed, chaos); done++; }
  catch (e) {
    crashed++;
    if (!(e instanceof SimError)) { failures.push((chaos ? 'chaos' : 'game') + ' seed ' + seed + ': EXCEPTION ' + (e && e.stack || e)); console.log('FAIL exception seed ' + seed + ': ' + (e && e.stack || e)); }
  }
}
for (var seed = 1; seed <= GAMES; seed++) {
  runOne(seed, false);
  if (VERBOSE && seed % 25 === 0) console.log('  ' + seed + ' games, ' + stats.hands + ' hands, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
for (seed = 1; seed <= CHAOS; seed++) runOne(seed, true);
// determinism: the same seed replays to the same final state
[3, 7].forEach(function (sd) {
  try {
    var a = playGame(sd, false), b = playGame(sd, false);
    stats.games -= 2;
    if (a !== b) { failures.push('determinism seed ' + sd); console.log('FAIL determinism seed ' + sd); }
  } catch (e) { failures.push('determinism seed ' + sd + ': ' + (e.message || e)); }
});

function pct(a, q) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; }
function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
var secs = (Date.now() - t0) / 1000;
console.log('\nSimulation: ' + (stats.games - stats.chaosGames) + ' AI games + ' + stats.chaosGames + ' chaos games completed (' + crashed + ' failed), ' +
  stats.hands + ' hands, ' + stats.steps + ' steps, every step checked, ' + secs.toFixed(1) + ' s');
console.log('  wins ' + stats.wins + ' (' + (100 * stats.wins / Math.max(1, stats.hands)).toFixed(1) + '%), draws ' + stats.draws +
  ', by source ' + JSON.stringify(stats.bySource) + ', mean fan ' + (stats.fanSum / Math.max(1, stats.wins)).toFixed(2) + ', limit hands ' + stats.limit);
console.log('  blessings ' + JSON.stringify(stats.blessings) + ', flower wins ' + stats.flowerWins + ', robbed kongs ' + stats.robs +
  ', kong-replacement wins ' + stats.kongRepl + ', double kong ' + stats.doubleKong + ', moon ' + stats.moon + ', head bumps ' + stats.headBumps);
console.log('  claimed melds ' + JSON.stringify(stats.claims) + ', kongs declared ' + stats.kongs + ', save/resume swaps ' + stats.saves + ', max hands in a game ' + stats.maxHandsInGame);
LEVELS.forEach(function (l) {
  var a = stats.aiTimes[l];
  if (a.length) console.log('  AI ' + l + ': ' + a.length + ' decisions, mean ' + mean(a).toFixed(2) + ' ms, p95 ' + pct(a, 0.95).toFixed(2) + ' ms, max ' + pct(a, 1).toFixed(1) + ' ms');
});
console.log('\nsim.test: ' + (done - (failures.length ? 0 : 0)) + ' games passed, ' + failures.length + ' failed' + (STUBBED.length ? ' [STUBS: ' + STUBBED.join(',') + ']' : ''));
process.exit(failures.length ? 1 : 0);
