#!/usr/bin/env node
/* HK Mahjong — tests/qa/ref_scorer_diff.test.js  (orchestrator QA)
 * Independent reference scorer for STANDARD hands (own decomposition, own feature rules written straight from
 * SPEC §3 / the booklet) differential-tested against HKMJ.Scoring.evaluate on random winning hands.
 *   node tests/qa/ref_scorer_diff.test.js [N]      (default 30000 hands)
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', '..', 'src', 'core');
['tiles.js', 'rng.js', 'hand.js', 'scoring.js'].forEach(function (f) { require(path.join(CORE, f)); });
var HK = globalThis.HKMJ, T = HK.Tiles, S = HK.Scoring;
var N = +(process.argv[2] || 30000);
var rng = HK.RNG(process.argv[3] || 20260926);
function ri(n) { return rng.int(n); }

// ------------------------------------------------------------------ independent decomposition
function decompose(counts, need) {
  var out = [];
  for (var p = 0; p < 34; p++) {
    if (counts[p] < 2) continue;
    counts[p] -= 2;
    sets(counts, need, [], function (ss) { out.push({ pair: p, sets: ss.slice() }); });
    counts[p] += 2;
  }
  return out;
}
function sets(c, need, acc, emit) {
  if (need === 0) { for (var i = 0; i < 34; i++) if (c[i]) return; emit(acc); return; }
  var k = -1; for (var j = 0; j < 34; j++) if (c[j]) { k = j; break; }
  if (k < 0) return;
  if (c[k] >= 3) { c[k] -= 3; acc.push({ type: 'pong', tiles: [k, k, k] }); sets(c, need - 1, acc, emit); acc.pop(); c[k] += 3; }
  if (k < 27 && k % 9 <= 6 && c[k + 1] && c[k + 2]) {
    c[k]--; c[k + 1]--; c[k + 2]--; acc.push({ type: 'chow', tiles: [k, k + 1, k + 2] });
    sets(c, need - 1, acc, emit); acc.pop(); c[k]++; c[k + 1]++; c[k + 2]++;
  }
}

// ------------------------------------------------------------------ reference feature rules
function refScore(dec, melds, winKind, placeIdx, ctx) {
  // placeIdx: index into dec.sets for the concealed set holding the win tile, or -1 for the pair
  var all = [];
  var groups = [];
  melds.forEach(function (m) { groups.push({ type: m.type, tiles: m.tiles, declared: true, concealed: !!m.concealed }); });
  dec.sets.forEach(function (s, i) { groups.push({ type: s.type, tiles: s.tiles, declared: false, hasWin: i === placeIdx }); });
  groups.forEach(function (g) { all = all.concat(g.tiles); });
  all.push(dec.pair, dec.pair);
  var src = ctx.source;
  var concealedHand = melds.every(function (m) { return m.type === 'kong' && m.concealed; });
  function setConcealed(g) { return g.declared ? (g.type === 'kong' && g.concealed) : !(g.hasWin && src !== 'self'); }
  var chows = groups.filter(function (g) { return g.type === 'chow'; }).length;
  var trip = groups.filter(function (g) { return g.type !== 'chow'; });
  var kongs = groups.filter(function (g) { return g.type === 'kong'; });
  var items = {};
  function add(id, f) { items[id] = (items[id] || 0) + f; }
  var setType = null;
  if (chows === 4) setType = 'AS';
  else if (trip.length === 4) setType = kongs.length === 4 ? 'AQ' : (trip.every(setConcealed) ? 'ACT' : 'AT');
  var suits = {}, hasHon = false, onlyTerm = true, termOrHon = true, anySuit = false;
  all.forEach(function (k) {
    if (k < 27) { suits[Math.floor(k / 9)] = 1; anySuit = true; if (k % 9 !== 0 && k % 9 !== 8) { onlyTerm = false; termOrHon = false; } }
    else { hasHon = true; onlyTerm = false; }
  });
  var nSuits = Object.keys(suits).length, onlyHon = !anySuit;
  var ST = { AS: 1, AT: 3, ACT: 8, AQ: 13 };
  if (onlyHon) {
    if (setType === 'AT') add('allHonours', 10);
    else if (setType === 'ACT') { add('allConcealedTriplets', 8); add('allHonours', 7); }
    else if (setType === 'AQ') { add('allQuadruplets', 13); add('allHonours', 7); }
  } else if (onlyTerm) {
    add('allTerminals', 13);
  } else if (termOrHon && hasHon) {
    if (setType === 'AT') add('mixedTerminals', 4);
    else if (setType === 'ACT') { add('allConcealedTriplets', 8); add('mixedTerminals', 1); }
    else if (setType === 'AQ') { add('allQuadruplets', 13); add('mixedTerminals', 1); }
  } else if (setType) {
    add({ AS: 'allSequences', AT: 'allTriplets', ACT: 'allConcealedTriplets', AQ: 'allQuadruplets' }[setType], ST[setType]);
  }
  if (!onlyHon && nSuits === 1) add(hasHon ? 'mixedFlush' : 'fullFlush', hasHon ? 3 : 7);
  var dragonTrips = trip.filter(function (g) { return g.tiles[0] >= 31; });
  var d = dragonTrips.length;
  if (d === 3) add('bigThreeDragons', 8);
  else if (d === 2 && dec.pair >= 31) add('smallThreeDragons', 5);
  else if (d) add('dragon', d);
  var windTrips = trip.filter(function (g) { return g.tiles[0] >= 27 && g.tiles[0] <= 30; });
  var w = windTrips.length;
  if (w === 4) add('bigFourWinds', 13);
  else if (w === 3 && dec.pair >= 27 && dec.pair <= 30) add('smallFourWinds', 6);
  else windTrips.forEach(function (g) {
    var wi = g.tiles[0] - 27;
    if (wi === ctx.roundWind) add('roundWind', 1);
    if (wi === ctx.seatWind) add('seatWind', 1);
  });
  if (ctx.settings.optional.kong && setType !== 'AQ') kongs.forEach(function (g) { add('kong', g.concealed ? 2 : 1); });
  if (src === 'self') { if (ctx.kongReplacement >= 2) add('doubleKong', 9); else if (ctx.kongReplacement === 1) add('kongReplacement', 2); else add('selfPick', 1); }
  if (ctx.lastTile) add('moon', 1);
  // Concealed Hand is built into All Concealed Triplets; an All Quadruplets hand is at the 13 limit either way.
  if (concealedHand && setType !== 'ACT') add('concealed', 1);
  var fl = ctx.flowers;
  if (!fl.length) add('noFlowers', 1);
  fl.forEach(function (f) { var num = f <= 37 ? f - 33 : f - 37; if (num === ctx.seatWind + 1) add('seatFlower', 1); });
  if ([34, 35, 36, 37].every(function (f) { return fl.indexOf(f) >= 0; })) add('allFlowers', 2);
  if ([38, 39, 40, 41].every(function (f) { return fl.indexOf(f) >= 0; })) add('allSeasons', 2);
  var raw = 0; Object.keys(items).forEach(function (k) { raw += items[k]; });
  return { raw: raw, fan: Math.min(13, raw), items: items };
}

function refBest(ctx) {
  var counts = T.counts(ctx.hand);
  // Nine Gates (booklet p.8): fully concealed, one suit, 1112345678999 + any tile of that suit -> the 13 limit
  if (!ctx.melds.length && ctx.hand.length === 14) {
    var s0 = Math.floor(ctx.hand[0] / 9);
    if (ctx.hand.every(function (k) { return k < 27 && Math.floor(k / 9) === s0; })) {
      var b = s0 * 9, okNG = counts[b] >= 3 && counts[b + 8] >= 3;
      for (var r = 1; r <= 7; r++) if (counts[b + r] < 1) okNG = false;
      if (okNG) return { raw: 13, fan: 13, items: { nineGates: 13 } };
    }
  }
  var decs = decompose(counts, 4 - ctx.melds.length);
  var best = null;
  decs.forEach(function (dec) {
    var places = [];
    dec.sets.forEach(function (s, i) { if (s.tiles.indexOf(ctx.winTile) >= 0) places.push(i); });
    if (dec.pair === ctx.winTile) places.push(-1);
    places.forEach(function (pi) {
      var r = refScore(dec, ctx.melds, ctx.winTile, pi, ctx);
      if (!best || r.fan > best.fan || (r.fan === best.fan && r.raw > best.raw)) best = r;
    });
  });
  return best;
}

// ------------------------------------------------------------------ generator
function genHand() {
  var mode = ri(10); // 0-2 one suit(+hon), 3 honour heavy, 4 terminal/honour, else free
  var suit = ri(3);
  var counts = new Array(34).fill(0);
  function pickKind(forPair) {
    for (var tries = 0; tries < 50; tries++) {
      var k;
      if (mode <= 2) k = ri(4) === 0 ? 27 + ri(7) : suit * 9 + ri(9);
      else if (mode === 3) k = ri(3) === 0 ? ri(27) : 27 + ri(7);
      else if (mode === 4) { var opts = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]; k = opts[ri(opts.length)]; }
      else k = ri(34);
      return k;
    }
  }
  var groups = [];
  for (var g = 0; g < 4; g++) {
    var ok = false;
    for (var t = 0; t < 60 && !ok; t++) {
      var type = ri(10) < (mode === 3 || mode === 4 ? 1 : 5) ? 'chow' : (ri(6) === 0 ? 'kong' : 'pong');
      var k = pickKind();
      if (type === 'chow') {
        if (k >= 27 || k % 9 > 6) continue;
        if (counts[k] < 4 && counts[k + 1] < 4 && counts[k + 2] < 4) { counts[k]++; counts[k + 1]++; counts[k + 2]++; groups.push({ type: 'chow', tiles: [k, k + 1, k + 2] }); ok = true; }
      } else {
        var n = type === 'kong' ? 4 : 3;
        if (counts[k] + n <= 4) { counts[k] += n; groups.push({ type: type, tiles: new Array(n).fill(k) }); ok = true; }
      }
    }
    if (!ok) return null;
  }
  var pk = null;
  for (var q = 0; q < 60; q++) { var kk = pickKind(true); if (counts[kk] + 2 <= 4) { pk = kk; break; } }
  if (pk === null) return null;
  counts[pk] += 2;
  var melds = [], hand = [pk, pk];
  groups.forEach(function (gr) {
    if (gr.type === 'kong' || ri(100) < 35) melds.push({ type: gr.type, tiles: gr.tiles.slice(), concealed: gr.type === 'kong' && ri(100) < 40 });
    else hand = hand.concat(gr.tiles);
  });
  var winTile = hand[ri(hand.length)];
  var source = ri(2) ? 'self' : 'discard';
  var hasKong = melds.some(function (m) { return m.type === 'kong'; });
  var kr = (source === 'self' && hasKong && ri(10) < 3) ? 1 + ri(2) : 0;
  var flowers = []; var nf = ri(5);
  while (flowers.length < nf) { var f = 34 + ri(8); if (flowers.indexOf(f) < 0) flowers.push(f); }
  return {
    hand: T.sort(hand), melds: melds, winTile: winTile, source: source, kongReplacement: kr, lastTile: ri(100) < 8,
    seatWind: ri(4), roundWind: ri(4), flowers: flowers, blessing: null, flowerWin: false,
    settings: { minFan: 0, optional: { kong: !!ri(2), sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false } }
  };
}

// ------------------------------------------------------------------ run
var tested = 0, mism = 0, classes = {}, t0 = Date.now(), freq = {}, fanHist = {};
while (tested < N) {
  var ctx = genHand();
  if (!ctx) continue;
  tested++;
  var real = S.evaluate(ctx);
  var ref = refBest(ctx);
  (real.items || []).forEach(function (it) { freq[it.id] = (freq[it.id] || 0) + 1; }); fanHist[real.fan] = (fanHist[real.fan] || 0) + 1;
  if (!real.winning || !ref) { mism++; var kk0 = 'notWinning'; (classes[kk0] = classes[kk0] || []).push({ ctx: ctx, real: real, ref: ref }); continue; }
  if (real.fan !== ref.fan) {
    mism++;
    var ri2 = {}; real.items.forEach(function (it) { ri2[it.id] = (ri2[it.id] || 0) + it.fan; });
    var diff = Object.keys(Object.assign({}, ri2, ref.items)).filter(function (id) { return (ri2[id] || 0) !== (ref.items[id] || 0); }).sort().join(',');
    (classes[diff] = classes[diff] || []).push({ ctx: ctx, real: real, ref: ref, realItems: ri2 });
  }
}
console.log('feature coverage: ' + JSON.stringify(freq));
console.log('fan histogram: ' + JSON.stringify(fanHist));
console.log('ref_scorer_diff: ' + tested + ' hands, ' + mism + ' mismatches, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
Object.keys(classes).forEach(function (k) {
  var ex = classes[k][0], c = ex.ctx;
  console.log('\n== class [' + k + '] x' + classes[k].length);
  console.log('  hand ' + T.format(c.hand) + ' melds ' + c.melds.map(function (m) { return (m.concealed ? 'c' : '') + m.type + ' ' + T.format(m.tiles); }).join(' | ') +
    ' win ' + T.code(c.winTile) + ' ' + c.source + ' kr=' + c.kongReplacement + ' last=' + c.lastTile + ' seat=' + c.seatWind + ' round=' + c.roundWind +
    ' flowers=' + T.format(c.flowers) + ' kongOpt=' + c.settings.optional.kong);
  console.log('  real ' + ex.real.fan + ' ' + JSON.stringify(ex.realItems || {}) + '   ref ' + (ex.ref && ex.ref.fan) + ' ' + JSON.stringify(ex.ref && ex.ref.items));
});
process.exit(mism ? 1 : 0);
