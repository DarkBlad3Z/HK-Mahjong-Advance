#!/usr/bin/env node
/* HK Mahjong — tests/ai_sim.js  (Owner: back end)
 * AI self-play statistics (SPEC §7.5).  Not part of run_all (it is a long simulation).
 *
 *   node tests/ai_sim.js                 -> both parts below (about 3-4 minutes)
 *   node tests/ai_sim.js --part normal   -> 4 normal AIs, minFan 3: win / draw rate, mean winning Fan   [--games 150]
 *   node tests/ai_sim.js --part hardeasy -> 1 hard vs 3 easy, East-round games: mean scores            [--games 200]
 *   node tests/ai_sim.js --part vs --a hard --b normal  -> 2 vs 2 (seats ABAB / BABA on the same deals)  [--games 100]
 *   node tests/ai_sim.js --calibrate     -> how well the defence model's numbers match what happens
 *   --seed N  first seed (default 1)      --rounds 1|4  (default 1 = East round)
 * Exit code 1 if an acceptance check fails (normal win rate < 50%, hard not clearly above easy).
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', 'src', 'core');
['tiles.js', 'rng.js', 'hand.js', 'scoring.js', 'engine.js', 'ai.js'].forEach(function (f) { require(path.join(CORE, f)); });
var HK = globalThis.HKMJ, AI = HK.AI, S = HK.Scoring;

var args = process.argv.slice(2);
function arg(n, d) { var i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }
var PART = arg('part', 'all'), SEED = +arg('seed', 1), ROUNDS = +arg('rounds', 1);
var CAL = args.indexOf('--calibrate') >= 0;
var failures = 0;

function stats(xs) {
  var n = xs.length, m = xs.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, n);
  var sd = n > 1 ? Math.sqrt(xs.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (n - 1)) : 0;
  return { n: n, mean: m, se: n ? sd / Math.sqrt(n) : 0 };
}
function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0; }

/** play one game; seatLevel[p] = level; returns {scores, hands:[results], times:{level:[ms]}} */
function playGame(seed, seatLevel, settings, onDecision) {
  var game = new HK.Game({ seed: seed, humans: [], firstDealer: 0, settings: Object.assign({ rounds: ROUNDS, minFan: 3 }, settings || {}) });
  game.start();
  var rng = HK.RNG('sim-' + seed + '-' + seatLevel.join(''));
  var results = [], times = {};
  for (var guard = 0; guard < 100000; guard++) {
    var pd = game.getPending();
    if (pd.type === 'gameEnd') break;
    if (pd.type === 'handEnd') { results.push(pd.result); game.nextHand(); continue; }
    var ps = pd.type === 'turn' ? [pd.player] : pd.waiting.slice();
    for (var q = 0; q < ps.length; q++) {
      var p = ps[q], v = game.getView(p);
      var t0 = process.hrtime.bigint();
      var a = AI.decide(v, v.actions, { level: seatLevel[p], rng: rng });
      var ms = Number(process.hrtime.bigint() - t0) / 1e6;
      (times[seatLevel[p]] || (times[seatLevel[p]] = [])).push(ms);
      if (onDecision) onDecision(game, p, v, a);
      var r = game.act(p, a);
      if (!r.ok) throw new Error('illegal AI action ' + JSON.stringify(a) + ': ' + r.error);
    }
  }
  return { scores: game.getView(0).players.map(function (x) { return x.score; }), hands: results, times: times };
}
function mergeTimes(into, t) { Object.keys(t).forEach(function (l) { into[l] = (into[l] || []).concat(t[l]); }); }
function printTimes(all) {
  Object.keys(all).sort().forEach(function (l) {
    var xs = all[l].slice().sort(function (a, b) { return a - b; });
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    console.log('  decision time ' + (l + '      ').slice(0, 7) + ': ' + xs.length + ' decisions, mean ' + mean.toFixed(2) + ' ms, p50 ' + pct(xs, 0.5).toFixed(2) +
      ', p95 ' + pct(xs, 0.95).toFixed(2) + ', p99 ' + pct(xs, 0.99).toFixed(2) + ', max ' + xs[xs.length - 1].toFixed(1) + ' ms');
  });
}

// ------------------------------------------------------------------------------------------------ 4 normal AIs
function partNormal() {
  var games = +arg('games', 150), hands = 0, wins = 0, fan = 0, self = 0, limit = 0, times = {}, patterns = {}, hist = {};
  var t0 = Date.now();
  for (var g = 0; g < games; g++) {
    var r = playGame(SEED + g, ['normal', 'normal', 'normal', 'normal']);
    mergeTimes(times, r.times);
    r.hands.forEach(function (h) {
      hands++;
      if (h.type !== 'win') return;
      wins++; fan += h.evaluation.fan; if (h.source === 'self') self++; if (h.evaluation.fan >= 13) limit++;
      patterns[h.evaluation.pattern] = (patterns[h.evaluation.pattern] || 0) + 1;
      hist[h.evaluation.fan] = (hist[h.evaluation.fan] || 0) + 1;
    });
  }
  console.log('4 x normal, minFan 3, ' + games + ' East-round games, ' + hands + ' hands (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  console.log('  hands won ' + (100 * wins / hands).toFixed(1) + '%, draws ' + (100 * (hands - wins) / hands).toFixed(1) + '%, mean winning Fan ' + (fan / wins).toFixed(2) +
    ', self-picks ' + (100 * self / wins).toFixed(0) + '% of wins, limit hands ' + limit);
  console.log('  Fan histogram ' + JSON.stringify(hist) + '  patterns ' + JSON.stringify(patterns));
  printTimes(times);
  var okWin = wins / hands >= 0.5;
  console.log('  CHECK >= 50% of hands end in a win: ' + (okWin ? 'PASS' : 'FAIL'));
  if (!okWin) failures++;
}

// ------------------------------------------------------------------------------------------------ 1 hard vs 3 easy
function partHardEasy() {
  var games = +arg('games', 200), hard = [], easy = [], diff = [], times = {}, t0 = Date.now(), hands = 0, hw = 0, ew = 0;
  for (var g = 0; g < games; g++) {
    var seat = g % 4, lv = ['easy', 'easy', 'easy', 'easy'];
    lv[seat] = 'hard';
    var r = playGame(SEED + 1000 + Math.floor(g / 4), lv);
    mergeTimes(times, r.times);
    var e = 0;
    for (var i = 0; i < 4; i++) if (i !== seat) { easy.push(r.scores[i]); e += r.scores[i]; }
    hard.push(r.scores[seat]);
    diff.push(r.scores[seat] - e / 3);
    r.hands.forEach(function (h) { hands++; if (h.type === 'win') { if (h.winner === seat) hw++; else ew++; } });
  }
  var H = stats(hard), E = stats(easy), D = stats(diff);
  console.log('1 hard vs 3 easy, ' + games + ' East-round games (hard rotates through the seats), ' + hands + ' hands (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  console.log('  mean score: hard ' + H.mean.toFixed(1) + ' ± ' + H.se.toFixed(1) + ', easy ' + E.mean.toFixed(1) + ' ± ' + E.se.toFixed(1) +
    '; hard minus easy average ' + D.mean.toFixed(1) + ' ± ' + D.se.toFixed(1) + ' (1 s.e.)');
  console.log('  hands won: hard ' + (100 * hw / hands).toFixed(1) + '%, each easy ' + (100 * ew / hands / 3).toFixed(1) + '%');
  printTimes(times);
  var okHard = D.mean > 3 * D.se && D.mean > 0;
  console.log('  CHECK hard clearly above easy (difference > 3 s.e.): ' + (okHard ? 'PASS' : 'FAIL'));
  if (!okHard) failures++;
}

// ------------------------------------------------------------------------------------------------ level A vs level B
function partVs() {
  var A = arg('a', 'hard'), B = arg('b', 'normal'), games = +arg('games', 100), diff = [], t0 = Date.now();
  for (var g = 0; g < games; g++) {
    var d = 0;
    ['ABAB', 'BABA'].forEach(function (pat) {
      var lv = pat.split('').map(function (x) { return x === 'A' ? A : B; });
      var r = playGame(SEED + 2000 + g, lv);
      for (var i = 0; i < 4; i++) d += (pat[i] === 'A' ? 1 : -1) * r.scores[i];
    });
    diff.push(d / 4);
  }
  var D = stats(diff);
  console.log(A + ' vs ' + B + ' (2 v 2, seats swapped on the same deals), ' + games + ' deals x 2 games (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  console.log('  ' + A + ' minus ' + B + ' per seat and game: ' + D.mean.toFixed(1) + ' ± ' + D.se.toFixed(1) + ' (1 s.e.)');
}

// ------------------------------------------------------------------------------------------------ calibration of the defence model
function calibrate() {
  var games = +arg('games', 40), ready = {}, bins = {}, discards = 0, dealt = 0, pred = 0;
  var pending = null;
  for (var g = 0; g < games; g++) {
    var game = new HK.Game({ seed: SEED + 3000 + g, humans: [], settings: { rounds: 1 } });
    game.start();
    var rng = HK.RNG(g);
    for (var guard = 0; guard < 100000; guard++) {
      var pd = game.getPending();
      if (pd.type === 'gameEnd') break;
      if (pd.type === 'handEnd') {
        var res = pd.result;
        if (pending) { pending.won = res.type === 'win' && res.source === 'discard' && res.payer === pending.p && res.winTile === pending.tile ? 1 : 0; tally(pending); pending = null; }
        game.nextHand(); continue;
      }
      if (pd.type === 'turn' && pending) { pending.won = 0; tally(pending); pending = null; }
      var ps = pd.type === 'turn' ? [pd.player] : pd.waiting.slice();
      for (var q = 0; q < ps.length; q++) {
        var p = ps[q], v = game.getView(p), a = AI.decide(v, v.actions, { level: 'normal', rng: rng });
        if (a.type === 'discard') {
          var st = AI._readState(v, AI.LEVELS.normal), full = game.getView(p, { revealAll: true }), out = { p: 0 };
          AI._danger(st, a.tile, out);
          st.opps.forEach(function (o) {
            var qv = full.players[o.p], sh = HK.Hand.shanten(qv.hand, qv.melds.length, v.settings.optional);
            var key = o.nm + ':' + Math.min(18, qv.discards.length + o.nm);
            var e = ready[key] || (ready[key] = [0, 0, 0]); e[0]++; e[1] += o.pReady; if (sh === 0) e[2]++;
          });
          pending = { p: p, tile: a.tile, pd: out.p };
        }
        game.act(p, a);
      }
    }
  }
  function tally(x) {
    discards++; dealt += x.won; pred += x.pd;
    var b = x.pd < 0.01 ? '<1%' : x.pd < 0.02 ? '1-2%' : x.pd < 0.04 ? '2-4%' : x.pd < 0.08 ? '4-8%' : '>=8%';
    var e = bins[b] || (bins[b] = [0, 0, 0]); e[0]++; e[1] += x.pd; e[2] += x.won;
  }
  console.log('defence calibration over ' + games + ' games (normal AIs):');
  console.log('  deal-in per discard: predicted ' + (100 * pred / discards).toFixed(2) + '%, actual ' + (100 * dealt / discards).toFixed(2) + '% (' + discards + ' discards)');
  ['<1%', '1-2%', '2-4%', '4-8%', '>=8%'].forEach(function (b) { var e = bins[b]; if (e) console.log('    predicted ' + b + ': n=' + e[0] + ' mean predicted ' + (100 * e[1] / e[0]).toFixed(2) + '%, actual ' + (100 * e[2] / e[0]).toFixed(2) + '%'); });
  console.log('  opponent ready (shanten 0) by melds:turns — predicted vs actual (n >= 200):');
  Object.keys(ready).sort().forEach(function (k) { var e = ready[k]; if (e[0] >= 200) console.log('    ' + k + ' n=' + e[0] + ' predicted ' + (e[1] / e[0]).toFixed(2) + ' actual ' + (e[2] / e[0]).toFixed(2)); });
}

if (CAL) calibrate();
else {
  if (PART === 'all' || PART === 'normal') partNormal();
  if (PART === 'all' || PART === 'hardeasy') partHardEasy();
  if (PART === 'vs') partVs();
  console.log(failures ? 'ai_sim: ' + failures + ' check(s) FAILED' : 'ai_sim: all checks passed');
  process.exit(failures ? 1 : 0);
}
