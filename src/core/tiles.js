/* HK Mahjong — core/tiles.js
 * Tile model shared by the engine, scoring, AI and UI.  (Owner: orchestrator — do not change kind ids.)
 *
 * Tile KIND ids (integers):
 *   0-8    Characters / Man 萬  1-9
 *   9-17   Dots 筒              1-9
 *   18-26  Sticks 索            1-9
 *   27-30  Winds   東 南 西 北   (East, South, West, North)
 *   31-33  Dragons 中 發 白      (Red, Green, White)
 *   34-37  Flowers 梅 蘭 菊 竹   (numbers 1-4)
 *   38-41  Seasons 春 夏 秋 冬   (numbers 1-4)
 *
 * Text notation (tests, logs, debugging):
 *   "123m 456p 789s"  suits m / p / s
 *   "1234z" or 東南西北   winds   (1z 東, 2z 南, 3z 西, 4z 北)
 *   "567z"  or 中發白     dragons (5z 中, 6z 發, 7z 白)
 *   "1234f" or 梅蘭菊竹   flowers,  "1234x" or 春夏秋冬 seasons
 *   Whitespace is ignored.  Simplified 发/兰 are accepted as aliases.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});

  var MAN = 0, PIN = 9, SOU = 18;
  var EAST = 27, SOUTH = 28, WEST = 29, NORTH = 30;
  var RED = 31, GREEN = 32, WHITE = 33;
  var FLOWER0 = 34, SEASON0 = 38;
  var PLAYABLE_KINDS = 34, ALL_KINDS = 42;

  var SUIT_LETTERS = ['m', 'p', 's'];
  var SUIT_NAMES = ['Characters', 'Dots', 'Sticks'];
  var SUIT_ZH = ['萬', '筒', '索'];
  var NUM_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var HONOUR_ZH = ['東', '南', '西', '北', '中', '發', '白'];
  var HONOUR_NAMES = ['East Wind', 'South Wind', 'West Wind', 'North Wind', 'Red Dragon', 'Green Dragon', 'White Dragon'];
  var WIND_ZH = ['東', '南', '西', '北'];
  var WIND_NAMES = ['East', 'South', 'West', 'North'];
  var DRAGON_ZH = ['中', '發', '白'];
  var DRAGON_NAMES = ['Red', 'Green', 'White'];
  var FLOWER_ZH = ['梅', '蘭', '菊', '竹'];
  var FLOWER_NAMES = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'];
  var SEASON_ZH = ['春', '夏', '秋', '冬'];
  var SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

  function isSuit(k) { return k >= 0 && k < 27; }
  function suitOf(k) { return (k >= 0 && k < 27) ? Math.floor(k / 9) : -1; } // 0 m, 1 p, 2 s
  function rankOf(k) { return (k >= 0 && k < 27) ? (k % 9) + 1 : 0; }
  function isHonour(k) { return k >= 27 && k <= 33; }
  function isWind(k) { return k >= 27 && k <= 30; }
  function isDragon(k) { return k >= 31 && k <= 33; }
  function isBonus(k) { return k >= 34 && k <= 41; }
  function isFlower(k) { return k >= 34 && k <= 37; }
  function isSeason(k) { return k >= 38 && k <= 41; }
  /** 1..4 for flowers/seasons (matches seat number East 1, South 2, West 3, North 4), else 0 */
  function bonusNumber(k) { return isBonus(k) ? ((k - 34) % 4) + 1 : 0; }
  function isTerminal(k) { return isSuit(k) && (k % 9 === 0 || k % 9 === 8); }
  function isTerminalOrHonour(k) { return isTerminal(k) || isHonour(k); }
  /** suit 0..2, rank 1..9 */
  function tileOf(suit, rank) { return suit * 9 + rank - 1; }
  /** wind index 0..3 (E,S,W,N) -> kind */
  function windKind(w) { return EAST + w; }
  function windIndex(k) { return isWind(k) ? k - EAST : -1; }
  function dragonIndex(k) { return isDragon(k) ? k - RED : -1; }

  function name(k) {
    if (isSuit(k)) return rankOf(k) + ' ' + SUIT_NAMES[suitOf(k)];
    if (isHonour(k)) return HONOUR_NAMES[k - 27];
    if (isFlower(k)) return FLOWER_NAMES[k - FLOWER0] + ' (Flower ' + bonusNumber(k) + ')';
    if (isSeason(k)) return SEASON_NAMES[k - SEASON0] + ' (Season ' + bonusNumber(k) + ')';
    return '?';
  }
  function zh(k) {
    if (isSuit(k)) return NUM_ZH[rankOf(k) - 1] + SUIT_ZH[suitOf(k)];
    if (isHonour(k)) return HONOUR_ZH[k - 27];
    if (isFlower(k)) return FLOWER_ZH[k - FLOWER0];
    if (isSeason(k)) return SEASON_ZH[k - SEASON0];
    return '?';
  }
  /** Compact code: '5p', '東', '梅' */
  function code(k) {
    if (isSuit(k)) return rankOf(k) + SUIT_LETTERS[suitOf(k)];
    return zh(k);
  }

  var CHAR_MAP = {
    '東': EAST, '南': SOUTH, '西': WEST, '北': NORTH,
    '中': RED, '發': GREEN, '发': GREEN, '白': WHITE,
    '梅': 34, '蘭': 35, '兰': 35, '菊': 36, '竹': 37,
    '春': 38, '夏': 39, '秋': 40, '冬': 41
  };

  /** Parse notation into an array of kinds. Throws on bad input. */
  function parse(str) {
    var out = [];
    var digits = [];
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === ',') continue;
      if (ch >= '0' && ch <= '9') { digits.push(+ch); continue; }
      if (CHAR_MAP.hasOwnProperty(ch)) {
        if (digits.length) throw new Error('Tiles.parse: digits before honour char in "' + s + '"');
        out.push(CHAR_MAP[ch]);
        continue;
      }
      var suit = SUIT_LETTERS.indexOf(ch);
      if (suit >= 0) {
        if (!digits.length) throw new Error('Tiles.parse: suit letter without digits in "' + s + '"');
        digits.forEach(function (d) {
          if (d < 1 || d > 9) throw new Error('Tiles.parse: bad rank ' + d);
          out.push(tileOf(suit, d));
        });
        digits = [];
        continue;
      }
      if (ch === 'z' || ch === 'f' || ch === 'x') {
        if (!digits.length) throw new Error('Tiles.parse: "' + ch + '" without digits');
        digits.forEach(function (d) {
          if (ch === 'z') { if (d < 1 || d > 7) throw new Error('Tiles.parse: bad honour ' + d); out.push(26 + d); }
          else if (ch === 'f') { if (d < 1 || d > 4) throw new Error('Tiles.parse: bad flower ' + d); out.push(FLOWER0 + d - 1); }
          else { if (d < 1 || d > 4) throw new Error('Tiles.parse: bad season ' + d); out.push(SEASON0 + d - 1); }
        });
        digits = [];
        continue;
      }
      throw new Error('Tiles.parse: unexpected "' + ch + '" in "' + s + '"');
    }
    if (digits.length) throw new Error('Tiles.parse: trailing digits in "' + s + '"');
    return out;
  }

  /** Format kinds into compact notation, e.g. [0,1,2,27,27] -> "123m東東" (input order is sorted first). */
  function format(kinds) {
    var ks = sort(kinds);
    var out = '';
    var run = [];
    var runSuit = -1;
    function flush() { if (run.length) { out += run.join('') + SUIT_LETTERS[runSuit]; run = []; } }
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      if (isSuit(k)) {
        if (suitOf(k) !== runSuit) { flush(); runSuit = suitOf(k); }
        run.push(rankOf(k));
      } else { flush(); runSuit = -1; out += zh(k); }
    }
    flush();
    return out;
  }

  function sort(kinds) { return kinds.slice().sort(function (a, b) { return a - b; }); }

  /** The 144 physical tiles as kinds (4 of each playable kind + 8 bonus tiles). */
  function fullSet() {
    var a = [];
    for (var k = 0; k < PLAYABLE_KINDS; k++) for (var c = 0; c < 4; c++) a.push(k);
    for (var b = 34; b < ALL_KINDS; b++) a.push(b);
    return a;
  }

  /** Count array of length 34 (bonus kinds ignored). */
  function counts(kinds) {
    var c = new Array(PLAYABLE_KINDS);
    for (var i = 0; i < PLAYABLE_KINDS; i++) c[i] = 0;
    for (var j = 0; j < kinds.length; j++) if (kinds[j] < PLAYABLE_KINDS) c[kinds[j]]++;
    return c;
  }

  HKMJ.Tiles = {
    MAN: MAN, PIN: PIN, SOU: SOU,
    EAST: EAST, SOUTH: SOUTH, WEST: WEST, NORTH: NORTH,
    RED: RED, GREEN: GREEN, WHITE: WHITE,
    FLOWER0: FLOWER0, SEASON0: SEASON0,
    PLAYABLE_KINDS: PLAYABLE_KINDS, ALL_KINDS: ALL_KINDS,
    SUIT_LETTERS: SUIT_LETTERS, SUIT_NAMES: SUIT_NAMES, SUIT_ZH: SUIT_ZH, NUM_ZH: NUM_ZH,
    HONOUR_ZH: HONOUR_ZH, HONOUR_NAMES: HONOUR_NAMES,
    WIND_ZH: WIND_ZH, WIND_NAMES: WIND_NAMES, DRAGON_ZH: DRAGON_ZH, DRAGON_NAMES: DRAGON_NAMES,
    FLOWER_ZH: FLOWER_ZH, FLOWER_NAMES: FLOWER_NAMES, SEASON_ZH: SEASON_ZH, SEASON_NAMES: SEASON_NAMES,
    isSuit: isSuit, suitOf: suitOf, rankOf: rankOf, isHonour: isHonour, isWind: isWind, isDragon: isDragon,
    isBonus: isBonus, isFlower: isFlower, isSeason: isSeason, bonusNumber: bonusNumber,
    isTerminal: isTerminal, isTerminalOrHonour: isTerminalOrHonour,
    tileOf: tileOf, windKind: windKind, windIndex: windIndex, dragonIndex: dragonIndex,
    name: name, zh: zh, code: code, parse: parse, format: format, sort: sort, fullSet: fullSet, counts: counts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Tiles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
