/* HK Mahjong — core/scoring.js  (Owner: back end)
 * Fan scoring exactly as the booklet "HK Mahjong Scoring Sheet v1.0" (SPEC §3).
 *
 *   Scoring.evaluate(ctx) -> Evaluation          (see SPEC §3.7)
 *   Scoring.points(fan)   -> Payment Table points (p.16, New Style)
 *   Scoring.payments({fan, winner, source, payer, payment, unit}) -> [d0,d1,d2,d3]
 *   Scoring.FEATURES, Scoring.FEATURE_ORDER       (catalogue for the rules screen / result screen)
 *
 * Principles (p.1): Fan = SUM of every matching feature; an indented feature REPLACES its parent; triplets and
 * quadruplets are interchangeable; pairs never score; the total is held at the 13 Fan limit (rawFan keeps the sum).
 * "Includes" (p.6): Mixed Terminals / All Terminals / All Honours contain the 3 Fan of All Triplets.  When All
 * Concealed Triplets or All Quadruplets replaces All Triplets, the tile-type feature is shown less those 3 Fan
 * (SPEC §3.4), which reproduces the booklet's combination tables (e.g. Mixed Terminals + All Concealed Triplets = 9).
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles, H = HKMJ.Hand;
  var LIMIT = 13;
  var POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];

  function points(fan) {
    var f = Math.floor(+fan || 0);
    if (f < 0) f = 0;
    if (f > LIMIT) f = LIMIT;
    return POINTS[f];
  }

  // ------------------------------------------------------------------------------------------------ catalogue
  function F(name, zh, fan, fanText, group, optional, page, desc, replaces, extra) {
    var o = { name: name, zh: zh, fan: fan, fanText: fanText, group: group, optional: optional, page: page, desc: desc, replaces: replaces || [] };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  var FEATURES = {
    // Win Actions (p.2)
    selfPick: F('Self-Pick', '自摸', 1, '1', 'win', false, 2, 'You draw your winning tile from the wall yourself.'),
    kongReplacement: F('Win by Kong Replacement', '槓上開花', 2, '2', 'win', false, 2,
      'The winning tile is the replacement tile drawn after declaring a Kong. Replaces Self-Pick — score 2, not 2 + 1.', ['selfPick']),
    doubleKong: F('Double Kong Replacement', '槓上槓', 9, '9', 'win', false, 2,
      'Declare a Kong, declare a second Kong with the replacement tile, then win on the second replacement. Replaces Self-Pick and Win by Kong Replacement — score 9 only.',
      ['selfPick', 'kongReplacement']),
    concealed: F('Concealed Hand', '門前清', 1, '1', 'win', false, 2,
      'You took no tiles from other players to build your hand: no Chow, Pong or open Kong (concealed Kongs are fine, and winning on a discard still counts).'),
    robKong: F('Robbing the Kong', '搶槓', 1, '1', 'win', false, 2,
      'You win with the tile another player adds to an exposed Pong to make a Kong.'),
    moon: F('Moon Under The Sea', '海底撈月', 1, '1', 'win', false, 2, 'Your winning tile is the last tile of the wall or the last discard.'),
    // Hands by Set Type (p.3)
    allSequences: F('All Sequences', '平糊', 1, '1', 'set', false, 3, 'All four sets are sequences, plus a pair (which may be honours).'),
    allTriplets: F('All Triplets', '對對糊', 3, '3', 'set', false, 3, 'All four sets are triplets or quadruplets, plus a pair.'),
    allConcealedTriplets: F('All Concealed Triplets', '四暗刻', 8, '8', 'set', false, 3,
      'Four triplets, none taken from another player. Win by Self-Pick, or on a discard that completes the pair — a discard that completes a triplet exposes it and the hand is All Triplets. Replaces All Triplets — score 8, not 8 + 3; Concealed Hand is built in.',
      ['allTriplets'], { builtIn: ['concealed'] }),
    allQuadruplets: F('All Quadruplets', '四槓子', 13, '13 (limit)', 'set', false, 3,
      'All four sets are Kongs, plus a pair. Kongs may be claimed from discards; a discard that completes the fourth Kong is not a win — declare the Kong and win on the replacement or a later tile. Replaces All Triplets (and the † Kong score).',
      ['allTriplets', 'kong']),
    // Hands by Tile Type (p.4-6)
    dragon: F('Dragon', '三元牌', 1, '1 per dragon triplet', 'tile', false, 4,
      'Each triplet (or Kong) of dragons 中 發 白 scores 1 Fan. A pair scores nothing.'),
    smallThreeDragons: F('Small Three Dragons', '小三元', 5, '5', 'tile', false, 4,
      'Two dragon triplets and a pair of the third dragon. Replaces the per-triplet Dragon score — score 5 flat.', ['dragon']),
    bigThreeDragons: F('Big Three Dragons', '大三元', 8, '8', 'tile', false, 4,
      'Three dragon triplets. Replaces Dragon and Small Three Dragons — score 8 flat.', ['dragon', 'smallThreeDragons']),
    roundWind: F('Round Wind', '圈風', 1, '1', 'tile', false, 5, 'A triplet of the current round\'s wind. A triplet of a wind that is neither round nor seat wind scores nothing.'),
    seatWind: F('Seat Wind', '門風', 1, '1', 'tile', false, 5, 'A triplet of your own seat wind. One triplet that is both round and seat wind scores 2.'),
    smallFourWinds: F('Small Four Winds', '小四喜', 6, '6', 'tile', false, 5,
      'Three wind triplets and a pair of the fourth wind. Replaces Round / Seat Wind — score 6 flat.', ['roundWind', 'seatWind']),
    bigFourWinds: F('Big Four Winds', '大四喜', 13, '13 (limit)', 'tile', false, 5,
      'Four wind triplets — the limit on its own. Replaces Round / Seat Wind and Small Four Winds.', ['roundWind', 'seatWind', 'smallFourWinds']),
    mixedFlush: F('Mixed Flush', '混一色', 3, '3', 'tile', false, 5, 'Only one suit plus honours (winds & dragons); sequences and triplets are both fine.'),
    fullFlush: F('Full Flush', '清一色', 7, '7', 'tile', false, 5, 'Only one suit, no honours. Replaces Mixed Flush — score 7, not 7 + 3.', ['mixedFlush']),
    mixedTerminals: F('Mixed Terminals', '混么九', 4, '4', 'tile', false, 6,
      'Only 1s, 9s and honours. The 3 Fan of All Triplets is included in the 4.', ['allTriplets'], { includes: ['allTriplets'] }),
    allTerminals: F('All Terminals', '清么九', 13, '13 (limit)', 'tile', false, 6,
      'Only 1s and 9s. The 3 Fan of All Triplets is included. Replaces Mixed Terminals and All Triplets.', ['mixedTerminals', 'allTriplets'], { includes: ['allTriplets'] }),
    allHonours: F('All Honours', '字一色', 10, '10', 'tile', false, 6,
      'Only honour tiles (winds & dragons). The 3 Fan of All Triplets is included. Replaces Mixed Terminals and All Triplets; with no suit tiles, Mixed Flush does not apply.',
      ['mixedTerminals', 'allTriplets'], { includes: ['allTriplets'] }),
    kong: F('Kong', '槓', 1, '1 open / 2 concealed, each', 'tile', true, 6,
      '† Each quadruplet scores: an open Kong 1 Fan, a concealed Kong 2 Fan. Four Kongs is All Quadruplets, which replaces this.'),
    // Special Hands (p.7-9)
    sevenPairs: F('Seven Pairs', '七對子', 4, '4', 'special', true, 7,
      '† Seven different pairs. Stacks with Mixed Flush, Full Flush and All Honours; with no sets there are no triplet or Kong scores. Concealed Hand is built in.',
      [], { builtIn: ['concealed'] }),
    luxurySevenPairs: F('Luxury Seven Pairs', '豪華七對', 2, '2 per four-of-a-kind', 'special', true, 7,
      '† A Seven Pairs hand in which four identical tiles stand as two of the pairs; scores for each such set. A declared Kong breaks it, and an honour quad adds no Dragon Fan.'),
    knitted: F('Knitted Tiles', '組合龍', 5, '5', 'special', true, 7,
      '† 1-4-7 in one suit, 2-5-8 in the second, 3-6-9 in the third, plus one ordinary set and a pair. The set may be Chowed or Ponged and scores its own Dragon / Wind Fan; Concealed adds 1. Three suits, so never a flush.'),
    lesserHonours: F('Lesser Honours', '全不靠', 8, '8', 'special', true, 8,
      '† Fourteen single tiles: honours plus knitted tiles (1-4-7, 2-5-8, 3-6-9, one run to each suit) — 9 knitted + 5 honours or 8 knitted + 6 honours. Concealed Hand is built in; Self-Pick and flowers still add.',
      [], { builtIn: ['concealed'] }),
    greaterHonours: F('Greater Honours', '七星不靠', 10, '10', 'special', true, 8,
      '† All seven honours as singles plus any seven knitted tiles — fourteen singles. Concealed Hand is built in; Self-Pick and flowers still add.',
      [], { builtIn: ['concealed'] }),
    thirteenOrphans: F('Thirteen Orphans', '十三么', 13, '13 (limit)', 'special', false, 8,
      'One of each 1 and 9 of the three suits and one of each of the seven honours, plus a duplicate of any of them. Concealed by definition.',
      [], { builtIn: ['concealed'] }),
    nineGates: F('Nine Gates', '九蓮寶燈', 13, '13 (limit)', 'special', false, 8,
      '1112345678999 of one suit plus any tile of that suit — nine ways to win. Must be fully concealed; the Full Flush inside it is not added.',
      ['fullFlush'], { builtIn: ['concealed'] }),
    heaven: F('Blessing of Heaven', '天糊', 13, '13 (limit)', 'special', false, 8, 'As dealer, your beginning hand wins. The pattern needs no Fan of its own.'),
    earth: F('Blessing of Earth', '地糊', 13, '13 (limit)', 'special', false, 9, 'As non-dealer, you win on the dealer\'s first discard. The pattern needs no Fan of its own.'),
    man: F('Blessing of Man', '人糊', 13, '13 (limit)', 'special', false, 9, 'As non-dealer, you win by Self-Pick on your first turn. The pattern needs no Fan of its own.'),
    // Bonus Tiles (p.9)
    noFlowers: F('No Flowers or Seasons', '無花', 1, '1', 'bonus', false, 9, 'You drew none of the eight bonus tiles all hand — the Fan is for their absence.'),
    seatFlower: F('Seat Flower or Season', '正花', 1, '1 each', 'bonus', false, 9,
      '1 Fan for each flower or season matching your seat number: East 1, South 2, West 3, North 4.'),
    allFlowers: F('All Flowers', '一檯花', 2, '2', 'bonus', false, 9, 'All four flowers 梅蘭菊竹. A mix of four bonus tiles from both groups does not count.'),
    allSeasons: F('All Seasons', '一檯花', 2, '2', 'bonus', false, 9, 'All four seasons 春夏秋冬. A mix of four bonus tiles from both groups does not count.'),
    sevenFlowers: F('Seven Flowers', '花糊', 3, '3', 'bonus', false, 9, 'Collect seven of the eight bonus tiles and you may win at once, whatever your hand holds.'),
    eightFlowers: F('Eight Flowers', '大花糊', 8, '8', 'bonus', false, 9, 'Collect all eight bonus tiles and you may win at once, whatever your hand holds.', ['sevenFlowers'])
  };
  var FEATURE_ORDER = [
    'selfPick', 'kongReplacement', 'doubleKong', 'concealed', 'robKong', 'moon',
    'allSequences', 'allTriplets', 'allConcealedTriplets', 'allQuadruplets',
    'dragon', 'smallThreeDragons', 'bigThreeDragons', 'roundWind', 'seatWind', 'smallFourWinds', 'bigFourWinds',
    'mixedFlush', 'fullFlush', 'mixedTerminals', 'allTerminals', 'allHonours', 'kong',
    'sevenPairs', 'luxurySevenPairs', 'knitted', 'lesserHonours', 'greaterHonours', 'thirteenOrphans', 'nineGates',
    'heaven', 'earth', 'man',
    'noFlowers', 'seatFlower', 'allFlowers', 'allSeasons', 'sevenFlowers', 'eightFlowers'
  ];
  var PATTERN_RANK = { standard: 0, sevenPairs: 1, knitted: 2, lesserHonours: 3, greaterHonours: 4, thirteenOrphans: 5 };

  // ------------------------------------------------------------------------------------------------ helpers
  function label(k) { return T.zh(k) + ' ' + T.name(k); }
  function honourLabel(k) { return T.zh(k) + ' ' + T.name(k); }
  function suitLabel(s) { return T.SUIT_NAMES[s] + ' ' + T.SUIT_ZH[s]; }
  function isTrip(s) { return s.type === 'pong' || s.type === 'kong'; }
  function setWord(s) { return s.type === 'kong' ? 'Kong' : 'triplet'; }

  /** Accumulates counted items and replaced entries for one interpretation. */
  function Tally() { this.items = []; this.replaced = []; }
  Tally.prototype.add = function (id, fan, detail) {
    var f = FEATURES[id];
    var it = { id: id, name: f.name, zh: f.zh, fan: fan };
    if (detail) it.detail = detail;
    this.items.push(it);
    return it;
  };
  Tally.prototype.rep = function (id, fan, reason) {
    var f = FEATURES[id];
    for (var i = 0; i < this.replaced.length; i++) {
      var r = this.replaced[i];
      if (r.id === id && r.reason === reason) { r.fan += fan; return r; }
    }
    var e = { id: id, name: f.name, zh: f.zh, fan: fan, reason: reason };
    this.replaced.push(e);
    return e;
  };
  Tally.prototype.total = function () { var s = 0; for (var i = 0; i < this.items.length; i++) s += this.items[i].fan; return s; };

  function normMelds(melds) {
    return (melds || []).map(function (m) {
      var tiles = (m.tiles || []).slice().sort(function (a, b) { return a - b; });
      return { type: m.type, tiles: tiles, concealed: m.type === 'kong' ? !!m.concealed : false, from: m.from, claimed: m.claimed, added: m.added };
    });
  }

  // ------------------------------------------------------------------------------------------------ shared feature blocks
  function winActions(t, env, builtInConcealedBy) {
    var wt = env.winTile;
    if (env.source === 'self') {
      var kr = env.kongReplacement | 0;
      if (kr >= 2) {
        t.add('doubleKong', 9, 'Kong, then a second Kong on the replacement, won on the second replacement');
        t.rep('selfPick', 1, 'replaced by Double Kong Replacement — score 9 only');
        t.rep('kongReplacement', 2, 'replaced by Double Kong Replacement — score 9 only');
      } else if (kr === 1) {
        t.add('kongReplacement', 2, 'won on the replacement tile' + (wt != null ? ' ' + label(wt) : '') + ' drawn after a Kong');
        t.rep('selfPick', 1, 'replaced by Win by Kong Replacement — score 2, not 2 + 1');
      } else {
        t.add('selfPick', 1, wt != null ? 'you drew the winning ' + label(wt) + ' from the wall' : 'you drew the winning tile from the wall');
      }
    }
    if (env.source === 'robKong') t.add('robKong', 1, 'won with the ' + (wt != null ? label(wt) + ' ' : '') + 'robbed from an added Kong');
    if (env.lastTile) t.add('moon', 1, env.source === 'self' ? 'won on the last tile of the wall' : 'won on the last discard of the hand');
    if (env.concealedHand) {
      if (builtInConcealedBy) t.rep('concealed', 1, builtInConcealedBy);
      else t.add('concealed', 1, env.source === 'self' ? 'no Chow, Pong or open Kong'
        : 'no Chow, Pong or open Kong before the winning ' + (env.source === 'robKong' ? 'robbed tile' : 'discard') + ' — still counts');
    }
  }
  function blessingItems(t, env) {
    if (env.blessing === 'heaven') t.add('heaven', 13, 'as dealer, your beginning hand wins — no Fan of its own needed');
    else if (env.blessing === 'earth') t.add('earth', 13, 'won on the dealer\'s first discard — no Fan of its own needed');
    else if (env.blessing === 'man') t.add('man', 13, 'Self-Pick on your first turn — no Fan of its own needed');
  }
  function bonusItems(t, env) {
    var fl = env.flowers;
    if (!fl.length) { t.add('noFlowers', 1, 'no flowers or seasons all hand'); return; }
    var seatNo = env.seatWind + 1;
    var have = {};
    fl.forEach(function (f) { have[f] = true; });
    fl.slice().sort(function (a, b) { return a - b; }).forEach(function (f) {
      if (T.bonusNumber(f) === seatNo) {
        var nm = T.isFlower(f) ? T.FLOWER_NAMES[f - T.FLOWER0] : T.SEASON_NAMES[f - T.SEASON0];
        t.add('seatFlower', 1, T.zh(f) + ' ' + nm + ' — your seat ' + (T.isFlower(f) ? 'flower' : 'season') + ' (' + T.WIND_NAMES[env.seatWind] + ' ' + seatNo + ')');
      }
    });
    if (have[34] && have[35] && have[36] && have[37]) t.add('allFlowers', 2, '梅蘭菊竹 — all four flowers');
    if (have[38] && have[39] && have[40] && have[41]) t.add('allSeasons', 2, '春夏秋冬 — all four seasons');
  }
  /** suits used, honours present, terminal/honour status over a list of kinds */
  function tileProfile(all) {
    var suits = [false, false, false], hon = false, allTH = true, term = false;
    for (var i = 0; i < all.length; i++) {
      var k = all[i];
      if (k >= 27) hon = true;
      else { suits[Math.floor(k / 9)] = true; var r = k % 9; if (r === 0 || r === 8) term = true; else allTH = false; }
    }
    var nSuits = (suits[0] ? 1 : 0) + (suits[1] ? 1 : 0) + (suits[2] ? 1 : 0);
    var suit = suits[0] ? 0 : suits[1] ? 1 : suits[2] ? 2 : -1;
    return { nSuits: nSuits, suit: suit, honours: hon, allTermHon: allTH, terminals: term };
  }
  function flushItems(t, prof, nineGates) {
    if (prof.nSuits !== 1) return;
    if (prof.honours) { t.add('mixedFlush', 3, suitLabel(prof.suit) + ' + honours'); return; }
    if (nineGates) { t.rep('fullFlush', 7, 'the Full Flush 7 inside Nine Gates is not added'); return; }
    t.add('fullFlush', 7, suitLabel(prof.suit) + ' only');
    t.rep('mixedFlush', 3, 'replaced by Full Flush — score 7, not 7 + 3');
  }

  // ------------------------------------------------------------------------------------------------ pattern scorers
  function scoreStandard(ip, env) {
    var t = new Tally();
    var sets = ip.sets, pair = ip.pair, opt = env.opt;
    var all = env.allTiles;
    var nChow = 0, nTrip = 0, nKong = 0, allConc = true;
    sets.forEach(function (s) {
      if (s.type === 'chow') nChow++;
      else { nTrip++; if (s.type === 'kong') nKong++; if (!s.concealed) allConc = false; }
    });
    var prof = tileProfile(all);
    var nineGates = false;
    if (!env.melds.length && prof.nSuits === 1 && !prof.honours) {
      var c = H.counts(all), o = prof.suit * 9;
      nineGates = c[o] >= 3 && c[o + 8] >= 3;
      for (var r = 1; r < 8 && nineGates; r++) if (c[o + r] < 1) nineGates = false;
    }
    var allTrip = nTrip === 4, act = allTrip && allConc, aq = nKong === 4;

    blessingItems(t, env);
    if (nineGates) t.add('nineGates', 13, '1112345678999 of ' + suitLabel(prof.suit) + ' + ' + label(env.winTile != null ? env.winTile : all[all.length - 1]));
    winActions(t, env, act ? 'built in to All Concealed Triplets — concealment is required'
      : nineGates ? 'built in to Nine Gates — it must be fully concealed' : null);

    // --- set type
    if (nChow === 4) t.add('allSequences', 1, 'four sequences + ' + label(pair) + ' pair');
    var tileType = null; // {id, fan}
    if (prof.allTermHon) {
      if (!prof.honours) tileType = { id: 'allTerminals', fan: 13, what: 'only 1s and 9s' };
      else if (!prof.terminals) tileType = { id: 'allHonours', fan: 10, what: 'only winds and dragons' };
      else tileType = { id: 'mixedTerminals', fan: 4, what: 'only 1s, 9s and honours' };
    }
    if (allTrip) {
      if (act) t.add('allConcealedTriplets', 8, 'four concealed triplets' + (env.source === 'discard' || env.source === 'robKong' ? ' — the discard completed the pair' : ''));
      if (aq) t.add('allQuadruplets', 13, 'four Kongs + ' + label(pair) + ' pair');
      if (act || aq) {
        t.rep('allTriplets', 3, act ? 'replaced by All Concealed Triplets — score 8, not 8 + 3' : 'replaced by All Quadruplets');
        if (tileType) t.add(tileType.id, tileType.fan - 3, tileType.what + ' — ' + tileType.fan + ', less the All Triplets 3 it includes');
      } else if (tileType) {
        t.add(tileType.id, tileType.fan, tileType.what + ' — includes All Triplets 3');
        t.rep('allTriplets', 3, 'included in ' + FEATURES[tileType.id].name + ' — its ' + tileType.fan + ' Fan contain All Triplets 3');
      } else {
        t.add('allTriplets', 3, 'four ' + (nKong ? 'triplets / Kongs' : 'triplets') + ' + ' + label(pair) + ' pair');
      }
      if (tileType && tileType.id !== 'mixedTerminals') t.rep('mixedTerminals', 4, 'replaced by ' + FEATURES[tileType.id].name);
    } else if (tileType) {
      // cannot happen in a standard shape (terminal/honour-only sets are always triplets) — keep it safe
      t.add(tileType.id, tileType.fan, tileType.what);
    }

    // --- dragons
    var dTrips = sets.filter(function (s) { return isTrip(s) && T.isDragon(s.tiles[0]); });
    if (dTrips.length === 3) {
      t.add('bigThreeDragons', 8, '中 發 白 triplets');
      t.rep('dragon', 3, 'replaced by Big Three Dragons — score 8 flat');
    } else if (dTrips.length === 2 && T.isDragon(pair)) {
      t.add('smallThreeDragons', 5, dTrips.map(function (s) { return T.zh(s.tiles[0]); }).join(' ') + ' triplets + ' + T.zh(pair) + ' pair');
      t.rep('dragon', 2, 'replaced by Small Three Dragons — score 5 flat');
    } else {
      dTrips.forEach(function (s) { t.add('dragon', 1, honourLabel(s.tiles[0]) + ' ' + setWord(s)); });
    }
    // --- winds
    var wTrips = sets.filter(function (s) { return isTrip(s) && T.isWind(s.tiles[0]); });
    var rw = T.windKind(env.roundWind), sw = T.windKind(env.seatWind);
    var hasRW = false, hasSW = false;
    wTrips.forEach(function (s) { if (s.tiles[0] === rw) hasRW = true; if (s.tiles[0] === sw) hasSW = true; });
    if (wTrips.length === 4) {
      t.add('bigFourWinds', 13, '東 南 西 北 triplets — the limit on its own');
      if (hasSW) t.rep('seatWind', 1, 'replaced by Big Four Winds');
      if (hasRW) t.rep('roundWind', 1, 'replaced by Big Four Winds');
    } else if (wTrips.length === 3 && T.isWind(pair)) {
      t.add('smallFourWinds', 6, wTrips.map(function (s) { return T.zh(s.tiles[0]); }).join(' ') + ' triplets + ' + T.zh(pair) + ' pair');
      if (hasSW) t.rep('seatWind', 1, 'replaced by Small Four Winds — score 6 flat');
      if (hasRW) t.rep('roundWind', 1, 'replaced by Small Four Winds — score 6 flat');
    } else {
      wTrips.forEach(function (s) {
        var k = s.tiles[0];
        if (k === sw) t.add('seatWind', 1, honourLabel(k) + ' ' + setWord(s) + ' — your seat wind');
        if (k === rw) t.add('roundWind', 1, honourLabel(k) + ' ' + setWord(s) + (k === sw ? ' — also the round wind' : ' — the round wind'));
      });
    }
    // --- flush
    flushItems(t, prof, nineGates);
    // --- † kong
    if (opt.kong && nKong) {
      sets.forEach(function (s) {
        if (s.type !== 'kong') return;
        var f = s.concealed ? 2 : 1;
        if (aq) t.rep('kong', f, 'replaced by All Quadruplets');
        else t.add('kong', f, (s.concealed ? 'concealed Kong of ' : 'open Kong of ') + label(s.tiles[0]));
      });
    }
    bonusItems(t, env);
    return t;
  }

  function scoreSevenPairs(ip, env) {
    var t = new Tally();
    blessingItems(t, env);
    var quads = ip.luxury;
    t.add('sevenPairs', 4, quads ? 'seven pairs' : 'seven different pairs');
    ip.quadKinds.forEach(function (k) { t.add('luxurySevenPairs', 2, T.zh(k) + T.zh(k) + T.zh(k) + T.zh(k) + ' — four identical tiles stand as two pairs'); });
    winActions(t, env, 'built in to Seven Pairs — you never Pong or Chow');
    var prof = tileProfile(env.allTiles);
    if (prof.nSuits === 0) t.add('allHonours', 10, 'only winds and dragons');
    else flushItems(t, prof, false);
    bonusItems(t, env);
    return t;
  }

  function scoreKnitted(ip, env) {
    var t = new Tally();
    blessingItems(t, env);
    var arr = ip.arrangementSuits; // [suit of 147, suit of 258, suit of 369]
    t.add('knitted', 5, '1-4-7 ' + T.SUIT_ZH[arr[0]] + ', 2-5-8 ' + T.SUIT_ZH[arr[1]] + ', 3-6-9 ' + T.SUIT_ZH[arr[2]] + ' + one set + pair');
    winActions(t, env, null);
    var s = ip.set;
    if (isTrip(s)) {
      var k = s.tiles[0];
      if (T.isDragon(k)) t.add('dragon', 1, honourLabel(k) + ' ' + setWord(s));
      if (T.isWind(k)) {
        var sw = T.windKind(env.seatWind), rw = T.windKind(env.roundWind);
        if (k === sw) t.add('seatWind', 1, honourLabel(k) + ' ' + setWord(s) + ' — your seat wind');
        if (k === rw) t.add('roundWind', 1, honourLabel(k) + ' ' + setWord(s) + (k === sw ? ' — also the round wind' : ' — the round wind'));
      }
      if (s.type === 'kong' && env.opt.kong) t.add('kong', s.concealed ? 2 : 1, (s.concealed ? 'concealed Kong of ' : 'open Kong of ') + label(k));
    }
    bonusItems(t, env);
    return t;
  }

  function scoreHonours(ip, env) {
    var t = new Tally();
    blessingItems(t, env);
    if (ip.pattern === 'greaterHonours') {
      t.add('greaterHonours', 10, 'all seven honours + ' + ip.knitted.length + ' knitted tiles, all single');
      winActions(t, env, 'built in to Greater Honours — concealed by definition');
    } else {
      t.add('lesserHonours', 8, ip.knitted.length + ' knitted + ' + ip.honours.length + ' honours, all single');
      winActions(t, env, 'built in to Lesser Honours — with no sets there is nothing to claim');
    }
    bonusItems(t, env);
    return t;
  }

  function scoreOrphans(ip, env) {
    var t = new Tally();
    blessingItems(t, env);
    t.add('thirteenOrphans', 13, 'every 1, 9 and honour + a second ' + label(ip.pair));
    winActions(t, env, 'built in to Thirteen Orphans — concealed by definition');
    bonusItems(t, env);
    return t;
  }

  // ------------------------------------------------------------------------------------------------ interpretations
  function group(kind, tiles, concealed, fromMeld, hasWinTile) {
    return { kind: kind, tiles: tiles.slice(), concealed: concealed, fromMeld: fromMeld, hasWinTile: !!hasWinTile };
  }
  function meldSets(melds) {
    return melds.map(function (m) {
      return { type: m.type, tiles: m.tiles.slice(), fromMeld: true, concealed: m.type === 'kong' ? !!m.concealed : false, hasWinTile: false };
    });
  }
  function exposingSource(src) { return src === 'discard' || src === 'robKong'; }

  function standardInterps(shape, env) {
    var cs = shape.sets.map(function (s) { return { type: s.type, tiles: s.tiles.slice(), fromMeld: false, concealed: true, hasWinTile: false }; });
    cs.sort(function (a, b) { return a.tiles[0] - b.tiles[0] || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0); });
    var ms = meldSets(env.melds);
    var wt = env.winTile, places = [], seen = {};
    if (wt != null) {
      cs.forEach(function (s, i) {
        if (s.tiles.indexOf(wt) < 0) return;
        var key = s.type + ':' + s.tiles[0];
        if (seen[key]) return;
        seen[key] = true;
        places.push({ set: i });
      });
      if (shape.pair === wt) places.push({ pair: true });
    }
    if (!places.length) places.push({});
    return places.map(function (pl) {
      var sets = cs.map(function (s) { return { type: s.type, tiles: s.tiles, fromMeld: false, concealed: true, hasWinTile: false }; });
      if (pl.set !== undefined) {
        sets[pl.set].hasWinTile = true;
        if (exposingSource(env.source) && sets[pl.set].type === 'pong') sets[pl.set].concealed = false;
      }
      var groups = sets.map(function (s) { return group(s.type, s.tiles, s.concealed, false, s.hasWinTile); });
      groups.push(group('pair', [shape.pair, shape.pair], true, false, !!pl.pair));
      ms.forEach(function (s) { groups.push(group(s.type, s.tiles, s.concealed, true, false)); });
      return { pattern: 'standard', sets: sets.concat(ms), pair: shape.pair, groups: groups };
    });
  }
  function sevenPairsInterp(shape, env) {
    var marked = false, quadKinds = [], seenQ = {};
    var groups = shape.pairs.map(function (k) {
      var w = !marked && k === env.winTile;
      if (w) marked = true;
      return group('pair', [k, k], true, false, w);
    });
    shape.pairs.forEach(function (k, i) { if (shape.pairs.indexOf(k) !== i && !seenQ[k]) { seenQ[k] = true; quadKinds.push(k); } });
    return [{ pattern: 'sevenPairs', luxury: shape.luxury, quadKinds: quadKinds, groups: groups }];
  }
  function knittedInterps(shape, env) {
    var arrS = [0, 0, 0];
    shape.knitted.forEach(function (k) { arrS[(k % 9) % 3] = Math.floor(k / 9); });
    var set;
    if (shape.meldSet) set = meldSets(env.melds)[0];
    else set = { type: shape.sets[0].type, tiles: shape.sets[0].tiles.slice(), fromMeld: false, concealed: true, hasWinTile: false };
    var wt = env.winTile, places = [];
    if (wt != null) {
      if (!set.fromMeld && set.tiles.indexOf(wt) >= 0) places.push('set');
      if (shape.pair === wt) places.push('pair');
      if (shape.knitted.indexOf(wt) >= 0) places.push('knit');
    }
    if (!places.length) places.push('');
    return places.map(function (pl) {
      var s = { type: set.type, tiles: set.tiles, fromMeld: set.fromMeld, concealed: set.concealed, hasWinTile: pl === 'set' };
      if (pl === 'set' && exposingSource(env.source) && s.type === 'pong') s.concealed = false;
      var groups = [group('knitted', shape.knitted, true, false, pl === 'knit')];
      var sg = group(s.type, s.tiles, s.concealed, s.fromMeld, s.hasWinTile);
      if (!s.fromMeld) groups.push(sg);
      groups.push(group('pair', [shape.pair, shape.pair], true, false, pl === 'pair'));
      if (s.fromMeld) groups.push(sg);
      return { pattern: 'knitted', set: s, pair: shape.pair, arrangementSuits: arrS, groups: groups };
    });
  }
  function honoursInterp(shape, env) {
    var wt = env.winTile;
    var inKnit = wt != null && shape.knitted.indexOf(wt) >= 0;
    var groups = [group('knitted', shape.knitted, true, false, inKnit),
      group('single', shape.honours, true, false, wt != null && !inKnit && shape.honours.indexOf(wt) >= 0)];
    return [{ pattern: shape.pattern, knitted: shape.knitted, honours: shape.honours, groups: groups }];
  }
  function orphansInterp(shape, env, hand) {
    var singles = [];
    var seen = {};
    T.sort(hand).forEach(function (k) { if (!seen[k]) { seen[k] = true; singles.push(k); } });
    singles = singles.filter(function (k) { return k !== shape.pair; });
    var wt = env.winTile;
    var groups = [group('single', singles, true, false, wt != null && wt !== shape.pair && singles.indexOf(wt) >= 0),
      group('pair', [shape.pair, shape.pair], true, false, wt === shape.pair)];
    return [{ pattern: 'thirteenOrphans', pair: shape.pair, groups: groups }];
  }

  function emptyEval(minFan, pattern) {
    return { winning: false, valid: false, fan: 0, rawFan: 0, limit: false, items: [], replaced: [], pattern: pattern || null, groups: [], points: points(0), minFan: minFan };
  }

  // ------------------------------------------------------------------------------------------------ evaluate
  function evaluate(ctx) {
    ctx = ctx || {};
    var settings = ctx.settings || {};
    var opt = H.optionalOf(settings.optional);
    var minFan = (settings.minFan === undefined || settings.minFan === null) ? 3 : +settings.minFan;
    var flowers = (ctx.flowers || []).filter(function (k) { return T.isBonus(k); });
    var seatWind = (ctx.seatWind | 0) & 3, roundWind = (ctx.roundWind | 0) & 3;

    if (ctx.flowerWin) return evaluateFlowerWin(flowers, seatWind, minFan);

    var hand = (ctx.hand || []).filter(function (k) { return k >= 0 && k < 34; });
    var melds = normMelds(ctx.melds);
    var winTile = (ctx.winTile === undefined || ctx.winTile === null) ? null : ctx.winTile;
    if (winTile !== null && hand.indexOf(winTile) < 0) winTile = null;
    var source = ctx.source === 'discard' || ctx.source === 'robKong' ? ctx.source : 'self';
    var allTiles = hand.slice();
    melds.forEach(function (m) { allTiles = allTiles.concat(m.tiles); });
    var env = {
      opt: opt, melds: melds, winTile: winTile, source: source,
      kongReplacement: source === 'self' ? (ctx.kongReplacement | 0) : 0,
      lastTile: !!ctx.lastTile, seatWind: seatWind, roundWind: roundWind, flowers: flowers,
      blessing: (ctx.blessing === 'heaven' || ctx.blessing === 'earth' || ctx.blessing === 'man') ? ctx.blessing : null,
      concealedHand: melds.every(function (m) { return m.type === 'kong' && m.concealed; }),
      allTiles: allTiles
    };

    var shapes = H.winningShapes(hand, melds, opt);
    if (!shapes.length) return emptyEval(minFan);

    var best = null;
    function consider(ip, tally) {
      var raw = tally.total();
      var fan = raw > LIMIT ? LIMIT : raw;
      var rank = PATTERN_RANK[ip.pattern] || 0;
      if (best && !(fan > best.fan || (fan === best.fan && (raw > best.raw || (raw === best.raw && rank < best.rank))))) return;
      best = { fan: fan, raw: raw, rank: rank, ip: ip, tally: tally };
    }
    shapes.forEach(function (shape) {
      if (shape.pattern === 'standard') standardInterps(shape, env).forEach(function (ip) { consider(ip, scoreStandard(ip, env)); });
      else if (shape.pattern === 'sevenPairs') sevenPairsInterp(shape, env).forEach(function (ip) { consider(ip, scoreSevenPairs(ip, env)); });
      else if (shape.pattern === 'knitted') knittedInterps(shape, env).forEach(function (ip) { consider(ip, scoreKnitted(ip, env)); });
      else if (shape.pattern === 'lesserHonours' || shape.pattern === 'greaterHonours') honoursInterp(shape, env).forEach(function (ip) { consider(ip, scoreHonours(ip, env)); });
      else if (shape.pattern === 'thirteenOrphans') orphansInterp(shape, env, hand).forEach(function (ip) { consider(ip, scoreOrphans(ip, env)); });
    });

    var fan = best.fan;
    // Chicken hand 雞糊 (booklet: "Chicken (0 Fan) Hand"): the hand itself scores nothing — any Fan it has comes
    // only from bonus tiles (flowers / seasons / No Flowers). Table rule `optional.chicken`: 'minimum' (booklet p.12:
    // like any hand, it needs the Minimum Fan), 'always' (may win even below the minimum) or 'never'.
    // Blessings are never chicken hands.
    var chicken = !env.blessing && best.tally.items.every(function (it) { return FEATURES[it.id] && FEATURES[it.id].group === 'bonus'; });
    var rule = opt.chicken || 'minimum';
    var valid = !!env.blessing || (chicken && rule === 'always') || (fan >= minFan && !(chicken && rule === 'never'));
    return {
      winning: true,
      valid: valid,
      chickenBarred: chicken && rule === 'never' && !env.blessing,   // blocked by the chicken rule, not by the minimum
      chicken: chicken,
      fan: fan,
      rawFan: best.raw,
      limit: best.raw >= LIMIT,
      items: sortItems(best.tally.items),
      replaced: sortItems(best.tally.replaced),
      pattern: best.ip.pattern,
      groups: best.ip.groups,
      points: points(fan),
      minFan: minFan,
      source: source,
      winTile: winTile
    };
  }
  function sortItems(list) {
    return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      return (FEATURE_ORDER.indexOf(a.x.id) - FEATURE_ORDER.indexOf(b.x.id)) || (a.i - b.i);
    }).map(function (o) { return o.x; });
  }

  function evaluateFlowerWin(flowers, seatWind, minFan) {
    var n = 0, seen = {};
    flowers.forEach(function (f) { if (!seen[f]) { seen[f] = true; n++; } });
    if (n < 7) { var e = emptyEval(minFan, 'flowers'); return e; }
    var t = new Tally();
    if (n >= 8) {
      t.add('eightFlowers', 8, 'all eight bonus tiles — you win at once');
      t.rep('sevenFlowers', 3, 'replaced by Eight Flowers');
    } else {
      t.add('sevenFlowers', 3, 'seven of the eight bonus tiles — you win at once');
    }
    // the hand and the other bonus features are not counted (SPEC §2.8)
    var t2 = new Tally();
    bonusItems(t2, { flowers: flowers, seatWind: seatWind });
    t2.items.forEach(function (it) { t.rep(it.id, it.fan, 'a flower win scores its printed value only'); });
    var raw = t.total();
    return {
      winning: true, valid: true, fan: Math.min(raw, LIMIT), rawFan: raw, limit: raw >= LIMIT,
      items: t.items, replaced: t.replaced, pattern: 'flowers', groups: [], points: points(Math.min(raw, LIMIT)),
      minFan: minFan, source: 'flowers', winTile: null
    };
  }

  // ------------------------------------------------------------------------------------------------ payments (p.16)
  function payments(o) {
    o = o || {};
    var fan = Math.max(0, Math.floor(+o.fan || 0));
    var winner = o.winner | 0;
    var unit = o.unit === 'chips' ? 'chips' : 'points';
    var style = o.payment === 'shared' ? 'shared' : 'full';
    var P = unit === 'chips' ? Math.max(1, Math.min(fan, LIMIT)) : points(fan);
    var d = [0, 0, 0, 0];
    var payer = (o.payer === null || o.payer === undefined) ? -1 : (o.payer | 0);
    var byDiscard = (o.source === 'discard' || o.source === 'robKong') && payer >= 0 && payer <= 3 && payer !== winner;
    for (var i = 0; i < 4; i++) {
      if (i === winner) continue;
      if (!byDiscard) d[i] = -P;
      else if (style === 'full') d[i] = i === payer ? -2 * P : 0;
      else d[i] = i === payer ? -P : -P / 2;
    }
    var gain = 0;
    for (i = 0; i < 4; i++) if (i !== winner) gain -= d[i];
    d[winner] = gain;
    for (i = 0; i < 4; i++) if (d[i] === 0) d[i] = 0; // normalise -0
    return d;
  }

  HKMJ.Scoring = {
    evaluate: evaluate,
    points: points,
    payments: payments,
    FEATURES: FEATURES,
    FEATURE_ORDER: FEATURE_ORDER,
    LIMIT: LIMIT,
    POINTS: POINTS.slice()
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Scoring;
})(typeof globalThis !== 'undefined' ? globalThis : this);
