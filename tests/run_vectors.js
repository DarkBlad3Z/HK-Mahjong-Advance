#!/usr/bin/env node
/* HK Mahjong — tests/run_vectors.js  (Owner: orchestrator)
 * Runs the booklet acceptance vectors against HKMJ.Scoring.evaluate and HKMJ.Scoring.payments.
 *   node tests/run_vectors.js            -> run everything, exit 1 on any failure
 *   node tests/run_vectors.js --check    -> only sanity-check the vectors themselves (tile counts etc.)
 *   node tests/run_vectors.js --verbose  -> print every result
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', 'src', 'core');
require(path.join(CORE, 'tiles.js'));
var HKMJ = globalThis.HKMJ;
var T = HKMJ.Tiles;
var DATA = require('./pdf_vectors.js');

var args = process.argv.slice(2);
var CHECK_ONLY = args.indexOf('--check') >= 0;
var VERBOSE = args.indexOf('--verbose') >= 0;
var WIND = { E: 0, S: 1, W: 2, N: 3 };
var OPT_DEFAULTS = { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true };

function parseMeld(s) {
  var parts = s.trim().split(/\s+/);
  var type = parts[0], tiles = T.parse(parts.slice(1).join(''));
  if (type === 'chow') {
    if (tiles.length !== 3) throw new Error('bad chow ' + s);
    return { type: 'chow', tiles: T.sort(tiles), concealed: false };
  }
  if (tiles.length !== 1) throw new Error('bad meld ' + s);
  var k = tiles[0];
  if (type === 'pong') return { type: 'pong', tiles: [k, k, k], concealed: false };
  if (type === 'kong') return { type: 'kong', tiles: [k, k, k, k], concealed: false };
  if (type === 'ckong') return { type: 'kong', tiles: [k, k, k, k], concealed: true };
  throw new Error('bad meld type ' + s);
}

function buildCtx(vec) {
  var seat = WIND[vec.seat || 'S'], round = WIND[vec.round || 'E'];
  var flowers = (vec.flowers === undefined) ? [T.FLOWER0 + ((seat + 1) % 4)] : T.parse(vec.flowers);
  var opts = Object.assign({}, OPT_DEFAULTS, vec.opts || {});
  return {
    hand: vec.hand ? T.parse(vec.hand) : [],
    melds: (vec.melds || []).map(parseMeld),
    winTile: vec.win ? T.parse(vec.win)[0] : null,
    source: vec.source || 'self',
    kongReplacement: vec.kongReplacement || 0,
    lastTile: !!vec.lastTile,
    seatWind: seat,
    roundWind: round,
    flowers: flowers,
    blessing: vec.blessing || null,
    flowerWin: !!vec.flowerWin,
    settings: { minFan: (vec.minFan === undefined ? 3 : vec.minFan), optional: opts }
  };
}

function sanity(vec, ctx) {
  var errs = [];
  if (vec.flowerWin) {
    if (ctx.flowers.length < 7) errs.push('flowerWin needs >= 7 bonus tiles');
    return errs;
  }
  var all = ctx.hand.slice();
  var kongs = 0;
  ctx.melds.forEach(function (m) { all = all.concat(m.tiles); if (m.type === 'kong') kongs++; });
  var c = T.counts(all);
  for (var k = 0; k < 34; k++) if (c[k] > 4) errs.push('more than 4 of ' + T.code(k));
  if (all.length !== 14 + kongs) errs.push('tile total ' + all.length + ' != 14 + ' + kongs + ' kongs');
  if (ctx.hand.indexOf(ctx.winTile) < 0) errs.push('winning tile not in hand');
  var seen = {};
  ctx.flowers.forEach(function (f) { if (!T.isBonus(f)) errs.push('non-bonus tile in flowers'); if (seen[f]) errs.push('duplicate bonus tile'); seen[f] = 1; });
  return errs;
}

function sumById(items) {
  var m = {};
  (items || []).forEach(function (it) { if (it.fan) m[it.id] = (m[it.id] || 0) + it.fan; });
  return m;
}

var fails = 0, passes = 0;
function fail(id, msg) { fails++; console.log('FAIL ' + id + ': ' + msg); }

DATA.vectors.forEach(function (vec) {
  var ctx = buildCtx(vec);
  var errs = sanity(vec, ctx);
  if (errs.length) { fail(vec.id, 'BAD VECTOR — ' + errs.join('; ')); return; }
});
if (CHECK_ONLY) {
  console.log(DATA.vectors.length + ' vectors checked, ' + fails + ' bad.');
  process.exit(fails ? 1 : 0);
}

require(path.join(CORE, 'rng.js'));
require(path.join(CORE, 'hand.js'));
require(path.join(CORE, 'scoring.js'));
var S = HKMJ.Scoring;

DATA.vectors.forEach(function (vec) {
  var ctx = buildCtx(vec);
  var res;
  try { res = S.evaluate(ctx); } catch (e) { fail(vec.id, 'threw ' + (e && e.stack || e)); return; }
  var ex = vec.expect, bad = [];
  if (ex.winning === false) {
    if (res.winning) bad.push('expected NOT a winning hand, got winning (' + res.pattern + ', ' + res.fan + ' Fan)');
  } else {
    if (!res.winning) bad.push('expected a winning hand');
    else {
      if (res.fan !== ex.fan) bad.push('fan ' + res.fan + ' != ' + ex.fan);
      if (ex.raw !== undefined && res.rawFan !== ex.raw) bad.push('rawFan ' + res.rawFan + ' != ' + ex.raw);
      if (res.fan !== Math.min(13, res.rawFan)) bad.push('fan must equal min(13, rawFan)');
      var got = sumById(res.items);
      var total = 0; Object.keys(got).forEach(function (k) { total += got[k]; });
      if (total !== res.rawFan) bad.push('items sum ' + total + ' != rawFan ' + res.rawFan);
      var want = ex.items || {};
      Object.keys(want).forEach(function (id) { if ((got[id] || 0) !== want[id]) bad.push(id + '=' + (got[id] || 0) + ' (want ' + want[id] + ')'); });
      if (ex.itemsExact !== false) {
        Object.keys(got).forEach(function (id) { if (!(id in want)) bad.push('unexpected item ' + id + '=' + got[id]); });
      }
      (ex.absent || []).forEach(function (id) { if (got[id]) bad.push('item ' + id + ' must be absent'); });
      (res.items || []).forEach(function (it) { if (!it.name || !it.zh) bad.push('item ' + it.id + ' missing name/zh'); });
    }
    if (ex.valid !== undefined && res.valid !== ex.valid) bad.push('valid ' + res.valid + ' != ' + ex.valid);
  }
  if (bad.length) fail(vec.id, bad.join('; ') + '   [' + vec.ref + ']  items=' + JSON.stringify(sumById(res.items)));
  else {
    passes++;
    if (VERBOSE) console.log('ok   ' + vec.id + '  ' + res.fan + ' Fan  ' + JSON.stringify(sumById(res.items)));
  }
});

// Payment Table
for (var f = 0; f <= 15; f++) {
  var want = DATA.POINTS[Math.min(f, 13)];
  var got = S.points(f);
  if (got !== want) fail('points-' + f, 'points(' + f + ') = ' + got + ', want ' + want); else passes++;
}
DATA.payments.forEach(function (p) {
  var got;
  try { got = S.payments({ fan: p.fan, winner: p.winner, source: p.source, payer: p.payer, payment: p.style, unit: p.unit }); }
  catch (e) { fail(p.id, 'threw ' + e); return; }
  var ok = Array.isArray(got) && got.length === 4 && got.every(function (x, i) { return Math.abs(x - p.expect[i]) < 1e-9; });
  var sum = (got || []).reduce(function (a, b) { return a + b; }, 0);
  if (!ok || Math.abs(sum) > 1e-9) fail(p.id, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(p.expect) + ' [' + p.ref + ']');
  else passes++;
});

console.log('\nBooklet vectors: ' + passes + ' passed, ' + fails + ' failed.');
process.exit(fails ? 1 : 0);
