#!/usr/bin/env node
/* HK Mahjong — tests/scoring.test.js  (Owner: back end)
 * Extra scoring cases beyond the booklet vectors, catalogue checks, payments, and a fuzz:
 * random hands never throw, items sum to rawFan, winning <=> Hand.isWinningShape, groups are consistent.
 *   node tests/scoring.test.js [--quick]
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', 'src', 'core');
['tiles.js', 'rng.js', 'hand.js', 'scoring.js'].forEach(function (f) { require(path.join(CORE, f)); });
var HK = globalThis.HKMJ, T = HK.Tiles, H = HK.Hand, S = HK.Scoring;
var QUICK = process.argv.indexOf('--quick') >= 0;

var passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('FAIL ' + msg); } }
function P(s) { return T.parse(s); }
function meld(s) {
  var p = s.split(' '), t = P(p[1]);
  if (p[0] === 'chow') return { type: 'chow', tiles: T.sort(t), concealed: false };
  var k = t[0];
  if (p[0] === 'pong') return { type: 'pong', tiles: [k, k, k], concealed: false };
  return { type: 'kong', tiles: [k, k, k, k], concealed: p[0] === 'ckong' };
}
var W = { E: 0, S: 1, W: 2, N: 3 };
var OPT = { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true };
function ctx(o) {
  var seat = W[o.seat || 'S'];
  return {
    hand: P(o.hand || ''), melds: (o.melds || []).map(meld), winTile: o.win ? P(o.win)[0] : null,
    source: o.source || 'discard', kongReplacement: o.kr || 0, lastTile: !!o.lastTile,
    seatWind: seat, roundWind: W[o.round || 'E'],
    flowers: o.flowers === undefined ? [34 + ((seat + 1) % 4)] : P(o.flowers),
    blessing: o.blessing || null, flowerWin: !!o.flowerWin,
    settings: { minFan: o.minFan === undefined ? 3 : o.minFan, optional: Object.assign({}, OPT, o.opts || {}) }
  };
}
function sum(items) { var m = {}; items.forEach(function (i) { m[i.id] = (m[i.id] || 0) + i.fan; }); return m; }
function check(name, o, want) {
  var r = S.evaluate(ctx(o));
  var got = sum(r.items), bad = [];
  if (want.fan !== undefined && r.fan !== want.fan) bad.push('fan ' + r.fan + ' != ' + want.fan);
  if (want.raw !== undefined && r.rawFan !== want.raw) bad.push('raw ' + r.rawFan + ' != ' + want.raw);
  if (want.pattern && r.pattern !== want.pattern) bad.push('pattern ' + r.pattern + ' != ' + want.pattern);
  if (want.winning !== undefined && r.winning !== want.winning) bad.push('winning ' + r.winning);
  if (want.valid !== undefined && r.valid !== want.valid) bad.push('valid ' + r.valid);
  if (want.items) {
    Object.keys(want.items).forEach(function (id) { if ((got[id] || 0) !== want.items[id]) bad.push(id + '=' + (got[id] || 0) + ' want ' + want.items[id]); });
    if (want.exact !== false) Object.keys(got).forEach(function (id) { if (!(id in want.items)) bad.push('unexpected ' + id + '=' + got[id]); });
  }
  (want.replaced || []).forEach(function (id) { if (!r.replaced.some(function (x) { return x.id === id; })) bad.push('replaced should list ' + id); });
  (want.absent || []).forEach(function (id) { if (got[id]) bad.push(id + ' must be absent'); });
  ok(!bad.length, name + ': ' + bad.join('; ') + '  items=' + JSON.stringify(got));
  return r;
}

// ------------------------------------------------------------------------------------------------ extra cases
check('four concealed Kongs: All Quadruplets + All Concealed Triplets, Concealed built in',
  { hand: '77m', melds: ['ckong 2m', 'ckong 5p', 'ckong 8s', 'ckong 中'], win: '7m', source: 'self', kr: 1 },
  { fan: 13, raw: 13 + 8 + 2 + 1, items: { allQuadruplets: 13, allConcealedTriplets: 8, kongReplacement: 2, dragon: 1 }, replaced: ['allTriplets', 'concealed', 'selfPick'] });
check('All Terminals + All Concealed Triplets: 8 + (13 - 3)',
  { hand: '111m 999m 111p 999p 11s', win: '1s', source: 'self' },
  { fan: 13, raw: 19, items: { allConcealedTriplets: 8, allTerminals: 10, selfPick: 1 }, replaced: ['allTriplets', 'mixedTerminals', 'concealed'] });
check('All Terminals won on a discard completing a triplet',
  { hand: '111m 999m 111p 999p 11s', win: '9p', source: 'discard' },
  { fan: 13, raw: 14, items: { allTerminals: 13, concealed: 1 }, replaced: ['allTriplets', 'mixedTerminals'] });
check('Knitted Tiles with a seat + round wind triplet',
  { hand: '147m 258p 369s 東東東 中中', win: '中', seat: 'E', round: 'E' },
  { fan: 8, items: { knitted: 5, seatWind: 1, roundWind: 1, concealed: 1 } });
check('Knitted Tiles whose set is a concealed Kong (Kong option on), won on the replacement',
  { hand: '147m 258p 369s 中中', melds: ['ckong 東'], win: '中', source: 'self', kr: 1, seat: 'E', round: 'S', opts: { kong: true } },
  { fan: 11, items: { knitted: 5, kongReplacement: 2, seatWind: 1, kong: 2, concealed: 1 }, replaced: ['selfPick'] });
check('Knitted Tiles never scores a flush or All Sequences',
  { hand: '147m 258p 369s 789s 11s', win: '1s' },
  { fan: 6, items: { knitted: 5, concealed: 1 }, pattern: 'knitted' });
check('Luxury Seven Pairs with two quads',
  { hand: '1111m 2222m 33m 55p 77p', win: '7p' },
  { fan: 8, items: { sevenPairs: 4, luxurySevenPairs: 4 }, pattern: 'sevenPairs', replaced: ['concealed'] });
check('Seven Pairs vs a standard reading: the higher one wins (11223344556677m)',
  { hand: '11223344556677m', win: '7m' },
  { fan: 11, items: { sevenPairs: 4, fullFlush: 7 }, pattern: 'sevenPairs' });
check('... but with Seven Pairs off it is Full Flush + All Sequences + Concealed',
  { hand: '11223344556677m', win: '7m', opts: { sevenPairs: false } },
  { fan: 9, items: { fullFlush: 7, allSequences: 1, concealed: 1 }, pattern: 'standard' });
check('Blessing of Heaven on Seven Pairs',
  { hand: '22m 55m 88m 33p 66p 44s 中中', win: '中', source: 'self', blessing: 'heaven', seat: 'E' },
  { fan: 13, items: { heaven: 13, sevenPairs: 4, selfPick: 1 }, valid: true });
check('A Blessing still needs a winning shape',
  { hand: '22m 55m 88m 33p 66p 44s 中南', win: '中', source: 'self', blessing: 'heaven', seat: 'E' },
  { winning: false, valid: false });
check('Seven Flowers ignores the hand and the other bonus features',
  { flowerWin: true, flowers: '梅蘭菊竹春夏秋', seat: 'S' },
  { fan: 3, items: { sevenFlowers: 3 }, replaced: ['seatFlower', 'allFlowers'], pattern: 'flowers', valid: true });
check('Six bonus tiles are not a flower win', { flowerWin: true, flowers: '梅蘭菊竹春夏', seat: 'S' }, { winning: false, valid: false });
check('Small Four Winds lists the replaced seat / round wind',
  { hand: '北北 234s', melds: ['pong 東', 'pong 南', 'pong 西'], win: '4s', seat: 'S', round: 'E' },
  { fan: 9, items: { smallFourWinds: 6, mixedFlush: 3 }, replaced: ['seatWind', 'roundWind'] });
check('Big Three Dragons with a dragon Kong (Kong option on)',
  { hand: '123p 66m', melds: ['kong 中', 'pong 發', 'pong 白'], win: '6m', opts: { kong: true } },
  { fan: 9, items: { bigThreeDragons: 8, kong: 1 }, replaced: ['dragon'] });
check('A discard completing the pair keeps All Concealed Triplets',
  { hand: '111m 222m 333m 西西西 44p', win: '4p', source: 'discard' },
  { fan: 8, items: { allConcealedTriplets: 8 } });
check('Robbing the Kong completing a triplet exposes it (All Triplets, not All Concealed)',
  { hand: '111m 222m 333m 西西西 44p', win: '1m', source: 'robKong' },
  { fan: 5, items: { allTriplets: 3, concealed: 1, robKong: 1 } });
check('Moon on a self-picked last tile',
  { hand: '123m 456m 789p 西西西 99s', win: '9s', source: 'self', lastTile: true },
  { fan: 3, items: { selfPick: 1, concealed: 1, moon: 1 } });
check('No Flowers + Seat Flower never both (no bonus tiles => no seat flower)',
  { hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', seat: 'E', round: 'S', flowers: '' },
  { fan: 5, items: { allTriplets: 3, seatWind: 1, noFlowers: 1 } });
check('All Flowers + All Seasons + two seat tiles',
  { hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', seat: 'N', round: 'S', flowers: '梅蘭菊竹春夏秋冬' },
  { fan: 9, items: { allTriplets: 3, seatFlower: 2, allFlowers: 2, allSeasons: 2 } });
check('Chicken hand at a 0 Fan table', { hand: '123m 456p 西西西 55m', melds: ['chow 789s'], win: '5m', minFan: 0 }, { fan: 0, valid: true });
check('Nine Gates by Self-Pick adds Self-Pick; Full Flush replaced',
  { hand: '1112345678999p 9p', win: '9p', source: 'self' },
  { fan: 13, raw: 14, items: { nineGates: 13, selfPick: 1 }, replaced: ['fullFlush', 'concealed'] });
check('Nine Gates is impossible with a meld (even a concealed Kong): plain Full Flush',
  { hand: '2345678999p 1p', melds: ['ckong 1p'], win: '1p', source: 'self' },
  { winning: true, exact: false, items: { fullFlush: 7, concealed: 1, selfPick: 1 }, absent: ['nineGates'] });
check('Thirteen Orphans + Self-Pick sums, held at the limit',
  { hand: '19m 19p 19s 東南西北中發白 白', win: '白', source: 'self' },
  { fan: 13, raw: 14, items: { thirteenOrphans: 13, selfPick: 1 }, replaced: ['concealed'] });
check('Greater Honours won by Robbing the Kong',
  { hand: '147m 258p 3s 東南西北中發白', win: '3s', source: 'robKong' },
  { fan: 11, items: { greaterHonours: 10, robKong: 1 } });
check('Mixed Terminals + All Honours never both: pure honours is All Honours',
  { hand: '東東東 南南南 西西西 中中中 發發', win: '發', seat: 'N', round: 'N' },
  { fan: 13, raw: 16, items: { allConcealedTriplets: 8, allHonours: 7, dragon: 1 }, absent: ['mixedTerminals'] });
check('Kong option: an exposed and a concealed Kong',
  { hand: '123m 55s', melds: ['kong 7s', 'ckong 9p', 'pong 中'], win: '5s', opts: { kong: true } },
  { fan: 4, items: { dragon: 1, kong: 3 } });

// ------------------------------------------------------------------------------------------------ details, replaced, groups
(function () {
  var r = S.evaluate(ctx({ hand: '111m 999p 111s 西西西 北北', win: '北' }));
  var mt = r.items.filter(function (i) { return i.id === 'mixedTerminals'; })[0];
  ok(mt && mt.fan === 1 && /less the All Triplets 3/.test(mt.detail), 'Mixed Terminals + ACT shows "4, less the All Triplets 3 it includes"');
  var r2 = S.evaluate(ctx({ hand: '白白', melds: ['pong 東', 'pong 南', 'pong 中', 'pong 發'], win: '白', seat: 'W', round: 'W' }));
  var ah = r2.items.filter(function (i) { return i.id === 'allHonours'; })[0];
  ok(ah && /includes All Triplets 3/.test(ah.detail), 'All Honours detail mentions the included All Triplets');
  ok(r2.replaced.some(function (x) { return x.id === 'allTriplets' && /included in All Honours/.test(x.reason); }), 'All Triplets listed as included');
  var r3 = S.evaluate(ctx({ hand: '123m 456p 789s 55s', melds: ['pong 中'], win: '5s', flowers: '蘭', seat: 'S' }));
  var sf = r3.items.filter(function (i) { return i.id === 'seatFlower'; })[0];
  ok(sf && sf.detail.indexOf('蘭 Orchid') === 0 && /your seat flower/.test(sf.detail), 'seat flower detail: "蘭 Orchid — your seat flower"');
  var dr = r3.items.filter(function (i) { return i.id === 'dragon'; })[0];
  ok(dr && dr.detail === '中 Red Dragon triplet', 'dragon detail "中 Red Dragon triplet" (' + (dr && dr.detail) + ')');
  // groups
  var g = S.evaluate(ctx({ hand: '111p 888p 444s 北北北 99m', win: '北', source: 'discard' })).groups;
  var wg = g.filter(function (x) { return x.hasWinTile; });
  ok(wg.length === 1 && wg[0].kind === 'pong' && wg[0].tiles[0] === T.NORTH && wg[0].concealed === false, 'the discard-completed 北 triplet is the win group and exposed');
  var g2 = S.evaluate(ctx({ hand: '345s 678s 99s', melds: ['kong 2s', 'pong 發'], win: '9s', source: 'self', kr: 1 })).groups;
  ok(g2.filter(function (x) { return x.fromMeld; }).length === 2 && g2.filter(function (x) { return x.hasWinTile; })[0].kind === 'pair', 'melds marked fromMeld, win tile in the pair');
  var g3 = S.evaluate(ctx({ hand: '147m 258p 369s 234s 中中', win: '中' })).groups;
  ok(g3[0].kind === 'knitted' && g3[0].tiles.length === 9, 'knitted group of 9');
  var g4 = S.evaluate(ctx({ hand: '147m 258p 3s 東南西北中發白', win: '3s' })).groups;
  ok(g4.length === 2 && g4[0].kind === 'knitted' && g4[1].kind === 'single' && g4[0].hasWinTile, 'honours hand: knitted + single groups');
  var g5 = S.evaluate(ctx({ hand: '中中中中 55m 88m 11p 55p 33s', win: '中' })).groups;
  ok(g5.length === 7 && g5.filter(function (x) { return x.hasWinTile; }).length === 1, 'luxury pairs: one win group');
})();

// ------------------------------------------------------------------------------------------------ catalogue
(function () {
  var SPEC_IDS = ['selfPick', 'kongReplacement', 'doubleKong', 'concealed', 'robKong', 'moon', 'allSequences', 'allTriplets',
    'allConcealedTriplets', 'allQuadruplets', 'dragon', 'smallThreeDragons', 'bigThreeDragons', 'roundWind', 'seatWind',
    'smallFourWinds', 'bigFourWinds', 'mixedFlush', 'fullFlush', 'mixedTerminals', 'allTerminals', 'allHonours', 'kong',
    'sevenPairs', 'luxurySevenPairs', 'knitted', 'lesserHonours', 'greaterHonours', 'thirteenOrphans', 'nineGates', 'heaven',
    'earth', 'man', 'noFlowers', 'seatFlower', 'allFlowers', 'allSeasons', 'sevenFlowers', 'eightFlowers'];
  ok(JSON.stringify(SPEC_IDS.slice().sort()) === JSON.stringify(Object.keys(S.FEATURES).sort()), 'FEATURES has exactly the SPEC ids');
  ok(JSON.stringify(SPEC_IDS.slice().sort()) === JSON.stringify(S.FEATURE_ORDER.slice().sort()), 'FEATURE_ORDER lists every id once');
  var bad = [];
  S.FEATURE_ORDER.forEach(function (id) {
    var f = S.FEATURES[id];
    ['name', 'zh', 'fanText', 'desc'].forEach(function (k) { if (typeof f[k] !== 'string' || !f[k]) bad.push(id + '.' + k); });
    if (typeof f.fan !== 'number' || f.fan < 1) bad.push(id + '.fan');
    if (['win', 'set', 'tile', 'special', 'bonus'].indexOf(f.group) < 0) bad.push(id + '.group');
    if (typeof f.optional !== 'boolean') bad.push(id + '.optional');
    if (!Array.isArray(f.replaces) || f.replaces.some(function (x) { return !S.FEATURES[x]; })) bad.push(id + '.replaces');
  });
  ok(!bad.length, 'catalogue entries complete: ' + bad.join(','));
  var optional = S.FEATURE_ORDER.filter(function (id) { return S.FEATURES[id].optional; });
  ok(JSON.stringify(optional) === JSON.stringify(['kong', 'sevenPairs', 'luxurySevenPairs', 'knitted', 'lesserHonours', 'greaterHonours']), 'the six † features are optional: ' + optional);
  var expectFan = { selfPick: 1, kongReplacement: 2, doubleKong: 9, concealed: 1, robKong: 1, moon: 1, allSequences: 1, allTriplets: 3,
    allConcealedTriplets: 8, allQuadruplets: 13, dragon: 1, smallThreeDragons: 5, bigThreeDragons: 8, roundWind: 1, seatWind: 1,
    smallFourWinds: 6, bigFourWinds: 13, mixedFlush: 3, fullFlush: 7, mixedTerminals: 4, allTerminals: 13, allHonours: 10, kong: 1,
    sevenPairs: 4, luxurySevenPairs: 2, knitted: 5, lesserHonours: 8, greaterHonours: 10, thirteenOrphans: 13, nineGates: 13,
    heaven: 13, earth: 13, man: 13, noFlowers: 1, seatFlower: 1, allFlowers: 2, allSeasons: 2, sevenFlowers: 3, eightFlowers: 8 };
  var wrong = Object.keys(expectFan).filter(function (id) { return S.FEATURES[id].fan !== expectFan[id]; });
  ok(!wrong.length, 'catalogue Fan values match the booklet: ' + wrong.join(','));
})();

// ------------------------------------------------------------------------------------------------ payments
(function () {
  var p = S.payments({ fan: 5, winner: 1, source: 'discard', payer: 3, payment: 'shared', unit: 'chips' });
  ok(JSON.stringify(p) === JSON.stringify([-2.5, 10, -2.5, -5]), 'shared chips: payer 5, others 2.5 (' + JSON.stringify(p) + ')');
  ok(S.points(-3) === 1 && S.points(20) === 384 && S.points(2.7) === 4, 'points() clamps');
  var rng = HK.RNG(8), badSum = 0;
  for (var i = 0; i < 500; i++) {
    var src = ['self', 'discard', 'robKong'][rng.int(3)], w = rng.int(4), payer = src === 'self' ? null : (w + 1 + rng.int(3)) % 4;
    var d = S.payments({ fan: rng.int(16), winner: w, source: src, payer: payer, payment: rng.next() < 0.5 ? 'full' : 'shared', unit: rng.next() < 0.5 ? 'points' : 'chips' });
    var s = d.reduce(function (a, b) { return a + b; }, 0);
    if (Math.abs(s) > 1e-9 || d[w] <= 0) badSum++;
  }
  ok(badSum === 0, 'payments always sum to 0 and the winner gains');
  var e = S.payments({ fan: 13, winner: 2, source: 'discard', payer: 0 });
  ok(e[0] === -768 && e[2] === 768 && e[1] === 0 && e[3] === 0, 'Blessing-of-Earth style: dealer (discarder) pays 2 x 384');
})();

// ------------------------------------------------------------------------------------------------ fuzz
function randomComplete(rng) {
  var used = new Array(34).fill(0);
  function can(tiles) { var c = {}; for (var i = 0; i < tiles.length; i++) { c[tiles[i]] = (c[tiles[i]] || 0) + 1; if (used[tiles[i]] + c[tiles[i]] > 4) return false; } return true; }
  function take(tiles) { tiles.forEach(function (t) { used[t]++; }); }
  var kind = rng.next();
  var biasSuit = rng.int(3), biasHon = rng.next() < 0.5;
  function rk() {
    var r = rng.next();
    if (r < 0.45) return biasSuit * 9 + rng.int(9);
    if (r < 0.65 && biasHon) return 27 + rng.int(7);
    return rng.int(34);
  }
  if (kind < 0.72) {
    var mc = rng.int(5), melds = [], conc = [], guard = 0;
    while (melds.length + conc.length / 3 < 4 && guard++ < 80) {
      var k = rk(), set;
      if (T.isSuit(k) && k % 9 <= 6 && rng.next() < 0.45) set = { type: 'chow', tiles: [k, k + 1, k + 2], concealed: false };
      else set = { type: 'pong', tiles: [k, k, k], concealed: false };
      var asMeld = melds.length < mc;
      if (asMeld && set.type === 'pong' && rng.next() < 0.35) set = { type: 'kong', tiles: [k, k, k, k], concealed: rng.next() < 0.5 };
      if (!can(set.tiles)) continue;
      take(set.tiles);
      if (asMeld) melds.push(set); else conc = conc.concat(set.tiles);
    }
    var pk = rk(), g2 = 0;
    while (!can([pk, pk]) && g2++ < 50) pk = rng.int(34);
    if (!can([pk, pk]) || melds.length + conc.length / 3 !== 4) return null;
    take([pk, pk]); conc.push(pk, pk);
    return { hand: conc, melds: melds };
  }
  if (kind < 0.84) { // seven pairs (maybe luxury)
    var hand = [], kinds = [];
    while (kinds.length < 7) { var q = rk(); if (kinds.indexOf(q) < 0) kinds.push(q); }
    if (rng.next() < 0.3) kinds[6] = kinds[0];
    kinds.forEach(function (x) { hand.push(x, x); });
    return { hand: hand, melds: [] };
  }
  if (kind < 0.92) { // knitted
    var a = rng.int(6), ks = H.KNIT[a].slice();
    var rest = [], r2 = rng.next(), km = [];
    var cnt = H.counts(ks);
    var pp = rng.int(34);
    while (cnt[pp] > 2) pp = rng.int(34);
    rest.push(pp, pp); cnt[pp] += 2;
    var sk = rng.int(34);
    if (T.isSuit(sk) && sk % 9 <= 6 && r2 < 0.5 && cnt[sk] < 4 && cnt[sk + 1] < 4 && cnt[sk + 2] < 4) { if (rng.next() < 0.5) rest.push(sk, sk + 1, sk + 2); else km.push({ type: 'chow', tiles: [sk, sk + 1, sk + 2], concealed: false }); }
    else if (cnt[sk] === 0) { if (rng.next() < 0.5) rest.push(sk, sk, sk); else km.push({ type: rng.next() < 0.5 ? 'pong' : 'kong', tiles: [sk, sk, sk], concealed: false }); if (km.length && km[0].type === 'kong') { km[0].tiles.push(sk); km[0].concealed = rng.next() < 0.5; } }
    else return null;
    return { hand: ks.concat(rest), melds: km };
  }
  if (kind < 0.96) { // lesser / greater honours
    var ar = rng.int(6), kn = H.KNIT[ar].slice(), hon = [27, 28, 29, 30, 31, 32, 33];
    rng.shuffle(kn); rng.shuffle(hon);
    var split = [[9, 5], [8, 6], [7, 7]][rng.int(3)];
    return { hand: kn.slice(0, split[0]).concat(hon.slice(0, split[1])), melds: [] };
  }
  var orp = H.ORPHANS.slice();
  return { hand: orp.concat([orp[rng.int(13)]]), melds: [] };
}

(function () {
  var rng = HK.RNG(31337), N = QUICK ? 2000 : 12000;
  var threw = 0, badSum = 0, badCap = 0, badZero = 0, badWin = 0, badGroups = 0, badWinTile = 0, badValid = 0, badMono = 0, badFlower = 0, winning = 0, tested = 0;
  var maxMs = 0, totalMs = 0;
  var patterns = {};
  for (var i = 0; i < N; i++) {
    var x = randomComplete(rng);
    if (!x) continue;
    var near = rng.next() < 0.2;               // make some hands non-winning
    if (near) { var j = rng.int(x.hand.length); x.hand[j] = rng.int(34); }
    var tot = H.counts(x.hand); x.melds.forEach(function (m) { m.tiles.forEach(function (t) { tot[t]++; }); });
    if (tot.some(function (c) { return c > 4; })) continue;
    var opt = { kong: rng.next() < 0.3, sevenPairs: rng.next() < 0.8, luxurySevenPairs: rng.next() < 0.7, knitted: rng.next() < 0.8, lesserHonours: rng.next() < 0.8, greaterHonours: rng.next() < 0.8 };
    var src = ['self', 'discard', 'robKong'][rng.int(3)];
    var nf = rng.int(4), flowers = rng.shuffle([34, 35, 36, 37, 38, 39, 40, 41]).slice(0, nf);
    var c = {
      hand: x.hand, melds: x.melds, winTile: x.hand[rng.int(x.hand.length)], source: src,
      kongReplacement: src === 'self' ? [0, 0, 0, 1, 2][rng.int(5)] : 0, lastTile: rng.next() < 0.1,
      seatWind: rng.int(4), roundWind: rng.int(4), flowers: flowers,
      blessing: rng.next() < 0.03 ? ['heaven', 'earth', 'man'][rng.int(3)] : null, flowerWin: false,
      settings: { minFan: rng.int(4), optional: opt }
    };
    tested++;
    var r, t0 = process.hrtime.bigint();
    try { r = S.evaluate(c); } catch (e) { threw++; if (threw < 4) console.log('  threw', e && e.stack); continue; }
    var ms = Number(process.hrtime.bigint() - t0) / 1e6;
    totalMs += ms; if (ms > maxMs) maxMs = ms;
    var shape = H.isWinningShape(x.hand, x.melds, opt);
    if (r.winning !== shape) { badWin++; if (badWin < 4) console.log('  winning mismatch', T.format(x.hand), JSON.stringify(x.melds)); }
    if (!r.winning) continue;
    winning++;
    patterns[r.pattern] = (patterns[r.pattern] || 0) + 1;
    var s = r.items.reduce(function (a, it) { return a + it.fan; }, 0);
    if (s !== r.rawFan) badSum++;
    if (r.fan !== Math.min(13, r.rawFan) || r.limit !== (r.rawFan >= 13) || r.points !== S.points(r.fan)) badCap++;
    if (r.items.some(function (it) { return !(it.fan > 0) || !it.name || !it.zh; })) badZero++;
    if (r.valid !== (r.fan >= c.settings.minFan || !!c.blessing)) badValid++;
    // groups hold exactly the hand + meld tiles, one group has the winning tile
    var gt = [];
    r.groups.forEach(function (g) { gt = gt.concat(g.tiles); });
    var all = x.hand.slice(); x.melds.forEach(function (m) { all = all.concat(m.tiles); });
    if (T.format(gt) !== T.format(all)) { badGroups++; if (badGroups < 4) console.log('  groups', T.format(gt), 'vs', T.format(all), r.pattern); }
    var wg = r.groups.filter(function (g) { return g.hasWinTile; });
    if (wg.length !== 1 || wg[0].tiles.indexOf(c.winTile) < 0 || wg[0].fromMeld) badWinTile++;
    // monotonic: a Self-Pick is worth at least the same hand on a discard
    if (src !== 'self') {
      var c2 = Object.assign({}, c, { source: 'self', kongReplacement: 0 });
      if (S.evaluate(c2).rawFan < r.rawFan - (src === 'robKong' ? 1 : 0)) badMono++;
    }
    // adding a seat flower adds exactly 1 (or trades No Flowers for it)
    var seatF = 34 + c.seatWind;
    if (flowers.indexOf(seatF) < 0 && flowers.length) {
      var c3 = Object.assign({}, c, { flowers: flowers.concat([seatF]) });
      var r3 = S.evaluate(c3);
      var expected = r.rawFan + 1 + (flowers.length === 3 && [34, 35, 36, 37].every(function (f) { return c3.flowers.indexOf(f) >= 0; }) ? 2 : 0);
      if (r3.rawFan !== expected) { badFlower++; if (badFlower < 4) console.log('  flower', r.rawFan, r3.rawFan, JSON.stringify(c3.flowers)); }
    }
  }
  ok(threw === 0, 'fuzz: evaluate never throws (' + threw + ')');
  ok(badWin === 0, 'fuzz: winning <=> Hand.isWinningShape (' + badWin + ')');
  ok(badSum === 0, 'fuzz: items sum to rawFan (' + badSum + ')');
  ok(badCap === 0, 'fuzz: fan = min(13, rawFan), limit and points consistent (' + badCap + ')');
  ok(badZero === 0, 'fuzz: every item has fan > 0, name and zh (' + badZero + ')');
  ok(badValid === 0, 'fuzz: valid = fan >= minFan || blessing (' + badValid + ')');
  ok(badGroups === 0, 'fuzz: groups contain exactly the hand and meld tiles (' + badGroups + ')');
  ok(badWinTile === 0, 'fuzz: exactly one concealed group has the winning tile (' + badWinTile + ')');
  ok(badMono === 0, 'fuzz: Self-Pick never scores less than the same hand on a discard (' + badMono + ')');
  ok(badFlower === 0, 'fuzz: one more seat flower adds exactly one Fan (' + badFlower + ')');
  var avg = totalMs / Math.max(1, tested);
  console.log('  fuzz: ' + tested + ' hands, ' + winning + ' winning ' + JSON.stringify(patterns) + '; evaluate avg ' + (avg * 1000).toFixed(0) + ' us, max ' + maxMs.toFixed(2) + ' ms');
  ok(avg < 2, 'evaluate() averages under 2 ms (' + avg.toFixed(3) + ' ms)');
})();

// non-winning random hands
(function () {
  var rng = HK.RNG(77), threw = 0, wrong = 0;
  for (var i = 0; i < (QUICK ? 500 : 3000); i++) {
    var wall = rng.shuffle(T.fullSet());
    var hand = wall.filter(function (k) { return k < 34; }).slice(0, 14);
    var r;
    try { r = S.evaluate({ hand: hand, melds: [], winTile: hand[0], source: 'self', seatWind: 0, roundWind: 0, flowers: [], settings: { minFan: 3 } }); }
    catch (e) { threw++; continue; }
    if (r.winning !== H.isWinningShape(hand, [], null)) wrong++;
  }
  ok(threw === 0 && wrong === 0, 'random 14-tile hands: no throw, winning flag agrees (' + threw + ', ' + wrong + ')');
  var weird = [{}, { hand: null }, { hand: [1, 2, 3], melds: null, winTile: 99 }, { flowerWin: true }, { hand: P('123m 456p 789s 中中中 55s'), winTile: 5, source: 'nonsense', settings: {} }];
  var th = 0;
  weird.forEach(function (w) { try { S.evaluate(w); } catch (e) { th++; } });
  ok(th === 0, 'malformed contexts do not throw');
})();

console.log('scoring.test: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
