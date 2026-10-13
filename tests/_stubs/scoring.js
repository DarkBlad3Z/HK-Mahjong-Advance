/* TEMPORARY STAND-IN for src/core/scoring.js (used only by tests while the real module is missing).
 * Simplified booklet scoring for standard hands + a few special shapes.  Never bundled. */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;
  var POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
  function points(f) { return POINTS[Math.max(0, Math.min(13, f | 0))]; }
  function item(id, fan, zh) { return { id: id, name: id, zh: zh || id, fan: fan }; }

  function bonusItems(ctx, items) {
    var fl = ctx.flowers || [];
    if (!fl.length) items.push(item('noFlowers', 1, '無花'));
    var seat = ctx.seatWind + 1, n = 0;
    fl.forEach(function (f) { if (T.bonusNumber(f) === seat) n++; });
    if (n) items.push(item('seatFlower', n, '正花'));
    if ([34, 35, 36, 37].every(function (k) { return fl.indexOf(k) >= 0; })) items.push(item('allFlowers', 2, '一檯花'));
    if ([38, 39, 40, 41].every(function (k) { return fl.indexOf(k) >= 0; })) items.push(item('allSeasons', 2, '一檯花'));
  }

  function winItems(ctx, items, concealedHand, builtInConcealed) {
    if (ctx.source === 'self') {
      if (ctx.kongReplacement >= 2) items.push(item('doubleKong', 9, '槓上槓'));
      else if (ctx.kongReplacement === 1) items.push(item('kongReplacement', 2, '槓上開花'));
      else items.push(item('selfPick', 1, '自摸'));
    }
    if (ctx.source === 'robKong') items.push(item('robKong', 1, '搶槓'));
    if (ctx.lastTile) items.push(item('moon', 1, '海底撈月'));
    if (concealedHand && !builtInConcealed) items.push(item('concealed', 1, '門前清'));
  }

  function tileItems(all, items) {
    var suits = {}, hon = false;
    all.forEach(function (k) { if (T.isSuit(k)) suits[T.suitOf(k)] = 1; else hon = true; });
    var ns = Object.keys(suits).length;
    if (ns === 1 && !hon) items.push(item('fullFlush', 7, '清一色'));
    else if (ns === 1 && hon) items.push(item('mixedFlush', 3, '混一色'));
    else if (ns === 0) items.push(item('allHonours', 10, '字一色'));
  }

  function scoreStandard(ctx, shape) {
    var items = [];
    var concealedHand = ctx.melds.every(function (m) { return m.concealed; });
    var sets = ctx.melds.map(function (m) { return { type: m.type === 'chow' ? 'chow' : 'pong', tiles: m.tiles, concealed: !!m.concealed }; });
    var winPlaced = false;
    shape.sets.forEach(function (st) {
      var conc = true;
      if (!winPlaced && ctx.source !== 'self' && st.type === 'pong' && st.tiles[0] === ctx.winTile && shape.pair !== ctx.winTile) { conc = false; winPlaced = true; }
      sets.push({ type: st.type, tiles: st.tiles, concealed: conc });
    });
    var pongs = sets.filter(function (x) { return x.type === 'pong'; });
    var all = ctx.hand.slice(); ctx.melds.forEach(function (m) { all = all.concat(m.tiles); });
    if (pongs.length === 4) {
      if (concealedHand && pongs.every(function (x) { return x.concealed; })) items.push(item('allConcealedTriplets', 8, '四暗刻'));
      else items.push(item('allTriplets', 3, '對對糊'));
    }
    if (sets.every(function (x) { return x.type === 'chow'; })) items.push(item('allSequences', 1, '平糊'));
    var dragons = pongs.filter(function (x) { return T.isDragon(x.tiles[0]); }).length;
    if (dragons === 3) items.push(item('bigThreeDragons', 8, '大三元'));
    else if (dragons === 2 && T.isDragon(shape.pair)) items.push(item('smallThreeDragons', 5, '小三元'));
    else if (dragons) items.push(item('dragon', dragons, '三元牌'));
    var winds = pongs.filter(function (x) { return T.isWind(x.tiles[0]); });
    if (winds.length === 4) items.push(item('bigFourWinds', 13, '大四喜'));
    else if (winds.length === 3 && T.isWind(shape.pair)) items.push(item('smallFourWinds', 6, '小四喜'));
    else winds.forEach(function (x) {
      var w = T.windIndex(x.tiles[0]);
      if (w === ctx.roundWind) items.push(item('roundWind', 1, '圈風'));
      if (w === ctx.seatWind) items.push(item('seatWind', 1, '門風'));
    });
    tileItems(all, items);
    winItems(ctx, items, concealedHand, false);
    return items;
  }

  function evaluate(ctx) {
    var H = HKMJ.Hand, minFan = ctx.settings.minFan, best = null;
    function consider(items, pattern) {
      var raw = 0; items.forEach(function (i) { raw += i.fan; });
      var fan = Math.min(13, raw);
      if (!best || fan > best.fan || (fan === best.fan && raw > best.rawFan)) best = { items: items, fan: fan, rawFan: raw, pattern: pattern };
    }
    if (ctx.flowerWin) {
      var n = (ctx.flowers || []).length;
      if (n < 7) return { winning: false, valid: false, fan: 0, rawFan: 0, limit: false, items: [], replaced: [], pattern: 'flowers', groups: [], points: 1 };
      var it = n >= 8 ? item('eightFlowers', 8, '大花糊') : item('sevenFlowers', 3, '花糊');
      return { winning: true, valid: true, fan: it.fan, rawFan: it.fan, limit: false, items: [it], replaced: [], pattern: 'flowers', groups: [], points: points(it.fan) };
    }
    var shapes = H.winningShapes(ctx.hand, ctx.melds, ctx.settings.optional);
    shapes.forEach(function (sh) {
      var items;
      if (sh.pattern === 'standard') items = scoreStandard(ctx, sh);
      else {
        items = [];
        var v = { sevenPairs: 4, knitted: 5, lesserHonours: 8, greaterHonours: 10, thirteenOrphans: 13 }[sh.pattern] || 0;
        items.push(item(sh.pattern, v));
        if (sh.pattern === 'sevenPairs') { tileItems(ctx.hand, items); if (sh.luxury) items.push(item('luxurySevenPairs', 2 * sh.luxury)); }
        winItems(ctx, items, true, sh.pattern !== 'knitted');
      }
      if (ctx.blessing) items.push(item(ctx.blessing, 13));
      bonusItems(ctx, items);
      consider(items, sh.pattern);
    });
    if (!best) return { winning: false, valid: false, fan: 0, rawFan: 0, limit: false, items: [], replaced: [], pattern: null, groups: [], points: 1 };
    return { winning: true, valid: best.fan >= minFan || !!ctx.blessing, fan: best.fan, rawFan: best.rawFan, limit: best.rawFan >= 13,
      items: best.items, replaced: [], pattern: best.pattern, groups: [], points: points(best.fan) };
  }

  function payments(o) {
    var P = o.unit === 'chips' ? Math.max(1, Math.min(o.fan, 13)) : points(o.fan);
    var d = [0, 0, 0, 0];
    if (o.source === 'self') { for (var i = 0; i < 4; i++) if (i !== o.winner) { d[i] -= P; d[o.winner] += P; } }
    else if (o.payment === 'shared') {
      for (i = 0; i < 4; i++) if (i !== o.winner) { var x = i === o.payer ? P : P / 2; d[i] -= x; d[o.winner] += x; }
    } else { d[o.payer] -= 2 * P; d[o.winner] += 2 * P; }
    return d;
  }

  HKMJ.Scoring = { evaluate: evaluate, points: points, payments: payments, FEATURES: {}, FEATURE_ORDER: [], _stub: true };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Scoring;
})(typeof globalThis !== 'undefined' ? globalThis : this);
