#!/usr/bin/env node
/* HK Mahjong — tests/hand.test.js  (Owner: back end)
 * Unit + fuzz tests for core/hand.js: decompositions, winning shapes, waits, exact shanten vs a brute-force oracle.
 *   node tests/hand.test.js [--quick]
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', 'src', 'core');
require(path.join(CORE, 'tiles.js'));
require(path.join(CORE, 'rng.js'));
require(path.join(CORE, 'hand.js'));
var HK = globalThis.HKMJ, T = HK.Tiles, H = HK.Hand;
var QUICK = process.argv.indexOf('--quick') >= 0;

var passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('FAIL ' + msg); } }
function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, msg + ' — got ' + A + ', want ' + B); }
function P(s) { return T.parse(s); }
function meld(s) {
  var p = s.split(' '), t = P(p[1]);
  if (p[0] === 'chow') return { type: 'chow', tiles: T.sort(t), concealed: false };
  var k = t[0];
  if (p[0] === 'pong') return { type: 'pong', tiles: [k, k, k], concealed: false };
  return { type: 'kong', tiles: [k, k, k, k], concealed: p[0] === 'ckong' };
}
var ALL_ON = { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true };
var ALL_OFF = { kong: false, sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false };

// ------------------------------------------------------------------------------------------------ decompositions
(function () {
  var d = H.decompositions(P('111222333m 東東'), 1);
  eq(d.length, 2, '111222333m 東東: triplets or runs');
  ok(d.some(function (x) { return x.sets.every(function (s) { return s.type === 'pong'; }); }), 'all-pong reading present');
  ok(d.some(function (x) { return x.sets.every(function (s) { return s.type === 'chow'; }); }), 'all-chow reading present');
  eq(H.decompositions(P('1112345678999m 5m'), 0).length, 1, 'nine gates +5: one reading');
  eq(H.decompositions(P('11123m'), 3).length, 1, '11123m with 3 melds');
  eq(H.decompositions(P('123m 456p 789s 中中中 5s'), 0).length, 0, '13 tiles is never a decomposition');
  var d2 = H.decompositions(P('11223344556677m'), 0);
  ok(d2.length >= 3, '11223344556677m has several readings (' + d2.length + ')');
  var keys = d2.map(function (x) { return x.pair + ':' + x.sets.map(function (s) { return s.type + s.tiles[0]; }).sort().join(','); });
  eq(keys.length, new Set(keys).size, 'decompositions are unique');
})();

// ------------------------------------------------------------------------------------------------ shapes
(function () {
  ok(H.isWinningShape(P('123m 456p 789s 中中中 55s'), [], ALL_ON), 'standard');
  ok(!H.isWinningShape(P('123m 456p 789s 中中中 56s'), [], ALL_ON), 'not winning');
  ok(H.isWinningShape(P('22m 55m 88m 33p 66p 44s 中中'), [], ALL_ON), 'seven pairs');
  ok(!H.isWinningShape(P('22m 55m 88m 33p 66p 44s 中中'), [], { sevenPairs: false }), 'seven pairs off');
  ok(H.isWinningShape(P('中中中中 55m 88m 11p 55p 33s'), [], ALL_ON), 'luxury');
  ok(!H.isWinningShape(P('中中中中 55m 88m 11p 55p 33s'), [], { luxurySevenPairs: false }), 'luxury off');
  ok(H.isWinningShape(P('19m 19p 19s 東南西北中發白 9s'), [], ALL_OFF), 'thirteen orphans (never optional)');
  ok(H.isWinningShape(P('147m 258p 369s 中中'), [meld('chow 234s')], ALL_ON), 'knitted + claimed chow');
  ok(H.isWinningShape(P('147m 258p 369s 中中'), [meld('kong 7s')], ALL_ON), 'knitted + kong');
  ok(!H.isWinningShape(P('147m 258p 369s 中中'), [meld('chow 234s')], { knitted: false }), 'knitted off');
  ok(H.isWinningShape(P('147p 258s 369m 234s 中中'), [], ALL_ON), 'knitted, another suit assignment');
  ok(!H.isWinningShape(P('147m 258m 369s 234s 中中'), [], ALL_ON), 'two runs in one suit is not knitted');
  ok(H.isWinningShape(P('147m 258p 369s 東南西北白'), [], ALL_ON), 'lesser honours 9+5');
  ok(H.isWinningShape(P('147s 258m 36p 東南西北中發'), [], ALL_ON), 'lesser honours 8+6');
  ok(!H.isWinningShape(P('147s 258m 3p 東南西北中發 5s'), [], ALL_ON), 'mixed arrangements are not lesser honours');
  ok(H.isWinningShape(P('147m 258p 3s 東南西北中發白'), [], ALL_ON), 'greater honours 7+7');
  ok(!H.isWinningShape(P('147m 258p 3s 東南西北中發白'), [], { greaterHonours: false }), '7+7 is not lesser honours');
  ok(!H.isWinningShape(P('147m 258p 369s 東南西北白'), [], { lesserHonours: false }), 'lesser honours off');
  ok(H.isWinningShape(P('14m 258p 369s 東南西北中發'), [], { greaterHonours: false, lesserHonours: true }), '8 knitted (any 8) + 6 honours');
  ok(!H.isWinningShape(P('14m 258p 369s 東南西北中中'), [], ALL_ON), 'a repeated honour breaks Lesser Honours');
  var ws = H.winningShapes(P('11223344556677m'), [], ALL_ON);
  ok(ws.some(function (s) { return s.pattern === 'sevenPairs'; }) && ws.some(function (s) { return s.pattern === 'standard'; }), 'both seven pairs and standard shapes reported');
  eq(H.winningShapes(P('1112345678999s 5s'), [], ALL_ON).map(function (s) { return s.pattern; }), ['standard'], 'nine gates is a standard shape');
})();

// ------------------------------------------------------------------------------------------------ waits
(function () {
  eq(H.waits(P('1112345678999m'), [], ALL_ON).map(T.code), ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'], 'nine gates waits');
  eq(H.waits(P('19m 19p 19s 東南西北中發白'), [], ALL_ON).length, 13, 'thirteen orphans 13-sided wait');
  eq(H.waits(P('22m 55m 88m 33p 66p 44s 中'), [], ALL_ON).map(T.code), ['中'], 'seven pairs single wait');
  eq(H.waits(P('123m 456p 789s 11s 5p'), [], ALL_ON).length, 0, 'wrong tile count (14) gives no waits');
  eq(H.waits(P('1111m 23m 456p 789p 東'), [], ALL_OFF).map(T.code), ['東'], '1111m 23m: 111m + 123m, single wait on 東');
  eq(H.waits(P('23m 456p 789s 中中 55p 6p'), [meld('pong 1m')].slice(0, 0), ALL_OFF).length, 0, 'no melds but 10 tiles: no waits');
  // exhausted wait: 3 中 in a declared Pong + 1 in hand -> the pair wait on 中 is dead
  var hand = P('中 123m 456p 789s'), melds = [meld('pong 中')];
  eq(H.waits(hand, melds, ALL_OFF), [], 'a wait on the 5th copy is not a wait');
  eq(H.shanten(hand, melds, ALL_OFF), 1, 'exact shanten sees the dead wait (melds passed as array)');
  eq(H.shanten(hand, 1, ALL_OFF), 0, 'with only a meld count the melded tiles are unknown');
})();

// ------------------------------------------------------------------------------------------------ brute-force oracle
var SETS = [];
for (var k0 = 0; k0 < 34; k0++) SETS.push([k0, k0, k0]);
for (var s0 = 0; s0 < 3; s0++) for (var r0 = 0; r0 < 7; r0++) { var b0 = s0 * 9 + r0; SETS.push([b0, b0 + 1, b0 + 2]); }
/** min tiles missing from any standard winning hand with M sets + pair, at most caps[k] of kind k */
function bruteStd(h, M, caps) {
  var best = 99, need = new Array(34).fill(0);
  (function rec(idx, depth, missing) {
    if (missing >= best) return;
    if (depth === M) {
      for (var p = 0; p < 34; p++) {
        if (need[p] + 2 > caps[p]) continue;
        var add = Math.max(0, need[p] + 2 - h[p]) - Math.max(0, need[p] - h[p]);
        if (missing + add < best) best = missing + add;
      }
      return;
    }
    for (var j = idx; j < SETS.length; j++) {
      var st = SETS[j], good = true, add2 = 0;
      for (var i = 0; i < 3; i++) { var t = st[i]; need[t]++; if (need[t] > caps[t]) good = false; if (need[t] > h[t]) add2++; }
      if (good) rec(j, depth + 1, missing + add2);
      for (i = 0; i < 3; i++) need[st[i]]--;
    }
  })(0, 0, 0);
  return best;
}
function bruteSevenPairs(h, lux) {
  // choose 7 pair-slots (a kind may give two slots with luxury), maximise tiles already held; exhaustive over held kinds
  var kinds = [];
  for (var k = 0; k < 34; k++) if (h[k]) kinds.push(k);
  var best = 0;
  (function rec(i, slots, used) {
    if (used > best) best = used;
    if (slots === 7 || i === kinds.length) return;
    var x = h[kinds[i]];
    rec(i + 1, slots, used);
    rec(i + 1, slots + 1, used + Math.min(x, 2));
    if (lux && slots <= 5) rec(i + 1, slots + 2, used + Math.min(x, 4));
  })(0, 0, 0);
  return 14 - best; // missing tiles (zero-value slots are filled with new pairs)
}
function bruteOrphans(h) {
  var best = 99;
  for (var d = 0; d < 13; d++) {
    var miss = 0;
    for (var i = 0; i < 13; i++) { var k = H.ORPHANS[i], need = i === d ? 2 : 1; miss += Math.max(0, need - h[k]); }
    best = Math.min(best, miss);
  }
  return best;
}
function bruteHonours(h, o) {
  var best = 99;
  for (var a = 0; a < 6; a++) {
    // try every split: nK knitted + nH honours
    [[9, 5], [8, 6], [7, 7]].forEach(function (sp) {
      if ((sp[1] === 7 && !o.greaterHonours) || (sp[1] !== 7 && !o.lesserHonours)) return;
      var kd = 0, hd = 0;
      H.KNIT[a].forEach(function (k) { if (h[k]) kd++; });
      for (var k = 27; k < 34; k++) if (h[k]) hd++;
      best = Math.min(best, 14 - Math.min(kd, sp[0]) - Math.min(hd, sp[1]));
    });
  }
  return best;
}
function bruteKnitted(h, mc, caps) {
  var best = 99;
  for (var a = 0; a < 6; a++) {
    var h2 = h.slice(), c2 = caps.slice(), miss = 0, bad = false;
    H.KNIT[a].forEach(function (k) { if (c2[k] < 1) bad = true; c2[k]--; if (h2[k] > 0) h2[k]--; else miss++; });
    if (bad) continue;
    best = Math.min(best, miss + bruteStd(h2, 1 - mc, c2));
  }
  return best;
}
function oracleShanten(hand, melds, o) {
  var h = H.counts(hand), mc = melds.length;
  var caps = H.capsFromMelds(melds) || new Array(34).fill(4);
  var miss = bruteStd(h, 4 - mc, caps);
  if (mc === 0) {
    if (o.sevenPairs) miss = Math.min(miss, bruteSevenPairs(h, o.luxurySevenPairs));
    miss = Math.min(miss, bruteOrphans(h));
    if (o.lesserHonours || o.greaterHonours) miss = Math.min(miss, bruteHonours(h, o));
  }
  if (o.knitted && mc <= 1) miss = Math.min(miss, bruteKnitted(h, mc, caps));
  return miss - 1;
}

function randomDeal(rng, bias) {
  // bias: 0 = uniform wall; 1 = honours/terminal heavy; 2 = one-suit heavy; 3 = pairs heavy
  var wall = rng.shuffle(T.fullSet().filter(function (k) { return k < 34; }));
  if (bias === 1) wall.sort(function (a, b) { return (T.isTerminalOrHonour(b) ? 1 : 0) - (T.isTerminalOrHonour(a) ? 1 : 0) || (rng.next() - 0.5); });
  if (bias === 2) { var s = rng.int(3); wall.sort(function (a, b) { return (T.suitOf(b) === s ? 1 : 0) - (T.suitOf(a) === s ? 1 : 0) || (rng.next() - 0.5); }); }
  return wall;
}
function randomHand(rng, withMelds) {
  var bias = rng.int(4);
  var wall = randomDeal(rng, bias);
  var melds = [], pos = 0;
  var mc = withMelds ? rng.int(3) : 0;
  var used = new Array(34).fill(0);
  for (var m = 0; m < mc; m++) {
    var k = wall[pos++], r = rng.next();
    if (T.isSuit(k) && k % 9 <= 6 && r < 0.4 && used[k] < 4 && used[k + 1] < 4 && used[k + 2] < 4) { melds.push({ type: 'chow', tiles: [k, k + 1, k + 2], concealed: false }); used[k]++; used[k + 1]++; used[k + 2]++; }
    else if (r < 0.8 && used[k] <= 1) { melds.push({ type: 'pong', tiles: [k, k, k], concealed: false }); used[k] += 3; }
    else if (used[k] === 0) { melds.push({ type: 'kong', tiles: [k, k, k, k], concealed: rng.next() < 0.5 }); used[k] += 4; }
  }
  var size = 13 - 3 * melds.length + rng.int(2);
  var hand = [];
  for (var q = pos; q < wall.length && hand.length < size; q++) {
    var kk = wall[q];
    if (bias === 3 && hand.length && rng.next() < 0.35) kk = hand[rng.int(hand.length)];
    if (used[kk] >= 4) continue;
    used[kk]++; hand.push(kk);
  }
  return { hand: hand, melds: melds };
}

(function () {
  var rng = HK.RNG(20260926);
  var N = QUICK ? 300 : 1500, bad = 0;
  var optsList = [ALL_ON, ALL_OFF, { sevenPairs: true, luxurySevenPairs: false, knitted: false, lesserHonours: true, greaterHonours: false }];
  for (var i = 0; i < N; i++) {
    var x = randomHand(rng, i % 3 !== 0);
    var o = optsList[i % optsList.length];
    var want = oracleShanten(x.hand, x.melds, o);
    var got = H.shanten(x.hand, x.melds, o);
    if (want !== got) { bad++; if (bad < 8) console.log('  shanten mismatch', T.format(x.hand), x.melds.map(function (m) { return m.type + T.format(m.tiles); }).join(','), JSON.stringify(o), 'oracle', want, 'got', got); }
  }
  ok(bad === 0, 'shanten equals brute force on ' + N + ' random hands (' + bad + ' mismatches)');
})();

// ------------------------------------------------------------------------------------------------ complete <=> shanten -1, waits <=> shanten 0
(function () {
  var rng = HK.RNG(99);
  var N = QUICK ? 300 : 2000, bad1 = 0, bad2 = 0, bad3 = 0, tested = 0, complete = 0;
  for (var i = 0; i < N; i++) {
    var x = randomHand(rng, i % 2 === 0);
    var o = i % 4 === 0 ? ALL_OFF : ALL_ON;
    var need14 = 14 - 3 * x.melds.length;
    var hand = x.hand.slice(0, need14 - 1);
    if (hand.length !== need14 - 1) continue;
    tested++;
    var w = H.waits(hand, x.melds, o);
    var sh = H.shanten(hand, x.melds, o);
    // waits non-empty => shanten 0 ; shanten 0 with no waits only when every wait is exhausted
    if (w.length && sh !== 0) bad1++;
    for (var k = 0; k < 34; k++) {
      var h2 = hand.concat([k]);
      var c = H.counts(h2);
      var held = c[k] + x.melds.reduce(function (a, m) { return a + m.tiles.filter(function (t) { return t === k; }).length; }, 0);
      if (held > 4) continue;
      var win = H.isWinningShape(h2, x.melds, o);
      var s2 = H.shanten(h2, x.melds, o);
      if (win) complete++;
      if (win !== (s2 === -1)) bad2++;
      if (win !== (w.indexOf(k) >= 0)) bad3++;
    }
  }
  ok(bad1 === 0, 'non-empty waits imply shanten 0 (' + bad1 + ')');
  ok(bad2 === 0, 'isWinningShape <=> shanten === -1 (' + bad2 + ' of ' + tested * 34 + ', ' + complete + ' complete)');
  ok(bad3 === 0, 'waits() lists exactly the completing tiles (' + bad3 + ')');
})();

// constructed complete hands (standard with melds + every special shape)
(function () {
  var rng = HK.RNG(5), bad = 0, n = 0;
  for (var i = 0; i < (QUICK ? 300 : 1500); i++) {
    var used = new Array(34).fill(0), melds = [], conc = [];
    var mc = rng.int(5);
    function take(tiles) { for (var j = 0; j < tiles.length; j++) if (used[tiles[j]] + tiles.filter(function (t) { return t === tiles[j]; }).length > 4) return false; tiles.forEach(function (t) { used[t]++; }); return true; }
    var guard = 0;
    while (melds.length + conc.length < 4 && guard++ < 50) {
      var k = rng.int(34), set;
      if (T.isSuit(k) && k % 9 <= 6 && rng.next() < 0.5) set = { type: 'chow', tiles: [k, k + 1, k + 2] };
      else set = { type: 'pong', tiles: [k, k, k] };
      var asMeld = melds.length < mc;
      if (asMeld && rng.next() < 0.3 && set.type === 'pong') set = { type: 'kong', tiles: [k, k, k, k], concealed: rng.next() < 0.5 };
      if (!take(set.tiles)) continue;
      if (asMeld) { set.concealed = !!set.concealed; melds.push(set); } else conc = conc.concat(set.tiles);
    }
    var p = rng.int(34);
    if (used[p] > 2 || melds.length + conc.length / 3 !== 4) continue;
    used[p] += 2; conc.push(p, p);
    n++;
    if (!H.isWinningShape(conc, melds, ALL_ON) || H.shanten(conc, melds, ALL_ON) !== -1) { bad++; if (bad < 5) console.log('  not complete?', T.format(conc), JSON.stringify(melds)); }
  }
  ok(bad === 0, n + ' constructed standard hands are complete (' + bad + ')');
})();

// ------------------------------------------------------------------------------------------------ plan shanten helpers used by the AI
(function () {
  var c = H.counts(P('123m 456m 789m 東東 5p 6p'));
  eq(H.planShanten(c, 0, null, { structure: 'std' }), 0, 'unrestricted: tenpai on 4p/7p');
  eq(H.planShanten(c, 0, null, { structure: 'std', suitMask: 1, honours: true }), 2, 'mixed flush in m: 5p 6p must go, 3 tiles missing');
  eq(H.planShanten(c, 0, null, { structure: 'std', suitMask: 1, honours: false }), 4, 'full flush in m: only 123 456 789m count, 5 tiles missing');
  eq(H.planShanten(H.counts(P('111m 222p 33s 44s 東東 中')), 0, null, { structure: 'pongs' }), 1, 'pongs-only plan');
  eq(H.planShanten(H.counts(P('123m 456p 789s 中 東東 55s')), 0, null, { structure: 'std', forced: [31] }), 1, 'forced 中 pong');
  ok(H.planShanten(H.counts(P('123m')), 3, null, { structure: 'sevenPairs' }) === Infinity, 'seven pairs impossible with melds');
  eq(H.planShanten(H.counts(P('123m 456m 789p 中中中 5s')), 0, null, { structure: 'chows' }), 1, 'chows only: 中中 can only be the pair');
  eq(H.planShanten(H.counts(P('123m 456m 789p 中中中 5s')), 0, null, { structure: 'std' }), 0, 'unrestricted: 中中中 is a set');
  eq(H.planShanten(H.counts(P('中中中 發發發 白 123m 456m 9s')), 0, null, { structure: 'std', forced: [31, 32], forcedPair: 33 }), 0, 'small three dragons plan');
})();

// restricted plans vs a restricted brute force
(function () {
  function brutePlan(h, M, caps, plan) {
    var st = plan.structure, mask = plan.suitMask === undefined ? 7 : plan.suitMask, hon = plan.honours !== false;
    function allowed(k) { return k >= 27 ? hon : !!(mask & (1 << Math.floor(k / 9))); }
    var sets = SETS.filter(function (s) {
      var isPong = s[0] === s[1];
      if (st === 'pongs' && !isPong) return false;
      if (st === 'chows' && isPong) return false;
      return allowed(s[0]) && allowed(s[2]);
    });
    var h2 = h.slice(), c2 = caps.slice(), miss = 0, Mx = M;
    for (var f = 0; f < (plan.forced || []).length; f++) {
      var k = plan.forced[f];
      if (c2[k] < 3) return 99;
      c2[k] -= 3; var tk = Math.min(h2[k], 3); miss += 3 - tk; h2[k] -= tk; Mx--;
    }
    var fp = plan.forcedPair;
    if (fp !== undefined && fp !== null) { if (c2[fp] < 2) return 99; c2[fp] -= 2; var tp = Math.min(h2[fp], 2); miss += 2 - tp; h2[fp] -= tp; }
    var best = 99, need = new Array(34).fill(0);
    (function rec(idx, depth, missing) {
      if (missing >= best) return;
      if (depth === Mx) {
        if (fp !== undefined && fp !== null) { best = Math.min(best, missing); return; }
        for (var p = 0; p < 34; p++) {
          if (!allowed(p) || need[p] + 2 > c2[p]) continue;
          var add = Math.max(0, need[p] + 2 - h2[p]) - Math.max(0, need[p] - h2[p]);
          if (missing + add < best) best = missing + add;
        }
        return;
      }
      for (var j = idx; j < sets.length; j++) {
        var s = sets[j], good = true, add2 = 0;
        for (var i = 0; i < 3; i++) { var t = s[i]; need[t]++; if (need[t] > c2[t]) good = false; if (need[t] > h2[t]) add2++; }
        if (good) rec(j, depth + 1, missing + add2);
        for (i = 0; i < 3; i++) need[s[i]]--;
      }
    })(0, 0, miss);
    return best;
  }
  var rng = HK.RNG(4242), bad = 0, N = QUICK ? 200 : 800;
  var structures = ['std', 'pongs', 'chows'];
  for (var i = 0; i < N; i++) {
    var x = randomHand(rng, i % 2 === 0);
    var mc = x.melds.length, caps = H.capsFromMelds(x.melds) || new Array(34).fill(4);
    var plan = { structure: structures[i % 3] };
    if (rng.next() < 0.5) { plan.suitMask = 1 << rng.int(3); plan.honours = rng.next() < 0.6; }
    if (plan.structure !== 'chows' && rng.next() < 0.4) plan.forced = [27 + rng.int(7)];
    if (rng.next() < 0.2) plan.forcedPair = 31 + rng.int(3);
    if (plan.forced && plan.forced[0] === plan.forcedPair) delete plan.forcedPair;
    var h = H.counts(x.hand);
    var want = brutePlan(h, 4 - mc, caps, plan);
    want = want >= 99 ? Infinity : want - 1;
    var got = H.planShanten(h, mc, mc ? caps : null, plan);
    if (want !== got) { bad++; if (bad < 6) console.log('  plan mismatch', T.format(x.hand), JSON.stringify(plan), 'oracle', want, 'got', got); }
  }
  ok(bad === 0, 'plan-restricted shanten equals a restricted brute force on ' + N + ' hands (' + bad + ')');
})();

// ------------------------------------------------------------------------------------------------ performance
(function () {
  var rng = HK.RNG(1234), hands = [];
  for (var i = 0; i < 3000; i++) hands.push(randomHand(rng, i % 2 === 0));
  var t0 = process.hrtime.bigint();
  for (var j = 0; j < hands.length; j++) H.shanten(hands[j].hand, hands[j].melds.length, ALL_ON);
  var ms = Number(process.hrtime.bigint() - t0) / 1e6;
  var t1 = process.hrtime.bigint();
  for (var rep = 0; rep < 3; rep++) for (j = 0; j < hands.length; j++) H.shanten(hands[j].hand, hands[j].melds.length, ALL_OFF);
  var ms2 = Number(process.hrtime.bigint() - t1) / 1e6 / 3;
  console.log('  perf: shanten (all shapes, cold-ish) ' + (ms * 1000 / hands.length).toFixed(1) + ' us/call; standard+7p+13o warm ' + (ms2 * 1000 / hands.length).toFixed(1) + ' us/call');
  ok(ms2 / hands.length < 0.2, 'warm shanten < 200 us per call');
})();

console.log('hand.test: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
