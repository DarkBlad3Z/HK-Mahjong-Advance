/* HK Mahjong — core/ai.js  (Owner: back end)
 * Computer players (SPEC §6).
 *
 *   AI.decide(view, actions, {level:'easy'|'normal'|'hard', rng}) -> one element of `actions`
 *   AI.suggest(view, actions) -> {action, reason}        (hard level, for the human's Hint button)
 *
 * Uses only the viewer's view (own tiles + everything public).  Never throws: on an internal error it falls back
 * to a legal action (a win if offered, else pass, else the drawn tile / last tile).
 *
 * How it plays (normal / hard):
 *  - PLANS.  A plan is a target the hand can finish as, with the Fan it guarantees: Mixed / Full Flush per suit,
 *    All Triplets (concealed = All Concealed Triplets by Self-Pick), All Sequences, Dragon / seat / round-wind
 *    triplets (alone or combined, Small Three Dragons), Seven Pairs, Thirteen Orphans, Lesser Honours, Knitted,
 *    plus Concealed Hand, Self-Pick and the bonus tiles already held.  Plans that cannot reach the table minimum
 *    are dropped; plans that reach it only with Self-Pick are kept but valued as self-draw-only.
 *  - VALUE.  For each plan: exact plan-restricted shanten (HKMJ.Hand.planShanten), effective tiles over unseen
 *    tiles, a race model (our completion rate vs the opponents' winning hazard over the draws left) and the
 *    payment in the table's unit.  When a discard leaves the hand ready, every wait is scored exactly with
 *    HKMJ.Scoring.evaluate (discard and self-pick), so a "ready" hand below the minimum is worth nothing.
 *  - DEFENCE.  Each opponent gets a ready probability (melds, turns taken) and an expected payment when ready
 *    (by meld picture: one-suit melds, honour melds, dragons — fitted on self-play, where the mean is driven by
 *    the big hands); each tile gets a valid-wait probability (their own discards, dead honours, suits outside a
 *    suspected flush, exhausted neighbours).  Cost of a discard = sum of p(ready) x p(wait) x (what we would pay
 *    — the discarder pays all: 2x — plus the value of the hand we give up).  normal weighs it lightly, hard fully.
 *    (tests/ai_sim.js --calibrate compares these numbers with what actually happens.)
 *  - CLAIMS / KONGS.  Compared by the value of the resulting position (after the forced discard) vs passing;
 *    a claim that kills the plan's Fan (e.g. losing Concealed Hand) is rejected automatically.
 *  - hard also looks one draw ahead for its best few discards (expected best position after the next tile).
 * easy: shanten + tile efficiency with noise, greedy claims, no defence (as SPEC §6).
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;
  var N = 34;

  var LEVELS = {
    easy: { name: 'easy', planning: false, defence: 0, noise: 0.9, claimMargin: 0, topPlans: 0, exactPlans: 0, exactTenpai: false },
    normal: { name: 'normal', planning: true, defence: 0.45, noise: 0, claimMargin: 0.06, topPlans: 5, exactPlans: 2, exactTenpai: true },
    hard: { name: 'hard', planning: true, defence: 1.0, noise: 0, claimMargin: 0.06, topPlans: 6, exactPlans: 3, exactTenpai: true, lookahead: 3 }
  };
  var TUNE = {
    denial: 2.0,        // a win also denies the others: bonus in units of pay(minFan)
    finDiscard: 3.4,    // last step: winning on anyone's discard multiplies the rate (fitted on self-play)
    selfShare: 0.45,    // share of wins that are Self-Picks when discards are also valid (observed)
    hazardBase: 0.025,  // per opponent, per turn (they get ready later and win)
    hazardReady: 0.2,   // extra per turn when an opponent is ready
    waitScale: 0.9,     // P(tile is a valid win | opponent ready) = waitScale * weight / sum(weights)  (fitted)
    second: 0.15,       // weight of the second-best plan (flexibility)
    bonusDraw: 0.15,    // chance that a hidden bonus tile reaches us before the hand ends
    lookaheadWork: 12000, // work units per looked-ahead candidate (1 = a shanten call, 30 = scoring one wait)
    tempoKong: 0.06     // a Kong's replacement tile is a free draw
  };

  // ------------------------------------------------------------------------------------------------ utils
  function zeros(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; }
  function counts(kinds) { var c = zeros(N); for (var i = 0; i < kinds.length; i++) if (kinds[i] < N) c[kinds[i]]++; return c; }
  function find(actions, type) { for (var i = 0; i < actions.length; i++) if (actions[i].type === type) return actions[i]; return null; }
  function tilesOf(c) { var out = []; for (var k = 0; k < N; k++) for (var j = 0; j < c[k]; j++) out.push(k); return out; }
  function copyMeld(m) { return { type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed }; }
  function label(k) { return T.name(k) + ' ' + T.zh(k); }
  function pay(st, fan) {
    var f = Math.max(0, Math.min(13, fan | 0));
    return st.unit === 'chips' ? Math.max(1, f) : HKMJ.Scoring.points(f);
  }
  /** pay() for a fractional Fan (geometric interpolation between table rows) */
  function payFrac(st, fan) {
    var lo = Math.floor(fan), t = fan - lo;
    var a = pay(st, lo), b = pay(st, Math.min(13, lo + 1));
    return st.unit === 'chips' ? a + (b - a) * t : a * Math.pow(b / a, t);
  }

  // ------------------------------------------------------------------------------------------------ reading the view
  function readState(view, L) {
    var H = HKMJ.Hand;
    var me = view.players[view.viewer];
    var set = view.settings || {};
    var st = {
      view: view, L: L, me: view.viewer, seat: me.seatWind, round: view.round || 0,
      minFan: typeof set.minFan === 'number' ? set.minFan : 3,
      opt: H.optionalOf(set.optional),
      payment: set.payment === 'shared' ? 'shared' : 'full',
      unit: set.unit === 'chips' ? 'chips' : 'points',
      flowers: (me.flowers || []).slice(),
      wall: typeof view.wallCount === 'number' ? view.wallCount : 60
    };
    var vis = zeros(N);
    view.players.forEach(function (p) {
      (p.discards || []).forEach(function (k) { if (k < N) vis[k]++; });
      (p.melds || []).forEach(function (m) { m.tiles.forEach(function (k) { if (k < N) vis[k]++; }); });
    });
    if (view.claimTile && view.claimTile.kind === 'robKong' && view.claimTile.tile < N) vis[view.claimTile.tile]++;
    var own = counts(me.hand || []);
    st.visible = vis;
    st.own = own;
    st.unseen = zeros(N);
    st.unseenTotal = 0;
    for (var k = 0; k < N; k++) { st.unseen[k] = Math.max(0, 4 - vis[k] - own[k]); st.unseenTotal += st.unseen[k]; }
    if (st.unseenTotal < 1) st.unseenTotal = 1;
    st.drawsLeft = Math.max(0.5, st.wall / 4);
    // bonus tiles already held (No Flowers is uncertain while bonus tiles remain in the wall: see pBonus)
    var seatNo = st.seat + 1, bf = 0, have = {}, shown = 0;
    st.flowers.forEach(function (f) { have[f] = true; if (T.bonusNumber(f) === seatNo) bf++; });
    if (have[34] && have[35] && have[36] && have[37]) bf += 2;
    if (have[38] && have[39] && have[40] && have[41]) bf += 2;
    st.bonusFan = bf;
    st.noFlowers = !st.flowers.length;
    view.players.forEach(function (p) { shown += (p.flowers || []).length; });
    st.shownBonus = shown;
    // each bonus tile still hidden is drawn by us before the hand ends with p ~ 0.15; if one comes it is ours 1 time in 4
    var p0 = Math.pow(1 - TUNE.bonusDraw * Math.min(1, st.wall / 60), Math.max(0, 8 - shown));
    st.pBonus = p0 + 0.25 * (1 - p0);
    st.payMin = pay(st, st.minFan);
    st.work = 0;
    analyseOpponents(st);
    return st;
  }

  // ------------------------------------------------------------------------------------------------ opponents & danger
  function analyseOpponents(st) {
    var view = st.view;
    st.opps = [];
    var hazard = 0;
    for (var i = 1; i < 4; i++) {
      var p = (st.me + i) % 4;
      var P = view.players[p];
      var melds = P.melds || [], disc = P.discards || [];
      var nm = melds.length;
      var turns = disc.length + nm;
      // fitted on self-play: P(shanten 0) by melds and turns taken (tests/ai_sim.js --calibrate)
      var slope = [0.0175, 0.011, 0.02, 0.035, 0][Math.min(nm, 4)];
      var start = [2, 3, 4, 4, 0][Math.min(nm, 4)];
      var cap = [0.26, 0.2, 0.35, 0.6, 0.95][Math.min(nm, 4)];
      var pReady = nm >= 4 ? 0.95 : Math.min(cap, Math.max(0, slope * (turns - start)));
      // melds: suits, honours, triplets
      var suits = 0, honMelds = [], chows = 0, pongs = 0;
      melds.forEach(function (m) {
        var k = m.tiles[0];
        if (k < 27) suits |= 1 << Math.floor(k / 9); else honMelds.push(k);
        if (m.type === 'chow') chows++; else pongs++;
      });
      var flushSuit = -1, flushStr = 0;
      var nSuits = (suits & 1 ? 1 : 0) + (suits & 2 ? 1 : 0) + (suits & 4 ? 1 : 0);
      if (nm >= 1 && nSuits <= 1) {
        var fs = suits & 1 ? 0 : suits & 2 ? 1 : suits & 4 ? 2 : -1;
        if (fs < 0) {  // only honour melds: look at the discards for the suit they keep
          var byS = [0, 0, 0];
          disc.forEach(function (k) { if (k < 27) byS[Math.floor(k / 9)]++; });
          var mn = Math.min(byS[0], byS[1], byS[2]);
          if (disc.length >= 6 && mn === 0) fs = byS.indexOf(0);
        }
        if (fs >= 0) {
          var dX = 0, dS = 0;
          disc.forEach(function (k) { if (k < 27) { dS++; if (Math.floor(k / 9) === fs) dX++; } });
          flushStr = nm >= 3 ? 0.85 : nm === 2 ? 0.65 : 0.35;
          if (dS >= 4 && dX / dS > 0.25) flushStr *= 0.35;
          flushSuit = fs;
        }
      } else if (nm === 0 && disc.length >= 9) {
        var cnt = [0, 0, 0];
        disc.forEach(function (k) { if (k < 27) cnt[Math.floor(k / 9)]++; });
        for (var s = 0; s < 3; s++) if (cnt[s] === 0) { flushSuit = s; flushStr = 0.3; }
      }
      var triplets = nm >= 2 && chows === 0 ? 0.6 : 0;
      var dragons = 0;
      honMelds.forEach(function (k) { if (k >= 31) dragons++; });
      // "effective Fan" of a ready opponent: the Fan whose payment equals the MEAN payment observed in self-play
      // for this meld picture (payments grow exponentially, so the mean is driven by the big hands)
      var fanEff;
      if (nm === 0) fanEff = 6.0;
      else if (nSuits >= 2) fanEff = 3.5;
      else if (nSuits === 0) fanEff = nm === 1 ? 5.3 : nm === 2 ? 8.3 : 9;
      else fanEff = honMelds.length === 0 ? [0, 5.8, 7.0, 6.8, 8.2][Math.min(nm, 4)] : honMelds.length === 1 ? 4.9 : honMelds.length === 2 ? 6.5 : 9;
      if (dragons >= 2) fanEff = Math.max(fanEff, 8);
      fanEff = Math.max(0, Math.min(13, fanEff + 0.7 * (st.minFan - 3)));
      var fanEst = Math.round(fanEff);
      var loss = (st.payment === 'full' ? 2 : 1) * payFrac(st, fanEff);
      var o = { p: p, pReady: pReady, flushSuit: flushSuit, flushStr: flushStr, triplets: triplets, dragons: dragons,
        honMelds: honMelds, fanEst: fanEst, loss: loss, discards: disc, nm: nm };
      o.w = waitWeights(st, o);
      var ws = 0; for (var k = 0; k < N; k++) ws += o.w[k];
      o.wsum = ws || 1;
      st.opps.push(o);
      hazard += TUNE.hazardBase + pReady * TUNE.hazardReady;
    }
    st.hazard = hazard;
  }
  function exhausted(st, x) { return st.visible[x] + st.own[x] >= 4; }
  /** relative likelihood that tile k is one of opponent o's waits */
  function waitWeights(st, o) {
    var w = zeros(N);
    var dSet = {};
    o.discards.forEach(function (k) { dSet[k] = true; });
    for (var k = 0; k < N; k++) {
      var gone = st.visible[k] + st.own[k];           // copies o cannot hold
      var v;
      if (k >= 27) {
        v = gone >= 4 ? 0 : gone === 3 ? 0.25 : gone === 2 ? 0.55 : 0.75;
        if (o.dragons >= 2 && k >= 31 && o.honMelds.indexOf(k) < 0) v *= 2.5;  // the third dragon
        if (o.flushStr) v *= 1 + 0.6 * o.flushStr;
      } else {
        var r = k % 9;
        var pairPart = gone >= 4 ? 0 : gone === 3 ? 0.12 : 0.25;
        var chowPart = 0;
        // chows containing k: (k-2,k-1,k) (k-1,k,k+1) (k,k+1,k+2) — possible if the other two are not exhausted
        if (r >= 2 && !exhausted(st, k - 1) && !exhausted(st, k - 2)) chowPart += 0.25;
        if (r >= 1 && r <= 7 && !exhausted(st, k - 1) && !exhausted(st, k + 1)) chowPart += 0.25;
        if (r <= 6 && !exhausted(st, k + 1) && !exhausted(st, k + 2)) chowPart += 0.25;
        if (o.triplets) chowPart *= 0.3;
        v = pairPart + chowPart;
        if (o.flushSuit >= 0) {
          if (Math.floor(k / 9) === o.flushSuit) v *= 1 + 0.8 * o.flushStr;
          else v *= 1 - 0.9 * o.flushStr;
        }
      }
      if (dSet[k]) v *= 0.3;                            // they threw it away themselves
      w[k] = v;
    }
    return w;
  }
  /** expected cost of discarding k: sum over opponents of P(ready) x P(k is a valid win | ready) x payment.
   *  Also returns the total deal-in probability (dealing in also forfeits our own hand). */
  function dangerOf(st, k, out) {
    var d = 0, pd = 0;
    for (var i = 0; i < st.opps.length; i++) {
      var o = st.opps[i];
      if (o.pReady < 0.005) continue;
      var pw = Math.min(0.5, TUNE.waitScale * o.w[k] / o.wsum);   // P(k is a VALID win for o | o ready)
      d += o.pReady * pw * o.loss;
      pd += o.pReady * pw;
    }
    if (out) out.p = pd;
    return d;
  }

  // ------------------------------------------------------------------------------------------------ positions & plans
  function makePos(c, melds) {
    var H = HKMJ.Hand;
    var p = { c: c, melds: melds, mc: melds.length, caps: H.capsFromMelds(melds), concealed: true,
      mSuit: 0, mHon: false, mChow: false, mPong: false, honPongs: [] };
    melds.forEach(function (m) {
      var k = m.tiles[0];
      if (!(m.type === 'kong' && m.concealed)) p.concealed = false;
      if (k < 27) p.mSuit |= 1 << Math.floor(k / 9); else p.mHon = true;
      if (m.type === 'chow') p.mChow = true;
      else { p.mPong = true; if (k >= 27) p.honPongs.push(k); }
    });
    return p;
  }
  function honourFan(st, pongKinds, pairKind) {
    var sw = 27 + st.seat, rw = 27 + st.round, d = 0, w = 0, f = 0;
    pongKinds.forEach(function (k) { if (k >= 31) d++; else if (k >= 27) w++; });
    if (d === 3) f += 8; else if (d === 2 && pairKind >= 31) f += 5; else f += d;
    if (w === 4) f += 13;
    else if (w === 3 && pairKind >= 27 && pairKind <= 30) f += 6;
    else pongKinds.forEach(function (k) { if (k === sw) f++; if (k === rw) f++; });
    return f;
  }
  var SUIT_EN = ['Characters', 'Dots', 'Sticks'];
  function planName(pl) {
    var parts = [];
    if (pl.flush === 3) parts.push('Mixed Flush in ' + SUIT_EN[pl.suit]);
    if (pl.flush === 7) parts.push('Full Flush in ' + SUIT_EN[pl.suit]);
    var sn = { pongs: pl.concealedPlan ? 'All (Concealed) Triplets' : 'All Triplets', chows: 'All Sequences', sevenPairs: 'Seven Pairs',
      orphans: 'Thirteen Orphans', honours: 'Lesser Honours', knitted: 'Knitted Tiles' }[pl.structure];
    if (sn) parts.push(sn);
    if (pl.s3d) parts.push('Small Three Dragons');
    else (pl.forced || []).forEach(function (k) { parts.push(T.zh(k) + (k >= 31 ? ' Dragon' : ' Wind') + ' triplet'); });
    if (!parts.length) parts.push(pl.concealedPlan ? 'Concealed Hand' : 'a plain hand');
    return parts.join(' + ');
  }
  /** candidate plans for a position (Fan-feasible only) */
  function genPlans(st, pos) {
    var c = pos.c, plans = [], seen = {};
    var sw = 27 + st.seat, rw = 27 + st.round;
    var valuable = [31, 32, 33, sw];
    if (rw !== sw) valuable.push(rw);
    var melded = {};
    pos.honPongs.forEach(function (k) { melded[k] = true; });
    var cands = [], singles = [];
    valuable.forEach(function (k) {
      if (melded[k]) return;
      if (c[k] >= 2 && c[k] + st.unseen[k] >= 3) cands.push(k);
      else if (c[k] === 1 && st.unseen[k] >= 2) singles.push(k);
    });
    var forcedSets = [[]];
    for (var mask = 1; mask < (1 << cands.length); mask++) {
      var f = [];
      for (var j = 0; j < cands.length; j++) if (mask & (1 << j)) f.push(cands[j]);
      if (f.length <= 3) forcedSets.push(f);
    }
    singles.forEach(function (k) { forcedSets.push([k]); });
    // Small Three Dragons: two dragon triplets (held / melded) + the third as the pair
    var dr = [31, 32, 33];
    var s3d = [];
    dr.forEach(function (pk) {
      var others = dr.filter(function (x) { return x !== pk; });
      if (others.every(function (x) { return melded[x] || c[x] >= 2; }) && c[pk] >= 1 && !melded[pk]) s3d.push({ pair: pk, pongs: others.filter(function (x) { return !melded[x]; }) });
    });
    // flush options
    var suitCount = [0, 0, 0], honCount = 0;
    for (var k = 0; k < 27; k++) suitCount[Math.floor(k / 9)] += c[k];
    for (k = 27; k < N; k++) honCount += c[k];
    pos.melds.forEach(function (m) { var t = m.tiles[0]; if (t < 27) suitCount[Math.floor(t / 9)] += 3; else honCount += 3; });
    var topSuit = suitCount.indexOf(Math.max(suitCount[0], suitCount[1], suitCount[2]));
    var flushOpts = [{ mask: 7, hon: true, fan: 0, suit: -1 }];
    for (var s = 0; s < 3; s++) {
      if (pos.mSuit & ~(1 << s)) continue;
      if (suitCount[s] < 5 && !(s === topSuit && suitCount[s] >= 3)) continue;
      flushOpts.push({ mask: 1 << s, hon: true, fan: 3, suit: s });
      if (!pos.mHon && suitCount[s] >= 7) flushOpts.push({ mask: 1 << s, hon: false, fan: 7, suit: s });
    }
    var bonus = st.bonusFan, conc = pos.concealed, nf = st.noFlowers ? 1 : 0;
    if (st.opt.kong) pos.melds.forEach(function (m) { if (m.type === 'kong') bonus += m.concealed ? 2 : 1; });   // † Kong Fan held
    function add(pl) {
      var key = pl.structure + '|' + pl.suitMask + '|' + pl.honours + '|' + (pl.forced || []).join(',') + '|' + (pl.forcedPair === undefined ? '' : pl.forcedPair);
      if (seen[key]) return;
      seen[key] = true;
      // fanD / fanS exclude No Flowers; nf = 1 when it may still be scored (see planValue)
      pl.nf = nf;
      if (pl.fanS + nf < st.minFan) return;
      if (pl.canClaim === undefined || pl.structure === 'std' || pl.structure === 'pongs' || pl.structure === 'chows') pl.canClaim = pl.openFan + nf >= st.minFan;
      pl.key = key;
      pl.name = planName(pl);
      pl.selfOnly = pl.fanD + nf < st.minFan;
      pl.allow = allowMask(pl);
      plans.push(pl);
    }
    function mk(structure, fl, forced, s3dInfo) {
      var pongKinds = pos.honPongs.concat(forced);
      var pair = s3dInfo ? s3dInfo.pair : -1;
      var hf = honourFan(st, pongKinds, pair);
      var structFan = structure === 'pongs' ? 3 : structure === 'chows' ? 1 : 0;
      var base = structFan + fl.fan + hf + bonus;
      var pl = { structure: structure, suitMask: fl.mask, honours: fl.hon, forced: forced.slice(), flush: fl.fan, suit: fl.suit,
        s3d: !!s3dInfo, concealedPlan: conc };
      if (s3dInfo) pl.forcedPair = pair;
      if (structure === 'pongs' && conc) { pl.fanD = base + 1; pl.fanS = base - 3 + 8 + 1; }
      else { pl.fanD = base + (conc ? 1 : 0); pl.fanS = pl.fanD + 1; }
      pl.openFan = base;                              // what remains if the hand is opened by a claim
      return pl;
    }
    var structures = ['std'];
    if (!pos.mChow) structures.push('pongs');
    structures.forEach(function (structure) {
      flushOpts.forEach(function (fl) {
        forcedSets.forEach(function (fs) {
          if (!fl.hon && fs.length) return;
          if (fs.length > 4 - pos.mc) return;
          add(mk(structure, fl, fs, null));
        });
        if (fl.hon) s3d.forEach(function (x) { if (x.pongs.length <= 4 - pos.mc) add(mk(structure, fl, x.pongs, x)); });
      });
    });
    if (!pos.mPong) flushOpts.forEach(function (fl) { add(mk('chows', fl, [], null)); });
    if (pos.mc === 0) {
      if (st.opt.sevenPairs) {
        var pairs = 0;
        for (k = 0; k < N; k++) if (c[k] >= 2) pairs++;
        if (pairs >= 3) flushOpts.forEach(function (fl) {
          var fan = 4 + fl.fan + bonus;
          add({ structure: 'sevenPairs', suitMask: fl.mask, honours: fl.hon, forced: [], flush: fl.fan, suit: fl.suit, fanD: fan, fanS: fan + 1, openFan: 0, canClaim: false });
        });
      }
      var orph = 0;
      HKMJ.Hand.ORPHANS.forEach(function (x) { if (c[x]) orph++; });
      if (orph >= 8) add({ structure: 'orphans', forced: [], flush: 0, fanD: 13 + bonus, fanS: 14 + bonus, openFan: 0, canClaim: false });
      if (st.opt.lesserHonours || st.opt.greaterHonours) {
        var hd = 0; for (k = 27; k < N; k++) if (c[k]) hd++;
        var kdMax = 0;
        HKMJ.Hand.KNIT.forEach(function (ks) { var n = 0; ks.forEach(function (x) { if (c[x]) n++; }); if (n > kdMax) kdMax = n; });
        if (hd + Math.min(kdMax, 9) >= 10 && hd >= 4) add({ structure: 'honours', forced: [], flush: 0, fanD: 8 + bonus, fanS: 9 + bonus, openFan: 0, canClaim: false });
      }
    }
    if (st.opt.knitted && pos.mc <= 1) {
      var kd = 0;
      HKMJ.Hand.KNIT.forEach(function (ks) { var n = 0; ks.forEach(function (x) { if (c[x]) n++; }); if (n > kd) kd = n; });
      if (kd >= 6) add({ structure: 'knitted', forced: [], flush: 0, fanD: 5 + bonus + (conc ? 1 : 0), fanS: 6 + bonus + (conc ? 1 : 0), openFan: 5 + bonus, canClaim: false });
    }
    return plans;
  }
  function allowMask(pl) {
    var a = new Array(N);
    var st = pl.structure;
    for (var k = 0; k < N; k++) {
      if (st === 'orphans') a[k] = HKMJ.Hand.ORPHANS.indexOf(k) >= 0;
      else if (st === 'honours' || st === 'knitted') a[k] = true;
      else a[k] = k >= 27 ? pl.honours !== false : !!(pl.suitMask & (1 << Math.floor(k / 9)));
    }
    (pl.forced || []).forEach(function (k) { a[k] = true; });
    if (pl.forcedPair !== undefined) a[pl.forcedPair] = true;
    return a;
  }
  function planSh(st, pos, pl) { st.work++; return HKMJ.Hand.planShanten(pos.c, pos.mc, pos.caps, pl, st.opt); }
  function ukeire(st, pos, pl, s) {
    var c = pos.c, caps = pos.caps, u = 0;
    for (var k = 0; k < N; k++) {
      var un = st.unseen[k];
      if (un <= 0 || !pl.allow[k]) continue;
      if (c[k] >= (caps ? caps[k] : 4)) continue;
      c[k]++;
      var s2 = planSh(st, pos, pl);
      c[k]--;
      if (s2 < s) u += un;
    }
    return u;
  }
  function estUke(pl, s) {
    var u = Math.max(4, 24 - 5 * s);
    if (pl.suitMask !== undefined && pl.suitMask !== 7) u *= 0.65;
    if (pl.structure === 'pongs' || pl.structure === 'sevenPairs') u *= 0.6;
    return u;
  }

  // ------------------------------------------------------------------------------------------------ race model
  /** P(we finish k steps, expected total time E turns, before an opponent (hazard lam) and within H turns).
   *  Completion time ~ Erlang(k, k/E); opponents ~ exponential(lam).  = (mu/(mu+lam))^k * P(Gamma(k, mu+lam) < H) */
  function erlangWin(k, E, lam, H) {
    var mu = k / Math.max(E, 1e-6), r = mu + lam;
    var ratio = Math.pow(mu / r, k);
    var x = r * H, term = 1, sum = 1;
    for (var i = 1; i < k; i++) { term *= x / i; sum += term; }
    return ratio * Math.max(0, 1 - Math.exp(-x) * sum);
  }
  function raceProb(st, rateMid, rateFin, s) {
    var E = (s > 0 ? s / Math.max(rateMid, 1e-3) : 0) + 1 / Math.max(rateFin, 1e-3);
    return erlangWin(s + 1, E, st.hazard, st.drawsLeft);
  }
  var FIN_UKE = { std: 6, chows: 6.5, pongs: 3.5, sevenPairs: 2.5, orphans: 3.5, honours: 9, knitted: 4 };
  // typical effective tiles by distance from ready (index = shanten), measured over self-play positions
  var TYP = {
    std: [6, 14, 30, 42, 55, 60], stdFlush: [5, 12, 18, 25, 29, 30, 32, 35], stdHon: [4, 6, 13, 25, 35, 45],
    stdFlushHon: [4, 5.6, 12.6, 21, 30, 34],
    pongs: [3.5, 5.3, 9.6, 12.3, 18, 21, 25, 27, 28], pongsFlush: [3.5, 5, 8.6, 12, 14, 17, 18, 19, 23],
    chows: [6.5, 12.6, 30, 38, 45, 44], chowsFlush: [6, 8.8, 13, 17.6, 19, 21, 23, 28, 34],
    sevenPairs: [2.5, 6.2, 11.7, 16.8, 27, 31], sevenPairsFlush: [2.5, 5, 8.4, 13.5, 27, 31],
    knitted: [3, 6.5, 12, 17.6, 35, 44], honours: [5, 8, 12.2, 21, 30], orphans: [3.5, 8, 15, 22.8, 30]
  };
  function typTable(pl) {
    var fl = pl.suitMask !== undefined && pl.suitMask !== 7, hon = pl.forced && pl.forced.length;
    switch (pl.structure) {
      case 'std': return fl ? (hon ? TYP.stdFlushHon : TYP.stdFlush) : (hon ? TYP.stdHon : TYP.std);
      case 'pongs': return fl ? TYP.pongsFlush : TYP.pongs;
      case 'chows': return fl ? TYP.chowsFlush : TYP.chows;
      case 'sevenPairs': return fl ? TYP.sevenPairsFlush : TYP.sevenPairs;
      default: return TYP[pl.structure] || TYP.std;
    }
  }
  function typAt(t, j) { return t[Math.min(j, t.length - 1)]; }
  var MID_CLAIM = { std: 1.5, chows: 1.2, pongs: 2.0 };
  /** specific tiles a plan still needs (bottleneck steps): missing copies of forced honour triplets / pair,
   *  missing knitted tiles of the best arrangement */
  function needOf(st, pos, pl) {
    var c = pos.c, out = null;
    function add(k, n, claim) { for (var i = 0; i < n; i++) (out || (out = [])).push({ left: st.unseen[k] - i, claim: claim }); }
    var f = pl.forced || [];
    for (var i = 0; i < f.length; i++) { var n = 3 - c[f[i]]; if (n > 0) add(f[i], n, true); }
    if (pl.forcedPair !== undefined && pl.forcedPair >= 0) { var n2 = 2 - c[pl.forcedPair]; if (n2 > 0) add(pl.forcedPair, n2, false); }
    if (pl.structure === 'knitted') {
      var best = null, bn = -1;
      HKMJ.Hand.KNIT.forEach(function (ks) { var m = 0; ks.forEach(function (x) { if (c[x]) m++; }); if (m > bn) { bn = m; best = ks; } });
      best.forEach(function (x) { if (!c[x]) add(x, 1, false); });
    }
    return out;
  }
  var LAST = { p: 0 };   // win probability of the last planValue() call (for positionValue / hints)
  /** value of pursuing plan pl from a 13-type position at plan shanten s with u useful unseen tiles.
   *  If the plan counts on No Flowers, blend "it survives (or a seat flower replaces it)" with "a bonus tile ends it". */
  function planValue(st, pl, s, u, need) {
    if (s === Infinity || s > 8) { LAST.p = 0; return 0; }
    if (s < 0) s = 0;
    if (!pl.nf) return planValueF(st, pl, s, u, pl.fanD, pl.fanS, need);
    var pb = st.pBonus;
    var v1 = planValueF(st, pl, s, u, pl.fanD + 1, pl.fanS + 1, need), p1 = LAST.p;
    var v0 = planValueF(st, pl, s, u, pl.fanD, pl.fanS, need), p0 = LAST.p;
    LAST.p = pb * p1 + (1 - pb) * p0;
    return pb * v1 + (1 - pb) * v0;
  }
  function planValueF(st, pl, s, u, fanD, fanS, need) {
    if (fanS < st.minFan) { LAST.p = 0; return 0; }
    var selfOnly = fanD < st.minFan;
    var U = st.unseenTotal;
    var fin = FIN_UKE[pl.structure] || 5;
    var mid = pl.canClaim ? (MID_CLAIM[pl.structure] || 1) : 1;
    var typ = typTable(pl);
    var E = 0;
    // bottleneck steps: specific tiles the plan cannot do without (a forced honour triplet, a missing knitted tile)
    var bn = (need && s > 0) ? need : null, nb = 0;
    if (bn) {
      for (var b = 0; b < bn.length && nb < s; b++, nb++) {
        var ub = Math.max(0.3, bn[b].left) * (pl.canClaim && bn[b].claim ? 3 : 1);
        E += U / ub;
      }
    }
    // generic steps: the current one at the real effective-tile count (capped: junk tiles make almost any draw an
    // "improvement" once), later ones at the typical count for this kind of plan at that distance (self-play table)
    var gen = s - nb;
    for (var j = gen; j >= 1; j--) {
      var uj = j === gen ? Math.min(Math.max(u, 0.5), 1.25 * typAt(typ, j)) : typAt(typ, j);
      E += U / (Math.max(uj, 0.5) * mid);
    }
    var finMult = selfOnly ? 1 : TUNE.finDiscard;
    var u0 = s === 0 ? u : fin;
    E += U / (Math.max(u0, 0.5) * finMult);
    var P = erlangWin(s + 1, E, st.hazard, st.drawsLeft) * (CORR[pl.structure] || 1);
    LAST.p = P;
    var sigma = selfOnly ? 1 : TUNE.selfShare;
    var gain = sigma * 3 * pay(st, fanS) + (1 - sigma) * discardGain(st, fanD);
    return P * (gain + TUNE.denial * st.payMin);
  }
  // empirical calibration of the race model per plan structure (self-play: predicted vs actual win rate)
  var CORR = { std: 1, pongs: 1.15, chows: 0.65, sevenPairs: 1.3, orphans: 2.0, honours: 1.3, knitted: 1.5 };
  /** what a discard win collects in total (full: the discarder pays 2P; shared: P + P/2 + P/2) */
  function discardGain(st, fan) { return 2 * pay(st, fan); }
  /** exact value of a ready 13-type position: every wait scored by the real scorer.
   *  With no bonus tile yet, a non-seat flower may still arrive before the win and take No Flowers away: the value
   *  blends both cases (the chance of staying flowerless is higher here, since a ready hand finishes sooner). */
  function readyValue(st, pos) {
    var H = HKMJ.Hand;
    var tiles = tilesOf(pos.c);
    var waits = H.waits(tiles, pos.melds, st.opt);
    if (!waits.length) return { value: 0, waits: [], valid: 0, p: 0 };
    var a = readyScan(st, pos, tiles, waits, st.flowers);
    if (!st.noFlowers || a.rate <= 0) return a;
    // a non-seat bonus tile (Fan loses No Flowers); if one of ours arrives instead the Fan is unchanged
    var other = 34 + ((st.seat + 2) % 4);
    var b = readyScan(st, pos, tiles, waits, [other]);
    var E = st.unseenTotal / Math.max(a.rate, 1e-3);                   // expected turns to win
    var hidden = Math.max(0, 8 - st.shownBonus);
    var q0 = Math.pow(Math.max(0, 1 - Math.min(E, st.drawsLeft) / Math.max(st.wall, 1)), hidden);
    var pb = q0 + 0.25 * (1 - q0);
    return { value: pb * a.value + (1 - pb) * b.value, waits: a.waits, valid: a.rate, p: pb * a.p + (1 - pb) * b.p };
  }
  function readyScan(st, pos, tiles, waits, flowers) {
    var S = HKMJ.Scoring;
    var rate = 0, gain = 0, info = [];
    var sig = TUNE.selfShare;
    for (var i = 0; i < waits.length; i++) {
      var w = waits[i], un = st.unseen[w];
      if (un <= 0) continue;
      st.work += 30;
      var hand = tiles.concat([w]);
      var base = { hand: hand, melds: pos.melds, winTile: w, kongReplacement: 0, lastTile: false, seatWind: st.seat,
        roundWind: st.round, flowers: flowers, blessing: null, flowerWin: false, settings: { minFan: st.minFan, optional: st.opt } };
      base.source = 'discard';
      var eD = S.evaluate(base);
      base.source = 'self';
      var eS = S.evaluate(base);
      info.push({ tile: w, left: un, fan: eD.valid ? eD.fan : 0, selfFan: eS.valid ? eS.fan : 0 });
      if (eD.valid) {                         // wins on anyone's discard or by Self-Pick
        rate += un * TUNE.finDiscard;
        gain += un * TUNE.finDiscard * (sig * 3 * pay(st, eS.fan) + (1 - sig) * discardGain(st, eD.fan));
      } else if (eS.valid) {                  // Self-Pick only
        rate += un;
        gain += un * 3 * pay(st, eS.fan);
      }
    }
    if (rate <= 0) return { value: 0, waits: info, valid: 0, p: 0, rate: 0 };
    var r = rate / st.unseenTotal;
    var P = raceProb(st, r, r, 0);
    return { value: P * (gain / rate + TUNE.denial * st.payMin), waits: info, valid: rate, p: P, rate: rate };
  }

  /** offence value of a 13-type position (13 - 3*melds concealed tiles).
   *  Only values computed with REAL effective-tile counts (the nExact most promising plans) or the exact ready
   *  value compete, so a rough estimate can never win the max. */
  function positionValue(st, pos, plansIn, nExact) {
    var L = st.L;
    var plans = plansIn || genPlans(st, pos);
    var evals = [], anyReady = false, i;
    for (i = 0; i < plans.length; i++) {
      var s = planSh(st, pos, plans[i]);
      if (s === Infinity) continue;
      if (s <= 0 && L.exactTenpai) { anyReady = true; continue; }     // valued exactly below
      var nd = needOf(st, pos, plans[i]);
      evals.push({ pl: plans[i], s: Math.max(0, s), need: nd, v: planValue(st, plans[i], Math.max(0, s), estUke(plans[i], Math.max(0, s)), nd) });
    }
    evals.sort(function (a, b) { return b.v - a.v; });
    var cand = [];
    for (i = 0; i < evals.length && i < (nExact || 2); i++) {
      var e = evals[i];
      e.u = ukeire(st, pos, e.pl, e.s);
      e.v = planValue(st, e.pl, e.s, e.u, e.need);
      e.p = LAST.p;
      cand.push(e);
    }
    var ready = null;
    if (anyReady) { ready = readyValue(st, pos); cand.push({ ready: ready, s: 0, v: ready.value, p: ready.p }); }
    cand.sort(function (a, b) { return b.v - a.v; });
    var best = cand.length ? cand[0] : null;
    var value = best ? best.v + TUNE.second * (cand.length > 1 ? cand[1].v : 0) : 0;
    return { value: value, best: best, ready: ready, evals: evals, p: best ? best.p : 0 };
  }

  /** expected offence value after our next draw from a 13-type position (hard only).
   *  A draw no plan can use is thrown straight back (value unchanged); a draw that wins by Self-Pick is paid;
   *  otherwise the best of a few replies (discards that keep the improvement) is taken. */
  function lookaheadValue(st, pos13, plans, V0) {
    var H = HKMJ.Hand, S = HKMJ.Scoring;
    var c = pos13.c, caps = pos13.caps, melds = pos13.melds;
    var top = plans.slice(0, 3);
    var s13 = top.map(function (pl) { return planSh(st, pos13, pl); });
    var tot = 0, wsum = 0;
    var budget = st.work + TUNE.lookaheadWork;       // deterministic work cap (no clocks in core code)
    for (var t = 0; t < N; t++) {
      var w = st.unseen[t];
      if (w <= 0 || c[t] >= (caps ? caps[t] : 4)) continue;
      wsum += w;
      c[t]++;
      var v = V0;
      if (H.isWinningCounts(c, melds, st.opt)) {
        var ev = S.evaluate({ hand: tilesOf(c), melds: melds, winTile: t, source: 'self', kongReplacement: 0, lastTile: false,
          seatWind: st.seat, roundWind: st.round, flowers: st.flowers, blessing: null, flowerWin: false, settings: { minFan: st.minFan, optional: st.opt } });
        if (ev.valid) v = 3 * pay(st, ev.fan) + TUNE.denial * st.payMin;
      }
      if (v === V0) {
        var improved = [];
        for (var i = 0; i < top.length; i++) {
          if (s13[i] === Infinity) continue;
          var s14 = planSh(st, pos13, top[i]);
          if (s14 < s13[i]) improved.push({ pl: top[i], s: s14 });
        }
        if (improved.length && st.work < budget) {
          var pl = improved[0].pl, want = improved[0].s, tried = 0;
          for (var d = 0; d < N && tried < 3; d++) {
            if (!c[d] || d === t) continue;
            c[d]--;
            if (planSh(st, pos13, pl) === want) {
              tried++;
              var pv = positionValue(st, pos13, top, 1);
              if (pv.value > v) v = pv.value;
            }
            c[d]++;
          }
        }
      }
      c[t]--;
      tot += w * v;
    }
    return wsum ? tot / wsum : V0;
  }

  // ------------------------------------------------------------------------------------------------ discards
  /** rank the discards of a 14-type position.  Returns [{tile, score, off, danger, info}] best first. */
  function rankDiscards(st, c14, melds, rng) {
    var L = st.L, H = HKMJ.Hand;
    var pos14 = makePos(c14, melds);
    var kinds = [];
    for (var k = 0; k < N; k++) if (c14[k]) kinds.push(k);
    var out = [];
    if (!L.planning) {
      kinds.forEach(function (d) {
        var c = c14.slice(); c[d]--;
        var s = H.shantenCounts(c, melds, { sevenPairs: st.opt.sevenPairs, luxurySevenPairs: st.opt.luxurySevenPairs, knitted: false, lesserHonours: false, greaterHonours: false });
        var u = 0;
        for (var t = 0; t < N; t++) {
          if (st.unseen[t] <= 0 || c[t] >= 4) continue;
          c[t]++;
          if (H.shantenCounts(c, melds, { sevenPairs: st.opt.sevenPairs, luxurySevenPairs: st.opt.luxurySevenPairs, knitted: false, lesserHonours: false, greaterHonours: false }) < s) u += st.unseen[t];
          c[t]--;
        }
        var noise = rng ? rng.next() * L.noise * 6 : 0;
        // small preference for keeping honour pairs of value and discarding lone honours early
        var keep = (d >= 31 || d === 27 + st.seat || d === 27 + st.round) && c14[d] >= 2 ? -3 : 0;
        out.push({ tile: d, score: -s * 100 + u + noise + keep, off: -s, danger: 0, info: { s: s, u: u } });
      });
      out.sort(function (a, b) { return b.score - a.score; });
      return out;
    }
    var plans = genPlans(st, pos14);
    plans.forEach(function (pl) { pl.s14 = planSh(st, pos14, pl); pl.pre = pl.s14 === Infinity ? -1 : planValue(st, pl, Math.max(0, pl.s14), estUke(pl, Math.max(0, pl.s14)), needOf(st, pos14, pl)); });
    plans = plans.filter(function (pl) { return pl.pre >= 0; });
    plans.sort(function (a, b) { return b.pre - a.pre; });
    var top = plans.slice(0, L.topPlans);
    var lam = L.defence;
    kinds.forEach(function (d) {
      var c = c14.slice(); c[d]--;
      var pos = makePos(c, melds);
      var pv = positionValue(st, pos, top, L.exactPlans);
      var dp = { p: 0 };
      var dg = lam > 0 ? dangerOf(st, d, dp) : 0;
      // dealing in costs the payment AND the value of the hand we were building
      var cost = dg + dp.p * pv.value;
      out.push({ tile: d, pos: pos, off: pv.value, danger: cost, pDeal: dp.p, score: pv.value - lam * cost, info: pv.best, ready: pv.ready, p: pv.p });
    });
    if (L.lookahead && out.length > 1 && top.length && !out.every(function (x) { return x.off <= 0; })) {
      // hard: re-rank the best few candidates by the expected position after our next draw
      out.sort(function (a, b) { return b.score - a.score; });
      var K = Math.min(L.lookahead, out.length), la = [];
      for (var i = 0; i < K; i++) {
        var o = out[i];
        o.offLA = lookaheadValue(st, o.pos, top, o.off);
        la.push(o);
      }
      la.sort(function (a, b) { return (b.offLA - lam * b.danger) - (a.offLA - lam * a.danger); });
      var rest = out.slice(K);
      // .score orders the discard choice; .static (same scale as positionValue) is what claims / Kongs compare
      out.forEach(function (o) { o.static = o.score; });
      la.forEach(function (o, j) { o.score = 1e6 - j; });
      return la.concat(rest);
    }
    if (!plans.length || out.every(function (x) { return x.off <= 0; })) {
      // no plan can reach the minimum: play safe (normal/hard) and stay efficient while hoping for flowers / honours
      out.forEach(function (x) {
        var s = H.shantenCounts(x.pos.c, melds, st.opt);
        x.score = -lam * x.danger - s * 0.01;
        x.info = { fallback: true, s: s };
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    out.forEach(function (o) { if (o.static === undefined) o.static = o.score; });
    return out;
  }
  function bestStatic(r) { var b = -Infinity; for (var i = 0; i < r.length; i++) if (r[i].static > b) b = r[i].static; return r.length ? b : 0; }

  // ------------------------------------------------------------------------------------------------ turn
  function myHand(st) { return st.view.players[st.me].hand.slice(); }
  function myMelds(st) { return (st.view.players[st.me].melds || []).map(copyMeld); }

  function decideTurn(st, actions, rng, explain) {
    var a = find(actions, 'selfWin');
    if (a) return { action: a, why: { type: 'win', fan: a.fan } };
    a = find(actions, 'flowerWin');
    if (a) return { action: a, why: { type: 'flowers', fan: a.fan } };
    var hand = myHand(st), melds = myMelds(st);
    var c14 = counts(hand);
    var ranked = rankDiscards(st, c14, melds, rng);
    var discards = actions.filter(function (x) { return x.type === 'discard'; });
    var pick = null;
    for (var i = 0; i < ranked.length && !pick; i++) {
      for (var j = 0; j < discards.length; j++) if (discards[j].tile === ranked[i].tile) { pick = { action: discards[j], r: ranked[i] }; break; }
    }
    if (!pick) pick = { action: discards[0] || actions[0], r: null };
    var best = { action: pick.action, score: bestStatic(ranked), why: { type: 'discard', r: pick.r, ranked: ranked } };
    // Kongs
    actions.forEach(function (k) {
      if (k.type !== 'concealedKong' && k.type !== 'addKong') return;
      var v = kongValue(st, k, hand, melds, pick.r ? { score: bestStatic(ranked) } : null);
      if (v !== null && v > best.score) best = { action: k, score: v, why: { type: k.type, tile: k.tile } };
    });
    return best;
  }
  function kongValue(st, act, hand, melds, bestDiscard) {
    var L = st.L, H = HKMJ.Hand;
    var k = act.tile, c = counts(hand), m2 = melds.map(copyMeld);
    if (act.type === 'concealedKong') {
      if (c[k] < 4) return null;
      c[k] -= 4;
      m2.push({ type: 'kong', tiles: [k, k, k, k], concealed: true });
    } else {
      var mi = -1;
      m2.forEach(function (m, i) { if (m.type === 'pong' && m.tiles[0] === k) mi = i; });
      if (mi < 0 || c[k] < 1) return null;
      c[k] -= 1;
      m2[mi] = { type: 'kong', tiles: [k, k, k, k], concealed: false };
    }
    if (!L.planning) {
      // easy: Kong whenever it does not make the hand worse
      var sNow = H.shantenCounts(counts(hand), melds, st.opt) , sK = H.shantenCounts(c, m2, st.opt);
      return sK <= Math.max(0, sNow) ? (bestDiscard ? bestDiscard.score + 1 : 1) : null;
    }
    var pos = makePos(c, m2);
    var pv = positionValue(st, pos, null, L.exactPlans);
    var v;
    if (L.lookahead) {
      // the replacement tile is drawn at once: value the position after that draw
      var plans = genPlans(st, pos).map(function (pl) { return { pl: pl, v: planValue(st, pl, Math.max(0, planSh(st, pos, pl)), estUke(pl, 3), needOf(st, pos, pl)) }; })
        .sort(function (a, b) { return b.v - a.v; }).slice(0, L.topPlans).map(function (x) { return x.pl; });
      v = plans.length ? lookaheadValue(st, pos, plans, pv.value) : pv.value;
    } else v = pv.value * (1 + TUNE.tempoKong);
    if (act.type === 'addKong' && L.defence > 0) v -= L.defence * dangerOf(st, k);   // it can be robbed like a discard
    return v;
  }

  // ------------------------------------------------------------------------------------------------ claims
  function decideClaim(st, actions, rng) {
    var L = st.L;
    var a = find(actions, 'win');
    if (a) return { action: a, why: { type: 'win', fan: a.fan } };
    var pass = find(actions, 'pass');
    var view = st.view;
    var ct = view.claimTile || (view.pending && view.pending.tile !== undefined ? { tile: view.pending.tile, kind: view.pending.type === 'robKong' ? 'robKong' : 'discard' } : null);
    if (!ct || ct.kind === 'robKong') return { action: pass || actions[0], why: { type: 'pass' } };
    var t = ct.tile;
    var hand = myHand(st), melds = myMelds(st);
    var c13 = counts(hand);
    var opts = actions.filter(function (x) { return x.type === 'pong' || x.type === 'kong' || x.type === 'chow'; });
    if (!opts.length) return { action: pass || actions[0], why: { type: 'pass' } };
    if (!L.planning) return easyClaim(st, opts, pass, c13, melds, t, rng);
    var pos13 = makePos(c13, melds);
    var passPV = positionValue(st, pos13, null, L.exactPlans), passV = passPV.value;
    var best = { action: pass, score: passV * (1 + L.claimMargin) + 1e-9, why: { type: 'pass', passV: passV, info: passPV.best } };
    var claimInfo = {};
    opts.forEach(function (o) {
      var c = c13.slice(), m2 = melds.map(copyMeld), v;
      if (o.type === 'pong') {
        if (c[t] < 2) return;
        c[t] -= 2; m2.push({ type: 'pong', tiles: [t, t, t], concealed: false });
        var r = rankDiscards(st, c, m2, rng);
        v = bestStatic(r);
        claimInfo = r.length ? r[0].info : null;
      } else if (o.type === 'kong') {
        if (c[t] < 3) return;
        c[t] -= 3; m2.push({ type: 'kong', tiles: [t, t, t, t], concealed: false });
        var kpv = positionValue(st, makePos(c, m2), null, L.exactPlans);
        v = kpv.value * (1 + TUNE.tempoKong);
        claimInfo = kpv.best;
      } else {
        var ok = true;
        o.tiles.forEach(function (x) { if (x !== t) { if (c[x] < 1) ok = false; c[x]--; } });
        if (!ok) return;
        m2.push({ type: 'chow', tiles: o.tiles.slice(), concealed: false });
        var r2 = rankDiscards(st, c, m2, rng);
        v = bestStatic(r2);
        claimInfo = r2.length ? r2[0].info : null;
      }
      if (v > best.score) best = { action: o, score: v, why: { type: o.type, passV: passV, v: v, info: claimInfo } };
    });
    return best;
  }
  function easyClaim(st, opts, pass, c13, melds, t, rng) {
    var H = HKMJ.Hand;
    var sNow = H.shantenCounts(c13, melds, st.opt);
    var best = null, bestS = 99;
    opts.forEach(function (o) {
      var c = c13.slice(), m2 = melds.map(copyMeld), s;
      if (o.type === 'kong') { c[t] -= 3; m2.push({ type: 'kong', tiles: [t, t, t, t], concealed: false }); s = H.shantenCounts(c, m2, st.opt) - 0.5; }
      else {
        if (o.type === 'pong') { c[t] -= 2; m2.push({ type: 'pong', tiles: [t, t, t], concealed: false }); }
        else { o.tiles.forEach(function (x) { if (x !== t) c[x]--; }); m2.push({ type: 'chow', tiles: o.tiles.slice(), concealed: false }); }
        // best discard afterwards
        s = 99;
        for (var d = 0; d < N; d++) if (c[d]) { c[d]--; s = Math.min(s, H.shantenCounts(c, m2, st.opt)); c[d]++; }
      }
      if (s < bestS) { bestS = s; best = o; }
    });
    var greedy = rng ? rng.next() : 0.5;
    if (best && (bestS < sNow || (bestS <= sNow && best.type !== 'chow' && greedy < 0.7))) return { action: best, why: { type: best.type } };
    return { action: pass || opts[0], why: { type: 'pass' } };
  }

  // ------------------------------------------------------------------------------------------------ public
  function fallback(view, actions) {
    var a = find(actions, 'selfWin') || find(actions, 'win') || find(actions, 'flowerWin') || find(actions, 'pass');
    if (a) return a;
    var me = view && view.players && view.players[view.viewer];
    if (me && me.drawn !== null && me.drawn !== undefined) {
      for (var i = 0; i < actions.length; i++) if (actions[i].type === 'discard' && actions[i].tile === me.drawn) return actions[i];
    }
    var ds = actions.filter(function (x) { return x.type === 'discard'; });
    return ds.length ? ds[ds.length - 1] : actions[0];
  }
  function run(view, actions, opts) {
    var level = (opts && LEVELS[opts.level]) ? opts.level : 'normal';
    var L = LEVELS[level];
    var rng = (opts && opts.rng) || HKMJ.RNG(((view.handNo || 0) * 7919 + (view.wallCount || 0) * 31 + (view.viewer || 0)) >>> 0);
    var st = readState(view, L);
    var isTurn = actions.some(function (x) { return x.type === 'discard' || x.type === 'selfWin' || x.type === 'flowerWin' || x.type === 'concealedKong' || x.type === 'addKong'; });
    var res = isTurn ? decideTurn(st, actions, rng) : decideClaim(st, actions, rng);
    res.st = st;
    return res;
  }
  function decide(view, actions, opts) {
    if (!actions || !actions.length) return null;
    if (actions.length === 1) return actions[0];
    try {
      var res = run(view, actions, opts);
      if (res && res.action && actions.indexOf(res.action) >= 0) return res.action;
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('HKMJ.AI: decision failed, using a fallback', e);
    }
    return fallback(view, actions);
  }

  // ------------------------------------------------------------------------------------------------ hint text
  function describePlan(info, st) {
    if (!info) return '';
    if (info.fallback) return 'no plan reaches the ' + st.minFan + ' Fan minimum yet — keeping the hand efficient';
    if (info.ready) {
      var ws = info.ready.waits.filter(function (w) { return w.fan || w.selfFan; });
      if (!ws.length) return 'ready, but no wait reaches ' + st.minFan + ' Fan';
      return 'ready on ' + ws.map(function (w) { return T.zh(w.tile) + (w.fan ? ' ' + w.fan + ' Fan' : ' ' + w.selfFan + ' Fan by Self-Pick only'); }).join(', ');
    }
    var pl = info.pl;
    if (!pl) return '';
    var fan = pl.selfOnly ? pl.fanS + ' Fan by Self-Pick only' : pl.fanD + ' Fan' + (pl.fanS > pl.fanD ? ' (' + pl.fanS + ' by Self-Pick)' : '');
    // info.s is the distance for THIS plan (e.g. a flush counts off-suit tiles as useless), which can be larger than the
    // plain distance shown in the hint panel — say so, so the two numbers never look contradictory.
    return 'aiming for ' + pl.name + ', ' + fan + '; ' + (info.s <= 0 ? 'ready' : info.s + ' tile' + (info.s > 1 ? 's' : '') + ' from a ready ' + pl.name);
  }
  function suggest(view, actions) {
    var action = null, reason = '';
    try {
      if (!actions || !actions.length) return { action: null, reason: 'Nothing to do right now.' };
      var res = run(view, actions, { level: 'hard' });
      action = (res && res.action && actions.indexOf(res.action) >= 0) ? res.action : fallback(view, actions);
      var st = res.st, why = res.why || {};
      if (action.type === 'selfWin' || action.type === 'win') reason = 'Win now — ' + action.fan + ' Fan' + (action.evaluation ? ': ' + action.evaluation.items.map(function (i) { return i.name + ' ' + i.fan; }).join(', ') : '') + '.';
      else if (action.type === 'flowerWin') reason = 'Declare the flower win — ' + action.fan + ' Fan.';
      else if (action.type === 'discard') {
        var r = why.r;
        reason = 'Discard ' + label(action.tile) + ' — ' + (r ? describePlan(r.info, st) : 'least useful tile') + '.';
        if (r && st.L.defence && why.ranked) {
          var offBest = why.ranked.slice().sort(function (a, b) { return b.off - a.off; })[0];
          if (offBest && offBest.tile !== action.tile && offBest.danger > r.danger * 1.5) reason += ' ' + label(offBest.tile) + ' looks dangerous: ' + threatText(st) + '.';
          else if (r.danger > 0.5 * st.payMin) reason += ' Careful: ' + threatText(st) + '.';
        }
      } else if (action.type === 'concealedKong' || action.type === 'addKong') reason = 'Kong ' + label(action.tile) + ' — keeps the hand intact and draws a replacement tile.';
      else if (action.type === 'pong' || action.type === 'chow' || action.type === 'kong') {
        var dp = why.info ? describePlan(why.info, st) : '';
        reason = (action.type === 'chow' ? 'Chow ' : action.type === 'pong' ? 'Pong ' : 'Kong ') + (view.claimTile ? label(view.claimTile.tile) : '') +
          ' — ' + (dp ? 'then ' + dp : 'it moves the hand forward without losing the Fan it needs') + '.';
      } else if (action.type === 'pass') {
        var dq = why.info ? describePlan(why.info, st) : '';
        reason = 'Pass — claiming would not help' + (dq ? '; keep ' + dq.replace(/^aiming for /, 'aiming for ') : ' (or would cost Fan the hand needs for the ' + st.minFan + ' Fan minimum)') + '.';
      }
    } catch (e) {
      action = fallback(view, actions);
      reason = 'Suggested move.';
    }
    return { action: action, reason: reason };
  }
  function threatText(st) {
    var worst = null;
    st.opps.forEach(function (o) { var t = o.pReady * o.loss; if (!worst || t > worst.t) worst = { o: o, t: t }; });
    if (!worst) return 'an opponent may be ready';
    var o = worst.o, P = st.view.players[o.p];
    var bits = [];
    if (o.flushSuit >= 0 && o.flushStr >= 0.5) bits.push('a ' + SUIT_EN[o.flushSuit] + ' flush');
    if (o.dragons >= 2) bits.push('two dragon triplets');
    if (o.triplets) bits.push('all triplets');
    return (P && P.name ? P.name : 'Player ' + o.p) + ' has ' + o.nm + ' meld' + (o.nm === 1 ? '' : 's') + (bits.length ? ' (' + bits.join(', ') + ')' : '');
  }

  HKMJ.AI = {
    decide: decide,
    suggest: suggest,
    LEVELS: LEVELS,
    TUNE: TUNE,
    CORR: CORR,
    FIN_UKE: FIN_UKE,
    MID_CLAIM: MID_CLAIM,
    // exposed for tests / tuning
    _readState: readState,
    _genPlans: genPlans,
    _makePos: makePos,
    _positionValue: positionValue,
    _rankDiscards: rankDiscards,
    _danger: dangerOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
