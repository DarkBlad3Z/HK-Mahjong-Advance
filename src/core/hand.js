/* HK Mahjong — core/hand.js  (Owner: back end)
 * Hand analysis: standard decompositions, special winning shapes, exact shanten, waits.
 *
 * Public API (SPEC §4):
 *   Hand.counts(kinds) -> int[34]
 *   Hand.decompositions(concealedKinds, meldCount) -> [{sets:[{type:'chow'|'pong', tiles}], pair:kind}]
 *   Hand.winningShapes(concealedKinds, melds, optional) -> [{pattern, ...}]
 *   Hand.isWinningShape(concealedKinds, melds, optional) -> bool
 *   Hand.shanten(concealedKinds, meldCountOrMelds, optional) -> int   (-1 = complete)
 *   Hand.waits(concealed13, melds, optional) -> kinds[]
 *
 * Shanten here is EXACT in the "tile exchange" sense: shanten = (tiles still missing from the nearest winning
 * hand) - 1, where the winning hand may hold at most 4 of a kind (so a 5th copy is never counted on).  It is
 * computed by a per-suit dynamic programme that is memoised by the suit's count vector, so repeated calls are
 * cheap.  `melds` may be passed as an array (then the tiles inside the melds also limit what can be added) or as
 * a plain meld count.  Enabled optional shapes (Seven Pairs, Knitted, Lesser/Greater Honours) and Thirteen Orphans
 * are included, so shanten === -1 exactly when isWinningShape() is true.
 *
 * Extra helpers for the AI (not part of the SPEC contract): Hand.maxUsed(), Hand.planShanten(), Hand.KNIT, ...
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var N = 34;

  var DEFAULT_OPT = { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true, chicken: 'minimum' };
  /** Chicken-hand table rule: 'minimum' (booklet: like any hand, only if it reaches the Minimum Fan), 'always'
   *  (may win even below the minimum) or 'never'. Booleans are accepted too: true = 'always', false = 'never'. */
  function chickenRule(v) {
    if (v === 'always' || v === 'never' || v === 'minimum') return v;
    if (v === true) return 'always';
    if (v === false) return 'never';
    return 'minimum';
  }
  function optOf(o) {
    if (!o) return DEFAULT_OPT;
    return {
      kong: o.kong === undefined ? DEFAULT_OPT.kong : !!o.kong,
      sevenPairs: o.sevenPairs === undefined ? DEFAULT_OPT.sevenPairs : !!o.sevenPairs,
      luxurySevenPairs: o.luxurySevenPairs === undefined ? DEFAULT_OPT.luxurySevenPairs : !!o.luxurySevenPairs,
      knitted: o.knitted === undefined ? DEFAULT_OPT.knitted : !!o.knitted,
      lesserHonours: o.lesserHonours === undefined ? DEFAULT_OPT.lesserHonours : !!o.lesserHonours,
      greaterHonours: o.greaterHonours === undefined ? DEFAULT_OPT.greaterHonours : !!o.greaterHonours,
      chicken: chickenRule(o.chicken)   // table rule: may a chicken hand 雞糊 win? 'minimum' | 'always' | 'never'
    };
  }

  function counts(kinds) {
    var c = new Array(N);
    for (var i = 0; i < N; i++) c[i] = 0;
    if (kinds) for (var j = 0; j < kinds.length; j++) { var k = kinds[j]; if (k >= 0 && k < N) c[k]++; }
    return c;
  }
  function sumCounts(c) { var s = 0; for (var i = 0; i < N; i++) s += c[i]; return s; }
  function meldCountOf(melds) { return typeof melds === 'number' ? melds : (melds ? melds.length : 0); }
  /** caps[k] = 4 - copies of k inside the declared melds (null when there are no melds) */
  function capsFromMelds(melds) {
    if (!melds || typeof melds === 'number' || !melds.length) return null;
    var caps = new Array(N);
    for (var i = 0; i < N; i++) caps[i] = 4;
    for (var m = 0; m < melds.length; m++) {
      var t = melds[m].tiles || [];
      for (var j = 0; j < t.length; j++) if (t[j] >= 0 && t[j] < N) caps[t[j]]--;
    }
    for (i = 0; i < N; i++) if (caps[i] < 0) caps[i] = 0;
    return caps;
  }

  // ------------------------------------------------------------------------------------------------ knitted
  // Arrangement a: PERMS[a][0] is the suit holding 1-4-7, [1] holds 2-5-8, [2] holds 3-6-9.
  var PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  var KNIT = PERMS.map(function (p) {
    var ks = [];
    for (var j = 0; j < 3; j++) for (var r = j; r < 9; r += 3) ks.push(p[j] * 9 + r);
    return ks.sort(function (a, b) { return a - b; });
  });
  var KNIT_SET = KNIT.map(function (ks) { var m = new Array(N); for (var i = 0; i < N; i++) m[i] = false; ks.forEach(function (k) { m[k] = true; }); return m; });
  var ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  // ------------------------------------------------------------------------------------------------ decompositions
  function enumSets(c, start, sets, out, pair) {
    var i = start;
    while (i < N && c[i] === 0) i++;
    if (i === N) {
      out.push({ sets: sets.map(function (s) { return { type: s.type, tiles: s.tiles.slice() }; }), pair: pair });
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3; sets.push({ type: 'pong', tiles: [i, i, i] });
      enumSets(c, i, sets, out, pair);
      sets.pop(); c[i] += 3;
    }
    if (i < 27 && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: 'chow', tiles: [i, i + 1, i + 2] });
      enumSets(c, i, sets, out, pair);
      sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }
  /** All standard decompositions of the concealed tiles into (4 - meldCount) sets + 1 pair (each multiset once). */
  function decompositions(concealedKinds, meldCount) {
    var c = counts(concealedKinds);
    var M = 4 - (meldCount | 0);
    if (M < 0 || sumCounts(c) !== 3 * M + 2) return [];
    return decompCounts(c);
  }
  function decompCounts(c) {
    var out = [];
    for (var p = 0; p < N; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2;
      enumSets(c, 0, [], out, p);
      c[p] += 2;
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ fast complete test
  // suitShape(key) bit 1: all tiles form sets; bit 2: sets + exactly one pair.
  var shapeMemo = new Map();
  function canSets9(a) {
    var i = 0;
    while (i < 9 && a[i] === 0) i++;
    if (i === 9) return true;
    if (a[i] >= 3) { a[i] -= 3; var ok = canSets9(a); a[i] += 3; if (ok) return true; }
    if (i <= 6 && a[i + 1] > 0 && a[i + 2] > 0) {
      a[i]--; a[i + 1]--; a[i + 2]--;
      var ok2 = canSets9(a);
      a[i]++; a[i + 1]++; a[i + 2]++;
      if (ok2) return true;
    }
    return false;
  }
  function suitShape(c, off) {
    var key = 0, tot = 0;
    for (var i = 8; i >= 0; i--) { key = key * 5 + c[off + i]; tot += c[off + i]; }
    var v = shapeMemo.get(key);
    if (v !== undefined) return v;
    var a = c.slice(off, off + 9);
    v = 0;
    if (tot % 3 === 0) { if (canSets9(a)) v |= 1; }
    else if (tot % 3 === 2) {
      for (i = 0; i < 9; i++) if (a[i] >= 2) { a[i] -= 2; var ok = canSets9(a); a[i] += 2; if (ok) { v |= 2; break; } }
    }
    shapeMemo.set(key, v);
    return v;
  }
  /** c: counts of the concealed tiles; true if they form sets + one pair (any number of sets). */
  function isStdCompleteCounts(c) {
    var pairs = 0;
    for (var s = 0; s < 3; s++) {
      var v = suitShape(c, s * 9);
      if (v & 1) continue;
      if (v & 2) { pairs++; continue; }
      return false;
    }
    for (var k = 27; k < 34; k++) {
      var x = c[k];
      if (x === 0 || x === 3) continue;
      if (x === 2) { pairs++; continue; }
      return false;
    }
    return pairs === 1;
  }

  // ------------------------------------------------------------------------------------------------ special shapes
  function sevenPairsInfo(c, luxury) {
    var pairs = [], quads = 0;
    for (var k = 0; k < N; k++) {
      if (c[k] === 0) continue;
      if (c[k] === 2) pairs.push(k);
      else if (c[k] === 4 && luxury) { pairs.push(k, k); quads++; }
      else return null;
    }
    return pairs.length === 7 ? { pairs: pairs, luxury: quads } : null;
  }
  function thirteenOrphansPair(c) {
    var pair = -1;
    for (var k = 0; k < N; k++) {
      var isO = ORPHANS.indexOf(k) >= 0;
      if (!isO) { if (c[k]) return -1; continue; }
      if (c[k] === 1) continue;
      if (c[k] === 2 && pair < 0) { pair = k; continue; }
      return -1;
    }
    return pair;
  }
  /** Lesser / Greater Honours: returns [{pattern, arrangement, knitted, honours}] (0 or 1 entries per pattern) */
  function honoursShapes(c, o) {
    var out = [];
    if (!o.lesserHonours && !o.greaterHonours) return out;
    var honours = [], suits = [];
    for (var k = 0; k < N; k++) {
      if (c[k] > 1) return out;
      if (c[k] === 1) (k >= 27 ? honours : suits).push(k);
    }
    if (honours.length + suits.length !== 14) return out;
    var pattern = null;
    if (honours.length === 7) { if (o.greaterHonours) pattern = 'greaterHonours'; }
    else if (honours.length === 5 || honours.length === 6) { if (o.lesserHonours) pattern = 'lesserHonours'; }
    if (!pattern) return out;
    for (var a = 0; a < 6; a++) {
      var ok = true;
      for (var i = 0; i < suits.length; i++) if (!KNIT_SET[a][suits[i]]) { ok = false; break; }
      if (ok) { out.push({ pattern: pattern, arrangement: a, knitted: suits.slice(), honours: honours.slice() }); break; }
    }
    return out;
  }
  function knittedShapes(c, melds) {
    var out = [];
    var mc = meldCountOf(melds);
    if (mc > 1) return out;
    for (var a = 0; a < 6; a++) {
      var ks = KNIT[a], ok = true;
      for (var i = 0; i < 9; i++) if (c[ks[i]] < 1) { ok = false; break; }
      if (!ok) continue;
      for (i = 0; i < 9; i++) c[ks[i]]--;
      var rest = decompCounts(c);
      for (i = 0; i < 9; i++) c[ks[i]]++;
      for (var d = 0; d < rest.length; d++) {
        if (rest[d].sets.length + mc !== 1) continue;
        out.push({ pattern: 'knitted', arrangement: a, knitted: ks.slice(), sets: rest[d].sets, pair: rest[d].pair, meldSet: mc === 1 });
      }
    }
    return out;
  }

  /** Every winning shape present in the concealed tiles (+ declared melds). */
  function winningShapes(concealedKinds, melds, optional) {
    var o = optOf(optional);
    var mc = meldCountOf(melds);
    var c = counts(concealedKinds);
    var n = sumCounts(c);
    var out = [];
    if (mc > 4 || n !== 14 - 3 * mc) return out;
    decompCounts(c).forEach(function (d) { if (d.sets.length === 4 - mc) out.push({ pattern: 'standard', sets: d.sets, pair: d.pair }); });
    if (mc === 0) {
      if (o.sevenPairs) { var sp = sevenPairsInfo(c, o.luxurySevenPairs); if (sp) out.push({ pattern: 'sevenPairs', pairs: sp.pairs, luxury: sp.luxury }); }
      var op = thirteenOrphansPair(c);
      if (op >= 0) out.push({ pattern: 'thirteenOrphans', pair: op });
      honoursShapes(c, o).forEach(function (s) { out.push(s); });
    }
    if (o.knitted && mc <= 1) knittedShapes(c, melds).forEach(function (s) { out.push(s); });
    return out;
  }

  function isWinningCounts(c, mc, o) {
    var n = sumCounts(c);
    if (mc > 4 || n !== 14 - 3 * mc) return false;
    if (isStdCompleteCounts(c)) return true;
    if (mc === 0) {
      if (o.sevenPairs && sevenPairsInfo(c, o.luxurySevenPairs)) return true;
      if (thirteenOrphansPair(c) >= 0) return true;
      if ((o.lesserHonours || o.greaterHonours) && honoursShapes(c, o).length) return true;
    }
    if (o.knitted && mc <= 1) {
      for (var a = 0; a < 6; a++) {
        var ks = KNIT[a], ok = true, i;
        for (i = 0; i < 9; i++) if (c[ks[i]] < 1) { ok = false; break; }
        if (!ok) continue;
        for (i = 0; i < 9; i++) c[ks[i]]--;
        var done = isStdCompleteCounts(c);
        for (i = 0; i < 9; i++) c[ks[i]]++;
        if (done) return true;
      }
    }
    return false;
  }
  function isWinningShape(concealedKinds, melds, optional) {
    return isWinningCounts(counts(concealedKinds), meldCountOf(melds), optOf(optional));
  }

  // ------------------------------------------------------------------------------------------------ exact shanten
  // A suit table T[s*2+q] = max number of the hand's tiles in this suit that a target configuration with exactly
  // s sets and q pairs (q<=1) can use, with at most cap[k] copies of each kind in the target (-1 = impossible).
  // mode 0 = chows + pongs (normal), 1 = pongs only, 2 = chows only (All Sequences plans)
  var suitMemo = [new Map(), new Map(), new Map()], honMemo = [new Map(), new Map(), new Map()];
  var MEMO_LIMIT = 400000;
  var P5_9 = 1953125; // 5^9
  function capKey(caps, off, len) {
    if (!caps) return 0;
    var k = 0;
    for (var i = len - 1; i >= 0; i--) k = k * 5 + (4 - caps[off + i]);
    return k;
  }
  function suitTable(c, off, caps, mode) {
    mode = mode | 0;
    var key = 0;
    for (var i = 8; i >= 0; i--) key = key * 5 + c[off + i];
    key += capKey(caps, off, 9) * P5_9;
    var memo = suitMemo[mode];
    var t = memo.get(key);
    if (t) return t;
    t = mode === 1 ? computeKindTable(c, off, 9, caps, false) : computeSuitTable(c, off, caps, mode === 2);
    if (memo.size > MEMO_LIMIT) memo.clear();
    memo.set(key, t);
    return t;
  }
  function honTable(c, caps, mode) {
    mode = mode | 0;
    var key = 0;
    for (var i = 6; i >= 0; i--) key = key * 5 + c[27 + i];
    key += capKey(caps, 27, 7) * 78125; // 5^7
    var memo = honMemo[mode];
    var t = memo.get(key);
    if (t) return t;
    t = computeKindTable(c, 27, 7, caps, mode === 2);
    if (memo.size > MEMO_LIMIT) memo.clear();
    memo.set(key, t);
    return t;
  }
  /** kinds combined independently (honours, or a suit without chows): pong 3 / pair 2 per kind */
  function computeKindTable(c, off, len, caps, pairOnly) {
    var dp = new Int8Array(10).fill(-1); dp[0] = 0;
    for (var j = 0; j < len; j++) {
      var h = c[off + j], cap = caps ? caps[off + j] : 4;
      var nd = dp.slice();
      var gPair = h < 2 ? h : 2, gPong = h < 3 ? h : 3;
      for (var st = 0; st < 10; st++) {
        var v = dp[st]; if (v < 0) continue;
        var s = st >> 1, q = st & 1;
        if (!q && cap >= 2) { var i1 = s * 2 + 1; if (v + gPair > nd[i1]) nd[i1] = v + gPair; }
        if (!pairOnly && s < 4 && cap >= 3) { var i2 = (s + 1) * 2 + q; if (v + gPong > nd[i2]) nd[i2] = v + gPong; }
      }
      dp = nd;
    }
    return dp;
  }
  function computeSuitTable(c, off, caps, noPong) {
    // state: ((x*5 + y)*5 + s)*2 + q ; x = chows started at i-2, y = chows started at i-1
    var cur = new Int8Array(250).fill(-1), nxt;
    cur[0] = 0;
    for (var i = 0; i < 9; i++) {
      nxt = new Int8Array(250).fill(-1);
      var h = c[off + i], cap = caps ? caps[off + i] : 4;
      var capN1 = i < 8 ? (caps ? caps[off + i + 1] : 4) : 0;
      var capN2 = i < 7 ? (caps ? caps[off + i + 2] : 4) : 0;
      var maxC = i <= 6 ? 4 : 0;
      for (var st = 0; st < 250; st++) {
        var v = cur[st]; if (v < 0) continue;
        var q = st & 1, r = st >> 1, s = r % 5; r = (r - s) / 5;
        var y = r % 5, x = (r - y) / 5;
        var base = x + y;
        if (base > cap) continue;
        for (var cc = 0; cc <= maxC; cc++) {
          if (base + cc > cap || s + cc > 4) break;
          if (y + cc > capN1 || cc > capN2) break;
          for (var p = 0; p <= (noPong ? 0 : 1); p++) {
            var u1 = base + cc + 3 * p;
            var s2 = s + cc + p;
            if (u1 > cap || s2 > 4) break;
            for (var pr = 0; pr <= 1 - q; pr++) {
              var u = u1 + 2 * pr;
              if (u > cap) break;
              var used = v + (h < u ? h : u);
              var ns = ((y * 5 + cc) * 5 + s2) * 2 + (q | pr);
              if (used > nxt[ns]) nxt[ns] = used;
            }
          }
        }
      }
      cur = nxt;
    }
    var t = new Int8Array(10);
    for (var s3 = 0; s3 < 5; s3++) for (var q3 = 0; q3 < 2; q3++) t[s3 * 2 + q3] = cur[s3 * 2 + q3];
    return t;
  }
  var ZERO_TABLE = (function () { var t = new Int8Array(10).fill(-1); t[0] = 0; return t; })();
  function combine(X, Y) {
    var Z = new Int8Array(10).fill(-1);
    for (var a = 0; a < 10; a++) {
      var xa = X[a]; if (xa < 0) continue;
      var sa = a >> 1, qa = a & 1;
      for (var b = 0; b < 10; b++) {
        var yb = Y[b]; if (yb < 0) continue;
        var s = sa + (b >> 1), q = qa + (b & 1);
        if (s > 4 || q > 1) continue;
        var idx = s * 2 + q;
        if (xa + yb > Z[idx]) Z[idx] = xa + yb;
      }
    }
    return Z;
  }
  function best4(A, B, C, H, M, pairs) {
    // max over sA+sB+sC+sH = M and exactly `pairs` (1 or 0) pairs
    var best = -1;
    for (var sa = 0; sa <= M; sa++) for (var sb = 0; sb <= M - sa; sb++) for (var sc = 0; sc <= M - sa - sb; sc++) {
      var sh = M - sa - sb - sc;
      var a0 = A[sa * 2], b0 = B[sb * 2], c0 = C[sc * 2], h0 = H[sh * 2];
      var v;
      if (pairs === 0) {
        if (a0 >= 0 && b0 >= 0 && c0 >= 0 && h0 >= 0) { v = a0 + b0 + c0 + h0; if (v > best) best = v; }
        continue;
      }
      var a1 = A[sa * 2 + 1], b1 = B[sb * 2 + 1], c1 = C[sc * 2 + 1], h1 = H[sh * 2 + 1];
      if (a1 >= 0 && b0 >= 0 && c0 >= 0 && h0 >= 0) { v = a1 + b0 + c0 + h0; if (v > best) best = v; }
      if (a0 >= 0 && b1 >= 0 && c0 >= 0 && h0 >= 0) { v = a0 + b1 + c0 + h0; if (v > best) best = v; }
      if (a0 >= 0 && b0 >= 0 && c1 >= 0 && h0 >= 0) { v = a0 + b0 + c1 + h0; if (v > best) best = v; }
      if (a0 >= 0 && b0 >= 0 && c0 >= 0 && h1 >= 0) { v = a0 + b0 + c0 + h1; if (v > best) best = v; }
    }
    return best;
  }
  /**
   * Max number of the hand's tiles usable by a standard winning hand with M sets + 1 pair.
   * opts (all optional): caps (int[34]), suitMask (bit s set = suit s allowed; default 7), honours (default true),
   *                      noChow (bool: triplets only), noPong (bool: sequences only, honours only as the pair),
   *                      pairs (1 default, 0 = the pair is already accounted for)
   */
  function stdMaxUsed(c, M, opts) {
    var caps = opts && opts.caps || null;
    var mask = (opts && opts.suitMask !== undefined) ? opts.suitMask : 7;
    var hon = !(opts && opts.honours === false);
    var mode = (opts && opts.noChow) ? 1 : (opts && opts.noPong) ? 2 : 0;
    var pairs = (opts && opts.pairs === 0) ? 0 : 1;
    var A = (mask & 1) ? suitTable(c, 0, caps, mode) : ZERO_TABLE;
    var B = (mask & 2) ? suitTable(c, 9, caps, mode) : ZERO_TABLE;
    var C = (mask & 4) ? suitTable(c, 18, caps, mode) : ZERO_TABLE;
    var H = hon ? honTable(c, caps, mode) : ZERO_TABLE;
    return best4(A, B, C, H, M, pairs);
  }
  function sevenPairsUsed(c, luxury) {
    var twos = 0, ones = 0;
    for (var k = 0; k < N; k++) {
      var x = c[k];
      if (x >= 2) { twos++; if (luxury) { if (x === 4) twos++; else if (x === 3) ones++; } }
      else if (x === 1) ones++;
    }
    var t = twos < 7 ? twos : 7;
    var rest = 7 - t;
    return 2 * t + (ones < rest ? ones : rest);
  }
  function orphansUsed(c) {
    var distinct = 0, dup = 0;
    for (var i = 0; i < 13; i++) { var x = c[ORPHANS[i]]; if (x) { distinct++; if (x >= 2) dup = 1; } }
    return distinct + dup;
  }
  function honoursUsed(c, o) {
    var hd = 0;
    for (var k = 27; k < 34; k++) if (c[k]) hd++;
    var best = -1;
    for (var a = 0; a < 6; a++) {
      var kd = 0, ks = KNIT[a];
      for (var i = 0; i < 9; i++) if (c[ks[i]]) kd++;
      if (o.lesserHonours) {
        best = Math.max(best, Math.min(kd, 9) + Math.min(hd, 5), Math.min(kd, 8) + Math.min(hd, 6));
      }
      if (o.greaterHonours) best = Math.max(best, Math.min(kd, 7) + Math.min(hd, 7));
    }
    return best;
  }
  function knittedUsed(c, mc, caps, atLeast) {
    // atLeast: only arrangements that could use more than this many tiles are examined (pruning)
    var best = -1;
    var M = 1 - mc;
    var restMax = 3 * M + 2;
    for (var a = 0; a < 6; a++) {
      var ks = KNIT[a], kp = 0;
      for (var q = 0; q < 9; q++) if (c[ks[q]] > 0) kp++;
      if (kp + restMax <= (atLeast === undefined ? -1 : atLeast) || kp + restMax <= best) continue;
      kp = 0;
      var c2 = c.slice();
      var caps2 = caps ? caps.slice() : null;
      if (!caps2) { caps2 = new Array(N); for (var z = 0; z < N; z++) caps2[z] = 4; }
      var feasible = true;
      for (var i = 0; i < 9; i++) {
        var k = ks[i];
        if (caps2[k] < 1) { feasible = false; break; }
        caps2[k]--;
        if (c2[k] > 0) { c2[k]--; kp++; }
      }
      if (!feasible) continue;
      var rest = stdMaxUsed(c2, M, { caps: caps2 });
      if (rest < 0) continue;
      if (kp + rest > best) best = kp + rest;
    }
    return best;
  }

  /** Exact shanten, min over the standard shape and every enabled special shape. */
  function shanten(concealedKinds, melds, optional) {
    return shantenCounts(counts(concealedKinds), melds, optional);
  }
  function shantenCounts(c, melds, optional) {
    var o = optOf(optional);
    var mc = meldCountOf(melds);
    var caps = capsFromMelds(melds);
    var W = 14 - 3 * mc;
    var used = stdMaxUsed(c, 4 - mc, { caps: caps });
    if (mc === 0) {
      if (o.sevenPairs) used = Math.max(used, sevenPairsUsed(c, o.luxurySevenPairs));
      used = Math.max(used, orphansUsed(c));
      if (o.lesserHonours || o.greaterHonours) used = Math.max(used, honoursUsed(c, o));
    }
    if (o.knitted && mc <= 1) used = Math.max(used, knittedUsed(c, mc, caps, used));
    return W - used - 1;
  }

  /**
   * Plan-restricted shanten for the AI.  plan = {
   *   structure: 'std' | 'pongs' | 'chows' | 'sevenPairs' | 'orphans' | 'honours' | 'knitted',
   *   suitMask (allowed suits, default 7), honours (honours allowed, default true),
   *   forced: [kinds that must appear as a triplet/quad in the concealed part] (std/pongs),
   *   forcedPair: kind that must be the pair (std/pongs/chows)
   * }
   * c = concealed counts, mc = meld count, caps = int[34] or null.  Returns Infinity when impossible.
   * Tiles outside the allowed set are simply never used (they are the tiles the plan throws away).
   */
  function planShanten(c, mc, caps, plan, optional) {
    var W = 14 - 3 * mc, used = -1;
    var st = plan.structure || 'std';
    if (st === 'std' || st === 'pongs' || st === 'chows') {
      var M = 4 - mc;
      var forced = plan.forced || [];
      var fp = (plan.forcedPair === undefined || plan.forcedPair === null) ? -1 : plan.forcedPair;
      var c2 = c, caps2 = caps, extra = 0, z;
      if (forced.length || fp >= 0) {
        if (forced.length > M) return Infinity;
        c2 = c.slice();
        caps2 = caps ? caps.slice() : null;
        if (!caps2) { caps2 = new Array(N); for (z = 0; z < N; z++) caps2[z] = 4; }
        for (var f = 0; f < forced.length; f++) {
          var k = forced[f];
          if (caps2[k] < 3) return Infinity;
          var take = c2[k] < 3 ? c2[k] : 3;
          c2[k] -= take; caps2[k] -= 3; extra += take;
        }
        M -= forced.length;
        if (fp >= 0) {
          if (caps2[fp] < 2) return Infinity;
          var tp = c2[fp] < 2 ? c2[fp] : 2;
          c2[fp] -= tp; caps2[fp] -= 2; extra += tp;
        }
      }
      used = stdMaxUsed(c2, M, { caps: caps2, suitMask: plan.suitMask, honours: plan.honours,
        noChow: st === 'pongs', noPong: st === 'chows', pairs: fp >= 0 ? 0 : 1 });
      if (used >= 0) used += extra;
    } else if (st === 'sevenPairs') {
      if (mc) return Infinity;
      used = sevenPairsUsed(plan.suitMask !== undefined || plan.honours === false ? maskCounts(c, plan) : c, optOf(optional).luxurySevenPairs);
    } else if (st === 'orphans') {
      if (mc) return Infinity;
      used = orphansUsed(c);
    } else if (st === 'honours') {
      if (mc) return Infinity;
      used = honoursUsed(c, optOf(optional));
    } else if (st === 'knitted') {
      if (mc > 1) return Infinity;
      used = knittedUsed(c, mc, caps);
    }
    if (used < 0) return Infinity;
    return W - used - 1;
  }
  function maskCounts(c, plan) {
    var mask = plan.suitMask !== undefined ? plan.suitMask : 7, hon = plan.honours !== false;
    var c2 = c.slice();
    for (var k = 0; k < N; k++) {
      var ok = k >= 27 ? hon : !!(mask & (1 << Math.floor(k / 9)));
      if (!ok) c2[k] = 0;
    }
    return c2;
  }

  /** Tiles that would complete a winning shape (ignores Fan).  Kinds already held 4 times are excluded. */
  function waits(concealed13, melds, optional) {
    var o = optOf(optional);
    var mc = meldCountOf(melds);
    var c = counts(concealed13);
    var held = c.slice();
    if (melds && typeof melds !== 'number') melds.forEach(function (m) { (m.tiles || []).forEach(function (t) { if (t < N) held[t]++; }); });
    var out = [];
    if (sumCounts(c) !== 13 - 3 * mc) return out;
    for (var k = 0; k < N; k++) {
      if (held[k] >= 4) continue;
      c[k]++;
      if (isWinningCounts(c, mc, o)) out.push(k);
      c[k]--;
    }
    return out;
  }

  HKMJ.Hand = {
    counts: counts,
    decompositions: decompositions,
    winningShapes: winningShapes,
    isWinningShape: isWinningShape,
    shanten: shanten,
    waits: waits,
    // ---- extras (AI / scoring helpers)
    DEFAULT_OPTIONAL: DEFAULT_OPT,
    optionalOf: optOf,
    chickenRule: chickenRule,
    KNIT: KNIT,
    KNIT_SET: KNIT_SET,
    ORPHANS: ORPHANS,
    capsFromMelds: capsFromMelds,
    isWinningCounts: function (c, melds, optional) { return isWinningCounts(c, meldCountOf(melds), optOf(optional)); },
    shantenCounts: shantenCounts,
    maxUsed: stdMaxUsed,
    planShanten: planShanten,
    _memoSizes: function () {
      return { suit: suitMemo.map(function (m) { return m.size; }), hon: honMemo.map(function (m) { return m.size; }), shape: shapeMemo.size };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Hand;
})(typeof globalThis !== 'undefined' ? globalThis : this);
