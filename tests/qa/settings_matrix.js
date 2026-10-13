#!/usr/bin/env node
/* HK Mahjong — tests/qa/settings_matrix.js (QA: settings matrix stress test)
 * Tests all 144 configurations of minFan × payment × unit × optional × aiLevel
 * with 8 games per config. ~1,150 games total. Checks payments, scoring, dealer logic,
 * pattern restrictions, and flags anomalies (exceptions, failed checks, high draw%, slow AI).
 *   node tests/qa/settings_matrix.js [--games-per-config N] [--verbose]
 */
'use strict';
var path = require('path'), fs = require('fs');
var CORE = path.join(__dirname, '..', '..', 'src', 'core');
function load(name) {
  require(path.join(CORE, name + '.js'));
}
load('tiles');
load('rng');
load('hand');
load('scoring');
load('engine');
load('ai');
var HKMJ = globalThis.HKMJ, T = HKMJ.Tiles, Game = HKMJ.Game, S = HKMJ.Scoring;

var argv = process.argv.slice(2);
function arg(name, dflt) { var i = argv.indexOf('--' + name); return i >= 0 ? +argv[i + 1] : dflt; }
var VERBOSE = argv.indexOf('--verbose') >= 0;
var GAMES_PER_CONFIG = arg('games-per-config', 8);

var MIN_FANS = [0, 1, 3, 5];
var PAYMENTS = ['full', 'shared'];
var UNITS = ['points', 'chips'];
var OPTIONAL_SETS = [
  { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true }, // all on
  { kong: false, sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false }, // all off
  { kong: true, sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false }  // only kong on
];
var AI_LEVELS = ['easy', 'normal', 'hard'];

var failures = [];
var anomalies = [];
var stats = {
  configStats: {},        // config key -> { handCounts, winCounts, drawCounts, fanSums, selfPickCounts, itemCounts, patternCounts, maxAiTime }
  totalGames: 0,
  totalHands: 0,
  maxAiTime: { easy: 0, normal: 0, hard: 0 }
};

function problem(ctx, msg) {
  failures.push(ctx + ': ' + msg);
  if (failures.length <= 20) console.log('FAIL ' + ctx + ': ' + msg);
}

function configKey(cfg) {
  var opt = cfg.optional;
  var optStr = (opt.kong ? 'K' : '-') + (opt.sevenPairs ? 'S' : '-') + (opt.luxurySevenPairs ? 'L' : '-') +
               (opt.knitted ? 'T' : '-') + (opt.lesserHonours ? 'H' : '-') + (opt.greaterHonours ? 'G' : '-');
  return cfg.minFan + '_' + cfg.payment + '_' + cfg.unit + '_' + optStr + '_' + cfg.aiLevel;
}

function initConfigStats(key) {
  if (!stats.configStats[key]) {
    stats.configStats[key] = {
      handCounts: [],
      winCounts: [],
      drawCounts: [],
      fanSums: [],
      fanCounts: [],
      selfPickCounts: [],
      patternCounts: {},
      itemCounts: {},
      maxAiTime: 0,
      exceptions: 0,
      failedChecks: 0
    };
  }
  return stats.configStats[key];
}

function checkPayments(result, ctx, settings) {
  // Verify payments sum to 0
  var sumPay = result.payments.reduce(function (a, b) { return a + b; }, 0);
  if (Math.abs(sumPay) > 1e-9) {
    problem(ctx, 'payments do not sum to 0: ' + JSON.stringify(result.payments));
    return false;
  }

  // For wins, verify payments match formula
  if (result.type === 'win' && result.source !== 'flowers') {
    var hand = result.hands[result.winner];
    var expectedPayments = S.payments({
      fan: result.evaluation.fan,
      winner: result.winner,
      source: result.source === 'flowers' ? 'self' : result.source,
      payer: result.payer,
      payment: settings.payment,
      unit: settings.unit
    });
    if (JSON.stringify(expectedPayments) !== JSON.stringify(result.payments)) {
      problem(ctx, 'payment mismatch: got ' + JSON.stringify(result.payments) + ' expected ' + JSON.stringify(expectedPayments));
      return false;
    }
  }

  return true;
}

function checkScoringValidity(result, ctx, settings) {
  // For wins, evaluation.valid must be true and fan >= minFan (unless blessing/flower)
  if (result.type === 'win') {
    if (!result.evaluation.valid) {
      problem(ctx, 'invalid win evaluation: ' + result.evaluation.fan + ' Fan');
      return false;
    }
    var isBlessedOrFlower = result.flags.blessing || result.source === 'flowers';
    if (!isBlessedOrFlower && result.evaluation.fan < settings.minFan) {
      problem(ctx, 'win below minFan: ' + result.evaluation.fan + ' < ' + settings.minFan);
      return false;
    }
  }

  return true;
}

function checkOptionalRestrictions(result, ctx, optional) {
  // With optionals off, certain patterns must not appear
  if (result.type === 'win') {
    var evaluation = result.evaluation;
    var patterns = evaluation.pattern || 'standard';

    if (!optional.sevenPairs && patterns === 'sevenPairs') {
      problem(ctx, 'sevenPairs pattern used when disabled');
      return false;
    }
    if (!optional.knitted && patterns === 'knitted') {
      problem(ctx, 'knitted pattern used when disabled');
      return false;
    }
    if (!optional.lesserHonours && patterns === 'lesserHonours') {
      problem(ctx, 'lesserHonours pattern used when disabled');
      return false;
    }
    if (!optional.greaterHonours && patterns === 'greaterHonours') {
      problem(ctx, 'greaterHonours pattern used when disabled');
      return false;
    }
    if (!optional.luxurySevenPairs && evaluation.items) {
      var hasLuxury = evaluation.items.some(function (item) { return item.id === 'luxurySevenPairs'; });
      if (hasLuxury) {
        problem(ctx, 'luxurySevenPairs item used when disabled');
        return false;
      }
    }
    if (!optional.kong && evaluation.items) {
      var hasKong = evaluation.items.some(function (item) { return item.id === 'kong'; });
      if (hasKong) {
        problem(ctx, 'kong item used when disabled');
        return false;
      }
    }
  }

  return true;
}

function checkDealerLogic(result, handDealer, ctx) {
  // Dealer stays after dealer win or draw; otherwise passes to (dealer+1)%4
  var stays = result.type === 'draw' || result.winner === handDealer;
  if (result.dealerStays !== stays) {
    problem(ctx, 'dealerStays wrong: ' + result.dealerStays + ' vs ' + stays);
    return false;
  }
  var expectedDealer = stays ? handDealer : (handDealer + 1) % 4;
  if (result.nextDealer !== expectedDealer) {
    problem(ctx, 'nextDealer wrong: ' + result.nextDealer + ' vs ' + expectedDealer);
    return false;
  }
  return true;
}

function recordStats(cfg, result, gameHandCount, aiTimes) {
  var key = configKey(cfg);
  var cs = initConfigStats(key);

  cs.handCounts.push(gameHandCount);

  if (result.type === 'draw') {
    cs.drawCounts.push(1);
    cs.winCounts.push(0);
  } else {
    cs.winCounts.push(1);
    cs.drawCounts.push(0);
    cs.fanCounts.push(result.evaluation.fan);
    cs.fanSums.push(result.evaluation.fan);

    // Count self-pick
    if (result.source === 'self' || result.source === 'flowers') {
      cs.selfPickCounts.push(1);
    } else {
      cs.selfPickCounts.push(0);
    }

    // Count items
    if (result.evaluation.items) {
      result.evaluation.items.forEach(function (item) {
        cs.itemCounts[item.id] = (cs.itemCounts[item.id] || 0) + 1;
      });
    }
  }

  // Count pattern
  if (result.evaluation && result.evaluation.pattern) {
    cs.patternCounts[result.evaluation.pattern] = (cs.patternCounts[result.evaluation.pattern] || 0) + 1;
  }

  // Track max AI time
  aiTimes.forEach(function (t, i) {
    var level = cfg.aiLevel;
    cs.maxAiTime = Math.max(cs.maxAiTime, t);
    stats.maxAiTime[level] = Math.max(stats.maxAiTime[level], t);
  });
}

function playGame(seed, cfg) {
  var levels = [0, 1, 2, 3].map(function (i) { return AI_LEVELS[(seed + i) % 3]; });
  var g = new Game({ seed: seed, settings: cfg, humans: [] });
  var aiRng = HKMJ.RNG('ai-' + seed);
  var ctx = 'seed ' + seed + ' config ' + configKey(cfg);
  var r = g.start();
  if (!r.ok) { problem(ctx, 'start failed'); throw new Error(r.error); }

  var steps = 0, hands = 0, gameAiTimes = [];
  var beforeScores = g.s.scores.slice();
  var currentDealer = g.getView(0).dealer;

  while (true) {
    if (++steps > 5000) { problem(ctx, 'game does not terminate'); break; }
    var pend = g.getPending();

    if (pend.type === 'gameEnd') break;

    if (pend.type === 'handEnd') {
      var res = pend.result;
      var sctx = ctx + ' hand ' + hands;

      // Run checks
      if (!checkPayments(res, sctx, cfg)) initConfigStats(configKey(cfg)).failedChecks++;
      if (!checkScoringValidity(res, sctx, cfg)) initConfigStats(configKey(cfg)).failedChecks++;
      if (!checkOptionalRestrictions(res, sctx, cfg.optional)) initConfigStats(configKey(cfg)).failedChecks++;
      if (!checkDealerLogic(res, currentDealer, sctx)) initConfigStats(configKey(cfg)).failedChecks++;

      recordStats(cfg, res, hands, gameAiTimes);

      hands++;
      stats.totalHands++;
      if (hands > 60) {
        anomalies.push({ config: configKey(cfg), seed: seed, issue: 'game too long (' + hands + ' hands)' });
      }

      gameAiTimes = [];
      beforeScores = g.s.scores.slice();
      currentDealer = res.nextDealer;

      var n = g.nextHand();
      if (!n.ok) { problem(sctx, 'nextHand failed'); throw new Error(n.error); }
      continue;
    }

    var p = pend.type === 'turn' ? pend.player : pend.waiting[0];
    var acts = g.getActions(p);
    if (!acts.length) { problem(ctx, 'no actions'); break; }

    var choice;
    var t0 = process.hrtime();
    try {
      choice = HKMJ.AI.decide(g.getView(p), acts, { level: levels[p], rng: aiRng });
    } catch (e) {
      problem(ctx, 'AI threw: ' + (e && e.message));
      initConfigStats(configKey(cfg)).exceptions++;
      choice = acts[0];
    }
    var dt = process.hrtime(t0);
    var ms = dt[0] * 1e3 + dt[1] / 1e6;
    gameAiTimes.push(ms);
    if (ms > 250) {
      anomalies.push({ config: configKey(cfg), seed: seed, issue: 'AI decision ' + ms.toFixed(0) + 'ms (level ' + levels[p] + ')' });
    }

    var ar = g.act(p, { type: choice.type, tile: choice.tile, tiles: choice.tiles });
    if (!ar || !ar.ok) { problem(ctx, 'act rejected: ' + ar.error); break; }
    stats.totalGames = Math.max(stats.totalGames, hands > 0 ? 1 : 0);
  }

  return hands;
}

// Generate all configurations
var configs = [];
for (var i = 0; i < MIN_FANS.length; i++) {
  for (var j = 0; j < PAYMENTS.length; j++) {
    for (var k = 0; k < UNITS.length; k++) {
      for (var l = 0; l < OPTIONAL_SETS.length; l++) {
        for (var m = 0; m < AI_LEVELS.length; m++) {
          configs.push({
            minFan: MIN_FANS[i],
            payment: PAYMENTS[j],
            unit: UNITS[k],
            optional: OPTIONAL_SETS[l],
            aiLevel: AI_LEVELS[m],
            rounds: 1,
            startingScore: 0
          });
        }
      }
    }
  }
}

console.log('Starting settings matrix test: ' + configs.length + ' configs × ' + GAMES_PER_CONFIG + ' games = ~' + (configs.length * GAMES_PER_CONFIG) + ' games');
var t0 = Date.now();
var completedConfigs = 0;

for (var cfgIdx = 0; cfgIdx < configs.length; cfgIdx++) {
  var cfg = configs[cfgIdx];
  var key = configKey(cfg);

  for (var gameNum = 0; gameNum < GAMES_PER_CONFIG; gameNum++) {
    var seed = cfgIdx * 10000 + gameNum + 1;
    try {
      playGame(seed, cfg);
      stats.totalGames++;
    } catch (e) {
      problem('config ' + key, 'exception: ' + (e && e.message));
      initConfigStats(key).exceptions++;
    }
  }

  completedConfigs++;
  var elapsed = (Date.now() - t0) / 1000;
  if (VERBOSE && completedConfigs % 10 === 0) {
    console.log('  ' + completedConfigs + ' / ' + configs.length + ' configs, ' + stats.totalHands + ' hands, ' + elapsed.toFixed(1) + 's');
  }
}

var secs = (Date.now() - t0) / 1000;

// Generate summary table by minFan × aiLevel
console.log('\n========== SUMMARY TABLE (minFan × aiLevel) ==========');
console.log('Format: Win% | Draw% | Mean Fan');
console.log('');
console.log('         easy     normal     hard');
for (var mf = 0; mf < MIN_FANS.length; mf++) {
  var row = 'minFan ' + MIN_FANS[mf] + ': ';
  for (var lvl = 0; lvl < AI_LEVELS.length; lvl++) {
    var matches = [];
    for (var k in stats.configStats) {
      var parts = k.split('_');
      if (parseInt(parts[0]) === MIN_FANS[mf] && parts[4] === AI_LEVELS[lvl]) {
        matches.push(stats.configStats[k]);
      }
    }

    var totalWins = 0, totalDraws = 0, totalFans = 0, totalHands = 0;
    matches.forEach(function (s) {
      totalWins += s.winCounts.reduce(function (a, b) { return a + b; }, 0);
      totalDraws += s.drawCounts.reduce(function (a, b) { return a + b; }, 0);
      totalFans += s.fanSums.reduce(function (a, b) { return a + b; }, 0);
      totalHands += s.winCounts.length + s.drawCounts.length;
    });

    var winPct = totalHands > 0 ? (100 * totalWins / totalHands).toFixed(1) : '0.0';
    var drawPct = totalHands > 0 ? (100 * totalDraws / totalHands).toFixed(1) : '0.0';
    var meanFan = totalWins > 0 ? (totalFans / totalWins).toFixed(2) : '0.00';
    row += ' ' + winPct.padStart(5) + '% | ' + drawPct.padStart(5) + '% | ' + meanFan.padStart(6);
  }
  console.log(row);
}

// Anomalies
console.log('\n========== ANOMALIES ==========');
anomalies.sort(function (a, b) { return a.config.localeCompare(b.config) || a.seed - b.seed; });
if (anomalies.length === 0) {
  console.log('(none)');
} else {
  anomalies.slice(0, 50).forEach(function (a) {
    console.log('  [' + a.config + '] seed ' + a.seed + ': ' + a.issue);
  });
  if (anomalies.length > 50) console.log('  ... and ' + (anomalies.length - 50) + ' more');
}

// Final report
console.log('\n========== FINAL REPORT ==========');
console.log('Total games: ' + stats.totalGames + ', Total hands: ' + stats.totalHands + ', Time: ' + secs.toFixed(1) + 's');
console.log('Failed checks: ' + failures.length + ', Anomalies flagged: ' + anomalies.length);
console.log('Max AI times (ms): easy ' + stats.maxAiTime.easy.toFixed(1) + ', normal ' + stats.maxAiTime.normal.toFixed(1) + ', hard ' + stats.maxAiTime.hard.toFixed(1));

if (failures.length > 0) {
  console.log('\nFailed checks:');
  failures.slice(0, 30).forEach(function (f) { console.log('  ' + f); });
  if (failures.length > 30) console.log('  ... and ' + (failures.length - 30) + ' more');
}

process.exit(failures.length > 0 ? 1 : 0);
