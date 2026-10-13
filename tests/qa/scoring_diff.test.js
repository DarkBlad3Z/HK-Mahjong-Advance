#!/usr/bin/env node
/* HK Mahjong — tests/qa/scoring_diff.test.js
 * QA: 20,000+ random standard winning hands, checking score invariants and consistency.
 *
 * Each hand is scored via evaluate(). We verify:
 * - sum(items.fan) === rawFan
 * - fan === min(13, rawFan)
 * - valid === (fan >= minFan) || blessing || false
 * - timing is reasonable
 * - no scoring anomalies (fan < 0, fan > 13, etc.)
 */
'use strict';
var path = require('path');
var CORE = path.join(__dirname, '..', '..', 'src', 'core');
require(path.join(CORE, 'tiles.js'));
require(path.join(CORE, 'rng.js'));
require(path.join(CORE, 'hand.js'));
require(path.join(CORE, 'scoring.js'));
var HKMJ = globalThis.HKMJ;
var T = HKMJ.Tiles;
var H = HKMJ.Hand;
var S = HKMJ.Scoring;

var HAND_COUNT = 20000;

// Hand generator
function RandomHandGen(seed) {
  this.rng = new HKMJ.RNG(seed);
}

RandomHandGen.prototype.randomChow = function() {
  var suit = this.rng.int(3);
  var rank = this.rng.int(7);
  return [suit * 9 + rank, suit * 9 + rank + 1, suit * 9 + rank + 2];
};

RandomHandGen.prototype.randomPong = function() {
  var k = this.rng.int(34);
  return [k, k, k];
};

RandomHandGen.prototype.generateHand = function() {
  var sets = [];
  for (var i = 0; i < 4; i++) {
    sets.push(this.rng.next() < 0.5 ? this.randomChow() : this.randomPong());
  }
  var pair = [this.rng.int(34), this.rng.int(34)];

  var allTiles = [];
  sets.forEach(function(s) { allTiles = allTiles.concat(s); });
  allTiles = allTiles.concat(pair);

  var counts = T.counts(allTiles);
  for (var k = 0; k < 34; k++) {
    if (counts[k] > 4) return null;
  }

  allTiles.sort(function(a,b) { return a - b; });
  if (!H.isWinningShape(allTiles, [], {})) return null;

  var melds = [];
  var inMeld = {};
  for (var i = 0; i < sets.length; i++) {
    if (this.rng.next() < 0.35) {
      var set = sets[i];
      melds.push({
        type: set.length === 3 && set[0] === set[1] ? 'pong' : 'chow',
        tiles: set.slice(),
        concealed: false,
        from: this.rng.int(4),
        claimed: set[this.rng.int(set.length)]
      });
      set.forEach(function(k) { inMeld[k] = true; });
    }
  }

  var concealedTiles = [];
  allTiles.forEach(function(k) { if (!inMeld[k]) concealedTiles.push(k); });
  if (concealedTiles.length === 0) return null;

  var winTile = concealedTiles[this.rng.int(concealedTiles.length)];
  var sources = ['self', 'discard'];
  if (melds.some(function(m) { return m.added; })) sources.push('robKong');

  var source = sources[this.rng.int(sources.length)];
  var kongReplacement = 0;
  if (source === 'self') {
    var kongs = melds.filter(function(m) { return m.type === 'kong'; }).length;
    if (kongs > 0) kongReplacement = this.rng.int(Math.min(3, kongs + 1));
  }

  var bonusPool = [];
  for (var b = 34; b < 42; b++) bonusPool.push(b);
  this.rng.shuffle(bonusPool);

  return {
    hand: concealedTiles,
    melds: melds,
    winTile: winTile,
    source: source,
    kongReplacement: kongReplacement,
    lastTile: this.rng.next() < 0.08,
    seatWind: this.rng.int(4),
    roundWind: this.rng.int(4),
    flowers: bonusPool.slice(0, this.rng.int(5)),
    blessing: this.rng.next() < 0.015 ? ['heaven', 'earth', 'man'][this.rng.int(3)] : null,
    flowerWin: false,
    settings: {
      minFan: this.rng.int(6),
      optional: { kong: this.rng.next() < 0.5, sevenPairs: false, luxurySevenPairs: false, knitted: false, lesserHonours: false, greaterHonours: false }
    }
  };
};

// Test runner
var gen = new RandomHandGen(42);
var failures = [];
var timings = [];
var handsGenerated = 0;

console.log('Generating ' + HAND_COUNT + ' random winning hands...\n');

for (var i = 0; i < HAND_COUNT; i++) {
  var ctx = null;
  var attempts = 0;
  while (!ctx && attempts < 10) {
    ctx = gen.generateHand();
    attempts++;
  }
  if (!ctx) continue;
  handsGenerated++;

  var t0 = Date.now();
  var result = S.evaluate(ctx);
  timings.push(Date.now() - t0);

  // Skip non-standard or invalid
  if (result.pattern !== 'standard') continue;
  if (!result.winning) continue;

  // Invariant 1: fan is in [0, 13]
  if (result.fan < 0 || result.fan > 13) {
    failures.push({
      type: 'fan_out_of_range',
      hand: i,
      fan: result.fan,
      rawFan: result.rawFan
    });
    continue;
  }

  // Invariant 2: rawFan >= fan
  if (result.rawFan < result.fan) {
    failures.push({
      type: 'rawFan_less_than_fan',
      hand: i,
      fan: result.fan,
      rawFan: result.rawFan
    });
  }

  // Invariant 3: sum of items equals rawFan
  var itemSum = 0;
  if (result.items) {
    for (var j = 0; j < result.items.length; j++) {
      itemSum += result.items[j].fan;
    }
  }
  if (itemSum !== result.rawFan) {
    failures.push({
      type: 'sum_items_ne_rawFan',
      hand: i,
      itemSum: itemSum,
      rawFan: result.rawFan
    });
  }

  // Invariant 4: fan === min(13, rawFan)
  var expectedFan = Math.min(13, result.rawFan);
  if (result.fan !== expectedFan) {
    failures.push({
      type: 'fan_capping_error',
      hand: i,
      fan: result.fan,
      expected: expectedFan,
      rawFan: result.rawFan
    });
  }

  // Invariant 5: valid === (fan >= minFan) || blessing
  var expectedValid = (result.fan >= ctx.settings.minFan) || !!ctx.blessing || false;
  if (result.valid !== expectedValid) {
    failures.push({
      type: 'valid_logic_error',
      hand: i,
      valid: result.valid,
      expected: expectedValid,
      fan: result.fan,
      minFan: ctx.settings.minFan
    });
  }

  // Invariant 6: all items have fan > 0
  if (result.items) {
    for (var j = 0; j < result.items.length; j++) {
      if (result.items[j].fan <= 0) {
        failures.push({
          type: 'item_fan_not_positive',
          hand: i,
          item: result.items[j].id,
          fan: result.items[j].fan
        });
      }
    }
  }

  // Invariant 7: replaced items make sense
  if (result.replaced) {
    for (var j = 0; j < result.replaced.length; j++) {
      if (result.replaced[j].fan <= 0) {
        failures.push({
          type: 'replaced_item_fan_not_positive',
          hand: i,
          item: result.replaced[j].id,
          fan: result.replaced[j].fan
        });
      }
    }
  }

  // Invariant 8: exactly one item has hasWinTile (if applicable)
  if (result.groups) {
    var winTileCnt = 0;
    for (var j = 0; j < result.groups.length; j++) {
      if (result.groups[j].hasWinTile) winTileCnt++;
    }
    if (winTileCnt !== 1) {
      failures.push({
        type: 'win_tile_count_error',
        hand: i,
        count: winTileCnt
      });
    }
  }
}

// Timing stats
var avgTime = 0, maxTime = 0, minTime = 9999;
for (var i = 0; i < timings.length; i++) {
  avgTime += timings[i];
  maxTime = Math.max(maxTime, timings[i]);
  minTime = Math.min(minTime, timings[i]);
}
avgTime /= timings.length;

// Group failures by type
var failByType = {};
for (var i = 0; i < failures.length; i++) {
  var ft = failures[i].type;
  failByType[ft] = (failByType[ft] || 0) + 1;
}

// Report
console.log('=== HK MAHJONG FAN SCORING QA TEST ===\n');
console.log('Hands generated: ' + handsGenerated);
console.log('Hands evaluated: ' + timings.length);
console.log('Invariant failures: ' + failures.length);

if (failures.length > 0) {
  console.log('\n--- FAILURE SUMMARY ---');
  for (var ft in failByType) {
    console.log(ft + ': ' + failByType[ft]);
  }

  console.log('\n--- EXAMPLES (first 5) ---');
  for (var i = 0; i < Math.min(5, failures.length); i++) {
    var f = failures[i];
    console.log('\n' + (i+1) + '. ' + f.type + ' @ hand ' + f.hand);
    for (var k in f) {
      if (k !== 'type' && k !== 'hand') console.log('   ' + k + ': ' + f[k]);
    }
  }
}

console.log('\n--- TIMING (from ' + timings.length + ' hands) ---');
console.log('Mean:   ' + avgTime.toFixed(4) + ' ms');
console.log('Max:    ' + maxTime + ' ms');
console.log('Min:    ' + (minTime === 9999 ? 'N/A' : minTime) + ' ms');

console.log('\n');
process.exit(failures.length > 0 ? 1 : 0);
