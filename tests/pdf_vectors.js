/* HK Mahjong — tests/pdf_vectors.js
 * ACCEPTANCE TEST VECTORS derived from "HK Mahjong Scoring Sheet v1.0 (Sep 25, 2026)" (the booklet).
 * Owner: orchestrator. Do NOT edit expectations to make code pass. If you believe a vector contradicts the
 * booklet, report it — with the page reference — instead of changing it.
 *
 * Vector fields
 *   hand      concealed tiles INCLUDING the winning tile (notation, see core/tiles.js)
 *   melds     declared sets: 'chow 234s' | 'pong 5p' | 'kong 2s' (exposed Kong) | 'ckong 7p' (concealed Kong)
 *   win       the winning tile
 *   source    'self' | 'discard' | 'robKong'
 *   kongReplacement 0 | 1 | 2   (1 = won on a Kong replacement tile, 2 = after two Kongs in a row)
 *   lastTile  true = Moon Under The Sea situation (last wall tile / last discard)
 *   seat, round  'E' | 'S' | 'W' | 'N'
 *   blessing  'heaven' | 'earth' | 'man'
 *   flowers   bonus tiles held. OMITTED => the runner gives one NEUTRAL flower (not the seat's number) so that
 *             No Flowers / Seat Flower do not fire and the vector isolates the booklet's pattern Fan.
 *   flowerWin true => Seven/Eight Flowers instant win (hand ignored)
 *   opts      optional-rule overrides. Vector defaults: all † hands ON except Kong (the booklet's worked
 *             examples never add the † Kong Fan).
 *   minFan    default 3
 *   expect.fan       capped total (13 limit)
 *   expect.raw       uncapped total (checked only when given)
 *   expect.items     id -> summed Fan of counted items with that id
 *   expect.itemsExact default true: the set of counted ids must equal the keys of expect.items
 *   expect.absent    ids that must NOT be among the counted items
 *   expect.valid     legal win at minFan (checked only when given)
 *   expect.winning   winning shape exists (checked only when given; false => fan not checked)
 */
(function (root) {
  'use strict';
  var V = [];
  function v(o) { V.push(o); }

  // ---------------------------------------------------------------- Win Actions (p.2)
  v({ id: 'p2-kong-replacement', ref: 'p.2 Win by Kong Replacement: Mixed Flush 3 + Dragon 1 + Kong Replacement 2 = 6',
    hand: '345s 678s 99s', melds: ['kong 2s', 'pong 發'], win: '9s', source: 'self', kongReplacement: 1, seat: 'S', round: 'E',
    expect: { fan: 6, items: { mixedFlush: 3, dragon: 1, kongReplacement: 2 }, absent: ['selfPick'] } });
  v({ id: 'p2-kong-replacement-kong-on', ref: 'same hand with the † Kong option on: + open Kong 1',
    hand: '345s 678s 99s', melds: ['kong 2s', 'pong 發'], win: '9s', source: 'self', kongReplacement: 1, seat: 'S', round: 'E', opts: { kong: true },
    expect: { fan: 7, items: { mixedFlush: 3, dragon: 1, kongReplacement: 2, kong: 1 } } });
  v({ id: 'p2-double-kong', ref: 'p.2 Double Kong Replacement: Mixed Flush 3 + Dragon 1 + Double Kong 9 = 13',
    hand: '234p 99p', melds: ['kong 1p', 'ckong 7p', 'pong 中'], win: '9p', source: 'self', kongReplacement: 2, seat: 'S', round: 'E',
    expect: { fan: 13, raw: 13, items: { mixedFlush: 3, dragon: 1, doubleKong: 9 }, absent: ['selfPick', 'kongReplacement'] } });
  v({ id: 'p2-robbing-the-kong', ref: 'p.2 Robbing the Kong: Mixed Flush 3 + Dragon 2 + Robbing the Kong 1 = 6',
    hand: '234m 678m 55m', melds: ['pong 發', 'pong 中'], win: '7m', source: 'robKong', seat: 'S', round: 'E',
    expect: { fan: 6, items: { mixedFlush: 3, dragon: 2, robKong: 1 } } });
  v({ id: 'p2-concealed-discard', ref: 'p.2 Concealed Hand — winning on a discard still counts (Seven Pairs & All Triplets tables)',
    hand: '123m 456m 789p 西西西 99s', melds: [], win: '9s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 1, items: { concealed: 1 }, valid: false } });
  v({ id: 'p2-self-pick', ref: 'p.2 Self-Pick + Concealed Hand',
    hand: '123m 456m 789p 西西西 99s', melds: [], win: '9s', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 2, items: { concealed: 1, selfPick: 1 }, valid: false } });
  v({ id: 'p2-moon-self', ref: 'p.2 Moon Under The Sea — last tile in the wall',
    hand: '123m 456m 789p 西西西 99s', melds: [], win: '9s', source: 'self', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 3, items: { concealed: 1, selfPick: 1, moon: 1 }, valid: true } });
  v({ id: 'p2-moon-discard', ref: 'p.2 Moon Under The Sea — last discard',
    hand: '123m 456m 789p 西西西 99s', melds: [], win: '9s', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 2, items: { concealed: 1, moon: 1 } } });

  // ---------------------------------------------------------------- Hands by Set Type (p.3)
  v({ id: 'p3-all-sequences', ref: 'p.3 All Sequences 1 = 1 Fan — below a 3 Fan table minimum',
    hand: '234m 567m 345p 東東', melds: ['chow 678s'], win: '5p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 1, items: { allSequences: 1 }, valid: false } });
  v({ id: 'p3-all-sequences-concealed-self', ref: 'All Sequences + Concealed Hand + Self-Pick = 3',
    hand: '234m 567m 345p 678s 東東', melds: [], win: '5p', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 3, items: { allSequences: 1, concealed: 1, selfPick: 1 }, valid: true } });
  v({ id: 'p3-all-triplets', ref: 'p.3 All Triplets 3 = 3 Fan',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S',
    expect: { fan: 3, items: { allTriplets: 3 }, valid: true } });
  v({ id: 'p3-all-triplets-east-seat', ref: 'p.3 "or 4 Fan if 東 is your seat or the round wind"',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'E', round: 'S',
    expect: { fan: 4, items: { allTriplets: 3, seatWind: 1 } } });
  v({ id: 'p3-all-triplets-east-both', ref: 'p.5 one triplet that is both the round wind and your seat wind = 2 Fan',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'E', round: 'E',
    expect: { fan: 5, items: { allTriplets: 3, seatWind: 1, roundWind: 1 } } });
  v({ id: 'p3-all-concealed-triplets', ref: 'p.3 All Concealed Triplets 8 = 8 Fan (a discard completes the pair)',
    hand: '111p 888p 444s 北北北 99m', melds: [], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { allConcealedTriplets: 8 }, absent: ['allTriplets', 'concealed'] } });
  v({ id: 'p3-all-concealed-triplets-north', ref: 'p.3 "or 9 if 北 is your seat or the round wind"',
    hand: '111p 888p 444s 北北北 99m', melds: [], win: '9m', source: 'discard', seat: 'N', round: 'E',
    expect: { fan: 9, items: { allConcealedTriplets: 8, seatWind: 1 } } });
  v({ id: 'p3-act-downgrade', ref: 'p.3 claiming a discard to finish a triplet downgrades to All Triplets 3 (+ Concealed Hand 1 per the All Triplets table)',
    hand: '111p 888p 444s 北北北 99m', melds: [], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, concealed: 1 }, absent: ['allConcealedTriplets'] } });
  v({ id: 'p3-act-self', ref: 'All Concealed Triplets won by Self-Pick',
    hand: '111p 888p 444s 北北北 99m', melds: [], win: '北', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 9, items: { allConcealedTriplets: 8, selfPick: 1 } } });
  v({ id: 'p3-all-quadruplets', ref: 'p.3 All Quadruplets 13 = 13 Fan — the limit',
    hand: '77m', melds: ['kong 2m', 'kong 5p', 'kong 8s', 'kong 中'], win: '7m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { allQuadruplets: 13 }, itemsExact: false, absent: ['allTriplets'] } });
  v({ id: 'p3-all-quadruplets-kong-on', ref: 'p.6 Four Kongs is All Quadruplets 13, which replaces the † Kong score',
    hand: '77m', melds: ['kong 2m', 'kong 5p', 'ckong 8s', 'kong 中'], win: '7m', source: 'discard', seat: 'S', round: 'E', opts: { kong: true },
    expect: { fan: 13, items: { allQuadruplets: 13 }, itemsExact: false, absent: ['kong', 'allTriplets'] } });

  // ---------------------------------------------------------------- Hands by Tile Type (p.4-6)
  v({ id: 'p4-dragon-one', ref: 'p.4 One dragon triplet = 1 Fan',
    hand: '123m 456p 789s 55s', melds: ['pong 中'], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 1, items: { dragon: 1 } } });
  v({ id: 'p4-dragon-two', ref: 'p.4 Two = 2 Fan',
    hand: '123m 456p 55s', melds: ['pong 中', 'pong 發'], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 2, items: { dragon: 2 } } });
  v({ id: 'p4-small-three-dragons', ref: 'p.4 Small Three Dragons 5 + Mixed Flush 3 = 8 — per-triplet Dragon replaced',
    hand: '白白 123p 456p', melds: ['pong 中', 'pong 發'], win: '6p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { smallThreeDragons: 5, mixedFlush: 3 }, absent: ['dragon'] } });
  v({ id: 'p4-big-three-dragons', ref: 'p.4 Big Three Dragons 8 = 8 — two suits, so no Mixed Flush',
    hand: '123p 66m', melds: ['pong 中', 'pong 發', 'pong 白'], win: '6m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { bigThreeDragons: 8 }, absent: ['dragon', 'smallThreeDragons', 'mixedFlush'] } });
  v({ id: 'p5-seat-wind', ref: 'p.5 Seat Wind triplet 1',
    hand: '123m 456p 789s 55s', melds: ['pong 南'], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 1, items: { seatWind: 1 } } });
  v({ id: 'p5-round-wind', ref: 'p.5 Round Wind triplet 1',
    hand: '123m 456p 789s 55s', melds: ['pong 東'], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 1, items: { roundWind: 1 } } });
  v({ id: 'p5-seat-and-round', ref: 'p.5 one triplet that is both = 2 Fan',
    hand: '123m 456p 789s 55s', melds: ['pong 南'], win: '5s', source: 'discard', seat: 'S', round: 'S',
    expect: { fan: 2, items: { seatWind: 1, roundWind: 1 } } });
  v({ id: 'p5-other-wind', ref: 'p.5 a triplet of the other two winds scores nothing',
    hand: '123m 456p 789s 55s', melds: ['pong 西'], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 0, items: {}, valid: false } });
  v({ id: 'p5-small-four-winds', ref: 'p.5 Small Four Winds 6 + Mixed Flush 3 = 9 — Round/Seat Wind replaced',
    hand: '北北 234s', melds: ['pong 東', 'pong 南', 'pong 西'], win: '4s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 9, items: { smallFourWinds: 6, mixedFlush: 3 }, absent: ['seatWind', 'roundWind'] } });
  v({ id: 'p5-big-four-winds', ref: 'p.5 Big Four Winds 13 — the limit',
    hand: '55p', melds: ['pong 東', 'pong 南', 'pong 西', 'pong 北'], win: '5p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { bigFourWinds: 13 }, itemsExact: false, absent: ['seatWind', 'roundWind', 'smallFourWinds'] } });
  v({ id: 'p5-mixed-flush', ref: 'p.5 Mixed Flush 3 + Dragon 1 = 4 — the 東 pair scores nothing',
    hand: '123m 456m 789m 東東', melds: ['pong 中'], win: '9m', source: 'discard', seat: 'E', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, dragon: 1 } } });
  v({ id: 'p5-full-flush', ref: 'p.5 Full Flush 7 = 7 — Mixed Flush 3 is replaced',
    hand: '111s 456s 789s 99s', melds: ['chow 234s'], win: '9s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 7, items: { fullFlush: 7 }, absent: ['mixedFlush'] } });
  v({ id: 'p6-mixed-terminals', ref: 'p.6 Mixed Terminals 4 + Dragon 1 = 5 — All Triplets 3 is inside the 4',
    hand: '111s 東東', melds: ['pong 1m', 'pong 9p', 'pong 中'], win: '東', source: 'discard', seat: 'S', round: 'S',
    expect: { fan: 5, items: { mixedTerminals: 4, dragon: 1 }, absent: ['allTriplets'] } });
  v({ id: 'p6-all-terminals', ref: 'p.6 All Terminals 13 — Mixed Terminals and All Triplets replaced',
    hand: '999s 11s', melds: ['pong 1m', 'pong 9m', 'pong 1p'], win: '1s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { allTerminals: 13 }, itemsExact: false, absent: ['mixedTerminals', 'allTriplets'] } });
  v({ id: 'p6-all-honours', ref: 'p.6 All Honours 10 + Small Three Dragons 5 = 15, capped at 13',
    hand: '白白', melds: ['pong 東', 'pong 南', 'pong 中', 'pong 發'], win: '白', source: 'discard', seat: 'W', round: 'W',
    expect: { fan: 13, raw: 15, items: { allHonours: 10, smallThreeDragons: 5 }, absent: ['mixedFlush', 'mixedTerminals', 'allTriplets'] } });
  v({ id: 'p6-kong-open', ref: 'p.6 † Kong: open — 1 Fan each',
    hand: '123m 456p 55s', melds: ['kong 7s', 'pong 中'], win: '5s', source: 'discard', seat: 'S', round: 'E', opts: { kong: true },
    expect: { fan: 2, items: { dragon: 1, kong: 1 } } });
  v({ id: 'p6-kong-concealed', ref: 'p.6 † Kong: concealed — 2 Fan each (a concealed Kong keeps the hand concealed)',
    hand: '123m 456p 55s 中中中', melds: ['ckong 7s'], win: '5s', source: 'discard', seat: 'S', round: 'E', opts: { kong: true },
    expect: { fan: 4, items: { dragon: 1, kong: 2, concealed: 1 } } });
  v({ id: 'p6-kong-off', ref: '† Kong option off: a Kong scores nothing by itself',
    hand: '123m 456p 55s', melds: ['kong 7s', 'pong 中'], win: '5s', source: 'discard', seat: 'S', round: 'E', opts: { kong: false },
    expect: { fan: 1, items: { dragon: 1 } } });

  // ---------------------------------------------------------------- Special Hands (p.7-9)
  v({ id: 'p7-seven-pairs', ref: 'p.7 Seven Pairs 4 = 4 Fan alone — Concealed Hand is built in',
    hand: '22m 55m 88m 33p 66p 44s 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { sevenPairs: 4 }, absent: ['concealed'], valid: true } });
  v({ id: 'p7-seven-pairs-mixed-flush', ref: 'p.7 + Mixed Flush 3 = 7',
    hand: '22m 55m 77m 99m 東東 南南 中中', melds: [], win: '中', source: 'discard', seat: 'W', round: 'W',
    expect: { fan: 7, items: { sevenPairs: 4, mixedFlush: 3 } } });
  v({ id: 'p7-seven-pairs-full-flush', ref: 'p.7 + Full Flush 7 = 11',
    hand: '11m 22m 44m 55m 66m 88m 99m', melds: [], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 11, items: { sevenPairs: 4, fullFlush: 7 } } });
  v({ id: 'p7-seven-pairs-all-honours', ref: 'p.7 + All Honours 10 = 14, capped at 13',
    hand: '東東 南南 西西 北北 中中 發發 白白', melds: [], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 14, items: { sevenPairs: 4, allHonours: 10 } } });
  v({ id: 'p7-luxury-seven-pairs', ref: 'p.7 Seven Pairs 4 + Luxury 2 = 6 — an honour quad adds no Dragon Fan',
    hand: '中中中中 55m 88m 11p 55p 33s', melds: [], win: '3s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 6, items: { sevenPairs: 4, luxurySevenPairs: 2 }, absent: ['dragon'] } });
  v({ id: 'p7-luxury-disabled', ref: 'with † Luxury Seven Pairs off, four identical tiles cannot stand as two pairs',
    hand: '中中中中 55m 88m 11p 55p 33s', melds: [], win: '3s', source: 'discard', seat: 'S', round: 'E', opts: { luxurySevenPairs: false },
    expect: { winning: false } });
  v({ id: 'p7-seven-pairs-disabled', ref: 'with † Seven Pairs off, seven pairs is not a winning hand',
    hand: '22m 55m 88m 33p 66p 44s 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E', opts: { sevenPairs: false },
    expect: { winning: false } });
  v({ id: 'p7-knitted-claimed', ref: 'p.7 Knitted Tiles 5 = 5 — the ordinary set was Chowed; 中中 scores nothing',
    hand: '147m 258p 369s 中中', melds: ['chow 234s'], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 5, items: { knitted: 5 } } });
  v({ id: 'p7-knitted-concealed', ref: 'p.7 "Concealed adds 1"',
    hand: '147m 258p 369s 234s 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 6, items: { knitted: 5, concealed: 1 } } });
  v({ id: 'p7-knitted-dragon-set', ref: 'Knitted Tiles whose ordinary set is a dragon triplet also scores Dragon (sum of features)',
    hand: '147m 258p 369s 發發發 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 7, items: { knitted: 5, dragon: 1, concealed: 1 } } });
  v({ id: 'p7-knitted-disabled', ref: '† Knitted Tiles off',
    hand: '147m 258p 369s 中中', melds: ['chow 234s'], win: '中', source: 'discard', seat: 'S', round: 'E', opts: { knitted: false },
    expect: { winning: false } });
  v({ id: 'p8-lesser-honours-9-5', ref: 'p.8 Lesser Honours 8 = 8 (9 knitted + 5 honours) — Concealed Hand built in',
    hand: '147m 258p 369s 東南西北白', melds: [], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { lesserHonours: 8 }, absent: ['concealed'] } });
  v({ id: 'p8-lesser-honours-8-6-self', ref: 'p.8 8 knitted + 6 honours; Self-Pick still adds',
    hand: '147s 258m 36p 東南西北中發', melds: [], win: '發', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 9, items: { lesserHonours: 8, selfPick: 1 } } });
  v({ id: 'p8-greater-honours', ref: 'p.8 Greater Honours 10 = 10',
    hand: '147m 258p 3s 東南西北中發白', melds: [], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 10, items: { greaterHonours: 10 }, absent: ['concealed', 'lesserHonours'] } });
  v({ id: 'p8-greater-honours-self', ref: 'p.8 Self-Pick still adds',
    hand: '147m 258p 3s 東南西北中發白', melds: [], win: '白', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 11, items: { greaterHonours: 10, selfPick: 1 } } });
  v({ id: 'p8-greater-honours-disabled', ref: 'with † Greater Honours off, 7 knitted + 7 honours is not Lesser Honours either (only 9+5 or 8+6)',
    hand: '147m 258p 3s 東南西北中發白', melds: [], win: '白', source: 'discard', seat: 'S', round: 'E', opts: { greaterHonours: false },
    expect: { winning: false } });
  v({ id: 'p8-lesser-honours-disabled', ref: '† Lesser Honours off',
    hand: '147m 258p 369s 東南西北白', melds: [], win: '白', source: 'discard', seat: 'S', round: 'E', opts: { lesserHonours: false },
    expect: { winning: false } });
  v({ id: 'p8-thirteen-orphans', ref: 'p.8 Thirteen Orphans 13',
    hand: '19m 19p 19s 東南西北中發白 1m', melds: [], win: '1m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { thirteenOrphans: 13 }, itemsExact: false } });
  v({ id: 'p8-nine-gates', ref: 'p.8 Nine Gates 13',
    hand: '1112345678999s 5s', melds: [], win: '5s', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { nineGates: 13 }, itemsExact: false } });
  v({ id: 'p8-nine-gates-on-1', ref: 'p.8 the winning tile can be any 1 to 9 of that suit',
    hand: '1112345678999s 1s', melds: [], win: '1s', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 13, items: { nineGates: 13 }, itemsExact: false } });
  v({ id: 'p8-heaven', ref: 'p.8 Blessing of Heaven 13',
    hand: '123p 456p 789p 發發發 東東', melds: [], win: '東', source: 'self', blessing: 'heaven', seat: 'E', round: 'E',
    expect: { fan: 13, items: { heaven: 13 }, itemsExact: false, valid: true } });
  v({ id: 'p9-earth-chicken', ref: 'p.9 Blessing of Earth 13 — the pattern needs no Fan of its own',
    hand: '234s 567s 345m 678m 白白', melds: [], win: '白', source: 'discard', blessing: 'earth', seat: 'S', round: 'E',
    expect: { fan: 13, items: { earth: 13 }, itemsExact: false, valid: true } });
  v({ id: 'p9-man-chicken', ref: 'p.9 Blessing of Man 13',
    hand: '123m 456p 789p 345s 88m', melds: [], win: '8m', source: 'self', blessing: 'man', seat: 'W', round: 'E',
    expect: { fan: 13, items: { man: 13 }, itemsExact: false, valid: true } });
  v({ id: 'chicken-min0', ref: 'p.12 Chicken (0 Fan) hand — legal only when the table minimum is 0',
    hand: '123m 456p 西西西 55m', melds: ['chow 789s'], win: '5m', source: 'discard', seat: 'S', round: 'E', minFan: 0,
    expect: { fan: 0, items: {}, valid: true } });
  v({ id: 'chicken-min1', ref: 'the same hand is not a legal win at a 1 Fan minimum',
    hand: '123m 456p 西西西 55m', melds: ['chow 789s'], win: '5m', source: 'discard', seat: 'S', round: 'E', minFan: 1,
    expect: { fan: 0, items: {}, valid: false } });

  // ---------------------------------------------------------------- Bonus Tiles (p.9) — flowers given explicitly
  v({ id: 'p9-no-flowers', ref: 'p.9 No Flowers or Seasons 1',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S', flowers: '',
    expect: { fan: 4, items: { allTriplets: 3, noFlowers: 1 } } });
  v({ id: 'p9-seat-flower-and-season', ref: 'p.9 1 Fan for each flower or season matching your seat number (South = 2)',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S', flowers: '梅蘭夏',
    expect: { fan: 5, items: { allTriplets: 3, seatFlower: 2 } } });
  v({ id: 'p9-all-flowers', ref: 'p.9 All Flowers 2 — plus the matching Seat Flower 1 (features sum)',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S', flowers: '梅蘭菊竹',
    expect: { fan: 6, items: { allTriplets: 3, allFlowers: 2, seatFlower: 1 } } });
  v({ id: 'p9-all-seasons', ref: 'p.9 All Seasons 2 — plus the matching Seat Season 1',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S', flowers: '春夏秋冬',
    expect: { fan: 6, items: { allTriplets: 3, allSeasons: 2, seatFlower: 1 } } });
  v({ id: 'p9-mixed-four-bonus', ref: 'p.9 a mix of four bonus tiles from both groups does not count',
    hand: '東東東 33m', melds: ['pong 1m', 'pong 5p', 'pong 8s'], win: '3m', source: 'discard', seat: 'S', round: 'S', flowers: '梅菊春秋',
    expect: { fan: 3, items: { allTriplets: 3 } } });
  v({ id: 'p9-seven-flowers', ref: 'p.9 Seven Flowers 3 — win at once, no matter what the hand holds',
    flowerWin: true, flowers: '梅蘭菊竹春夏秋', seat: 'S', round: 'E',
    expect: { fan: 3, items: { sevenFlowers: 3 }, valid: true } });
  v({ id: 'p9-eight-flowers', ref: 'p.9 Eight Flowers 8',
    flowerWin: true, flowers: '梅蘭菊竹春夏秋冬', seat: 'S', round: 'E',
    expect: { fan: 8, items: { eightFlowers: 8 }, valid: true } });

  // ---------------------------------------------------------------- Fan Combinations: Mixed Flush (p.13)
  v({ id: 'c-mf-all-sequences', ref: 'p.13 Mixed Flush + All Sequences = 4',
    hand: '456m 789m 234m 西西', melds: ['chow 123m'], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, allSequences: 1 } } });
  v({ id: 'c-mf-all-triplets', ref: 'p.13 Mixed Flush + All Triplets = 6',
    hand: '555m 999m 北北', melds: ['pong 1m', 'pong 西'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 6, items: { mixedFlush: 3, allTriplets: 3 } } });
  v({ id: 'c-mf-act', ref: 'p.13 Mixed Flush + All Concealed Triplets = 11',
    hand: '111m 555m 777m 西西西 北北', melds: [], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 11, items: { mixedFlush: 3, allConcealedTriplets: 8 } } });
  v({ id: 'c-mf-aq', ref: 'p.13 Mixed Flush + All Quadruplets = 13 (limit)',
    hand: '北北', melds: ['kong 2m', 'kong 5m', 'kong 7m', 'kong 西'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { allQuadruplets: 13, mixedFlush: 3 }, itemsExact: false } });
  v({ id: 'c-mf-seven-pairs', ref: 'p.13 Mixed Flush + Seven Pairs = 7',
    hand: '22m 55m 77m 99m 西西 北北 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 7, items: { sevenPairs: 4, mixedFlush: 3 } } });
  v({ id: 'c-mf-luxury', ref: 'p.13 Mixed Flush + Luxury Seven Pairs = 9',
    hand: '2222m 55m 77m 西西 北北 中中', melds: [], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 9, items: { sevenPairs: 4, luxurySevenPairs: 2, mixedFlush: 3 } } });
  v({ id: 'c-mf-mixed-terminals', ref: 'p.13 Mixed Flush + Mixed Terminals (All Triplets 3 is inside) = 7',
    hand: '西西西 中中', melds: ['pong 1m', 'pong 9m', 'pong 北'], win: '中', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 7, items: { mixedFlush: 3, mixedTerminals: 4 }, absent: ['allTriplets'] } });
  v({ id: 'c-mf-full-flush', ref: 'p.13 Full Flush replaces, does not add = 7',
    hand: '456m 789m 555m 99m', melds: ['chow 123m'], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 7, items: { fullFlush: 7 }, absent: ['mixedFlush'] } });
  v({ id: 'c-mf-dragon', ref: 'p.13 Mixed Flush + Dragon = 4',
    hand: '456m 789m 西西', melds: ['chow 123m', 'pong 中'], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, dragon: 1 } } });
  v({ id: 'c-mf-seat-wind', ref: 'p.13 Mixed Flush + Round/Seat Wind = 4',
    hand: '456m 789m 西西', melds: ['chow 123m', 'pong 南'], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, seatWind: 1 } } });
  v({ id: 'c-mf-s3d', ref: 'p.13 Mixed Flush + Small Three Dragons = 8',
    hand: '白白 456m', melds: ['pong 中', 'pong 發', 'chow 123m'], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { mixedFlush: 3, smallThreeDragons: 5 } } });
  v({ id: 'c-mf-b3d', ref: 'p.13 Mixed Flush + Big Three Dragons = 11',
    hand: '55m', melds: ['pong 中', 'pong 發', 'pong 白', 'chow 123m'], win: '5m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 11, items: { mixedFlush: 3, bigThreeDragons: 8 } } });
  v({ id: 'c-mf-b4w', ref: 'p.13 Mixed Flush + Big Four Winds = 13 (limit)',
    hand: '55m', melds: ['pong 東', 'pong 南', 'pong 西', 'pong 北'], win: '5m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { bigFourWinds: 13 }, itemsExact: false } });
  v({ id: 'c-mf-self-pick', ref: 'p.13 Mixed Flush + Self-Pick = 4',
    hand: '456m 789m 222m 西西', melds: ['chow 123m'], win: '西', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, selfPick: 1 } } });
  v({ id: 'c-mf-concealed', ref: 'p.13 Mixed Flush + Concealed Hand = 4',
    hand: '123m 456m 789m 222m 西西', melds: [], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, concealed: 1 } } });
  v({ id: 'c-mf-kong-replacement', ref: 'p.13 Mixed Flush + Win by Kong Replacement = 5',
    hand: '123m 789m 西西西 北北', melds: ['kong 5m'], win: '北', source: 'self', kongReplacement: 1, seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedFlush: 3, kongReplacement: 2 }, absent: ['selfPick'] } });
  v({ id: 'c-mf-double-kong', ref: 'p.13 Mixed Flush + Double Kong Replacement = 12',
    hand: '123m 789m 北北', melds: ['kong 5m', 'ckong 西'], win: '北', source: 'self', kongReplacement: 2, seat: 'S', round: 'E',
    expect: { fan: 12, items: { mixedFlush: 3, doubleKong: 9 }, absent: ['selfPick', 'kongReplacement'] } });
  v({ id: 'c-mf-robbing', ref: 'p.13 Mixed Flush + Robbing the Kong (the robbed tile joins a sequence) = 4',
    hand: '123m 456m 789m 北北', melds: ['pong 西'], win: '6m', source: 'robKong', seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, robKong: 1 } } });
  v({ id: 'c-mf-moon', ref: 'p.13 Mixed Flush + Moon Under The Sea = 4',
    hand: '456m 789m 222m 西西', melds: ['chow 123m'], win: '西', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 4, items: { mixedFlush: 3, moon: 1 } } });

  // ---------------------------------------------------------------- Fan Combinations: Full Flush (p.13)
  v({ id: 'c-ff-all-sequences', ref: 'p.13 Full Flush + All Sequences = 8',
    hand: '456m 789m 234m 55m', melds: ['chow 123m'], win: '5m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { fullFlush: 7, allSequences: 1 } } });
  v({ id: 'c-ff-all-triplets', ref: 'p.13 Full Flush + All Triplets = 10',
    hand: '555m 777m 99m', melds: ['pong 1m', 'pong 3m'], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 10, items: { fullFlush: 7, allTriplets: 3 } } });
  v({ id: 'c-ff-act', ref: 'p.13 Full Flush + All Concealed Triplets = 13 (limit)',
    hand: '111m 333m 555m 777m 99m', melds: [], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 15, items: { fullFlush: 7, allConcealedTriplets: 8 } } });
  v({ id: 'c-ff-luxury', ref: 'p.13 Full Flush + Luxury Seven Pairs = 13',
    hand: '1111m 22m 33m 55m 77m 99m', melds: [], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 13, items: { fullFlush: 7, sevenPairs: 4, luxurySevenPairs: 2 } } });
  v({ id: 'c-ff-self-pick', ref: 'p.13 Full Flush + Self-Pick = 8',
    hand: '456m 789m 555m 99m', melds: ['chow 123m'], win: '9m', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 8, items: { fullFlush: 7, selfPick: 1 } } });
  v({ id: 'c-ff-concealed', ref: 'p.13 Full Flush + Concealed Hand = 8',
    hand: '123m 456m 789m 555m 99m', melds: [], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { fullFlush: 7, concealed: 1 } } });
  v({ id: 'c-ff-kong-replacement', ref: 'p.13 Full Flush + Win by Kong Replacement = 9',
    hand: '123m 789m 555m 99m', melds: ['kong 4m'], win: '9m', source: 'self', kongReplacement: 1, seat: 'S', round: 'E',
    expect: { fan: 9, items: { fullFlush: 7, kongReplacement: 2 } } });
  v({ id: 'c-ff-double-kong', ref: 'p.13 Full Flush + Double Kong Replacement = 13 (limit)',
    hand: '123m 789m 99m', melds: ['kong 4m', 'ckong 6m'], win: '9m', source: 'self', kongReplacement: 2, seat: 'S', round: 'E',
    expect: { fan: 13, raw: 16, items: { fullFlush: 7, doubleKong: 9 } } });
  v({ id: 'c-ff-robbing', ref: 'p.13 Full Flush + Robbing the Kong = 8',
    hand: '123m 456m 789m 99m', melds: ['pong 5m'], win: '6m', source: 'robKong', seat: 'S', round: 'E',
    expect: { fan: 8, items: { fullFlush: 7, robKong: 1 } } });
  v({ id: 'c-ff-moon', ref: 'p.13 Full Flush + Moon Under The Sea = 8',
    hand: '456m 789m 555m 99m', melds: ['chow 123m'], win: '9m', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 8, items: { fullFlush: 7, moon: 1 } } });

  // ---------------------------------------------------------------- Fan Combinations: All Triplets (p.14)
  v({ id: 'c-at-act', ref: 'p.14 All Concealed Triplets replaces All Triplets = 8',
    hand: '222m 555p 888s 西西西 33m', melds: [], win: '3m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { allConcealedTriplets: 8 }, absent: ['allTriplets', 'concealed'] } });
  v({ id: 'c-at-dragon', ref: 'p.14 All Triplets + Dragon = 4',
    hand: '888s 33m', melds: ['pong 2m', 'pong 5p', 'pong 中'], win: '3m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, dragon: 1 } } });
  v({ id: 'c-at-seat-wind', ref: 'p.14 All Triplets + Round/Seat Wind = 4',
    hand: '888s 33m', melds: ['pong 2m', 'pong 5p', 'pong 南'], win: '3m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, seatWind: 1 } } });
  v({ id: 'c-at-s3d', ref: 'p.14 All Triplets + Small Three Dragons = 8',
    hand: '白白 555p', melds: ['pong 中', 'pong 發', 'pong 2m'], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 8, items: { allTriplets: 3, smallThreeDragons: 5 } } });
  v({ id: 'c-at-b3d', ref: 'p.14 All Triplets + Big Three Dragons = 11',
    hand: '55p', melds: ['pong 中', 'pong 發', 'pong 白', 'pong 2m'], win: '5p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 11, items: { allTriplets: 3, bigThreeDragons: 8 } } });
  v({ id: 'c-at-s4w-mf', ref: 'p.14 All Triplets + Small Four Winds (9 pairwise); a real hand also has Mixed Flush 3 -> 12',
    hand: '北北 222m', melds: ['pong 東', 'pong 南', 'pong 西'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 12, items: { allTriplets: 3, smallFourWinds: 6, mixedFlush: 3 } } });
  v({ id: 'c-at-self-pick', ref: 'p.14 All Triplets + Self-Pick = 4',
    hand: '888s 33m', melds: ['pong 2m', 'pong 5p', 'pong 西'], win: '3m', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, selfPick: 1 } } });
  v({ id: 'c-at-concealed', ref: 'p.14 All Triplets + Concealed Hand = 4 (the winning discard completes a triplet)',
    hand: '222m 555p 888s 西西西 33m', melds: [], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, concealed: 1 } } });
  v({ id: 'c-at-kong-replacement', ref: 'p.14 All Triplets + Win by Kong Replacement = 5',
    hand: '888s 西西西 33m', melds: ['kong 2m', 'pong 5p'], win: '3m', source: 'self', kongReplacement: 1, seat: 'S', round: 'E',
    expect: { fan: 5, items: { allTriplets: 3, kongReplacement: 2 } } });
  v({ id: 'c-at-double-kong', ref: 'p.14 All Triplets + Double Kong Replacement = 12',
    hand: '888s 西西西 33m', melds: ['kong 2m', 'ckong 5p'], win: '3m', source: 'self', kongReplacement: 2, seat: 'S', round: 'E',
    expect: { fan: 12, items: { allTriplets: 3, doubleKong: 9 } } });
  v({ id: 'c-at-moon', ref: 'p.14 All Triplets + Moon Under The Sea = 4',
    hand: '888s 33m', melds: ['pong 2m', 'pong 5p', 'pong 西'], win: '3m', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, moon: 1 } } });

  // ---------------------------------------------------------------- Fan Combinations: Mixed Terminals (p.14)
  v({ id: 'c-mt-act', ref: 'p.14 Mixed Terminals + All Concealed Triplets (replaces All Triplets) = 9',
    hand: '111m 999p 111s 西西西 北北', melds: [], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 9, items: { allConcealedTriplets: 8, mixedTerminals: 1 } } });
  v({ id: 'c-mt-aq', ref: 'p.14 Mixed Terminals + All Quadruplets = 13 (limit)',
    hand: '北北', melds: ['kong 1m', 'kong 9p', 'kong 1s', 'kong 西'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { allQuadruplets: 13 }, itemsExact: false } });
  v({ id: 'c-mt-seat-wind', ref: 'p.14 Mixed Terminals + Round/Seat Wind = 5',
    hand: '111s 北北', melds: ['pong 1m', 'pong 9p', 'pong 南'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedTerminals: 4, seatWind: 1 } } });
  v({ id: 'c-mt-s3d', ref: 'p.14 Mixed Terminals + Small Three Dragons = 9',
    hand: '白白 999p', melds: ['pong 中', 'pong 發', 'pong 1m'], win: '白', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 9, items: { mixedTerminals: 4, smallThreeDragons: 5 } } });
  v({ id: 'c-mt-b3d', ref: 'p.14 Mixed Terminals + Big Three Dragons = 12',
    hand: '99p', melds: ['pong 中', 'pong 發', 'pong 白', 'pong 1m'], win: '9p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 12, items: { mixedTerminals: 4, bigThreeDragons: 8 } } });
  v({ id: 'c-mt-s4w-mf', ref: 'p.14 Mixed Terminals + Small Four Winds (10 pairwise); a real hand also has Mixed Flush 3 -> 13',
    hand: '北北 111m', melds: ['pong 東', 'pong 南', 'pong 西'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 13, items: { mixedTerminals: 4, smallFourWinds: 6, mixedFlush: 3 } } });
  v({ id: 'c-mt-b4w', ref: 'p.14 Mixed Terminals + Big Four Winds (the pair carries the 1 or 9) = 13',
    hand: '11m', melds: ['pong 東', 'pong 南', 'pong 西', 'pong 北'], win: '1m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { bigFourWinds: 13 }, itemsExact: false } });
  v({ id: 'c-mt-self-pick', ref: 'p.14 Mixed Terminals + Self-Pick = 5',
    hand: '111s 北北', melds: ['pong 1m', 'pong 9p', 'pong 西'], win: '北', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedTerminals: 4, selfPick: 1 } } });
  v({ id: 'c-mt-concealed', ref: 'p.14 Mixed Terminals + Concealed Hand = 5',
    hand: '111m 999p 111s 西西西 北北', melds: [], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedTerminals: 4, concealed: 1 } } });
  v({ id: 'c-mt-kong-replacement', ref: 'p.14 Mixed Terminals + Win by Kong Replacement = 6',
    hand: '111s 西西西 北北', melds: ['kong 1m', 'pong 9p'], win: '北', source: 'self', kongReplacement: 1, seat: 'S', round: 'E',
    expect: { fan: 6, items: { mixedTerminals: 4, kongReplacement: 2 } } });
  v({ id: 'c-mt-double-kong', ref: 'p.14 Mixed Terminals + Double Kong Replacement = 13',
    hand: '111s 西西西 北北', melds: ['kong 1m', 'ckong 9p'], win: '北', source: 'self', kongReplacement: 2, seat: 'S', round: 'E',
    expect: { fan: 13, raw: 13, items: { mixedTerminals: 4, doubleKong: 9 } } });
  v({ id: 'c-mt-moon', ref: 'p.14 Mixed Terminals + Moon Under The Sea = 5',
    hand: '111s 北北', melds: ['pong 1m', 'pong 9p', 'pong 西'], win: '北', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedTerminals: 4, moon: 1 } } });

  // ---------------------------------------------------------------- Fan Combinations: Seven Pairs (p.14)
  v({ id: 'c-7p-self-pick', ref: 'p.14 Seven Pairs + Self-Pick = 5',
    hand: '22m 55m 88m 33p 66p 44s 中中', melds: [], win: '中', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 5, items: { sevenPairs: 4, selfPick: 1 } } });
  v({ id: 'c-7p-moon', ref: 'p.14 Seven Pairs + Moon Under The Sea = 5',
    hand: '22m 55m 88m 33p 66p 44s 中中', melds: [], win: '中', source: 'discard', lastTile: true, seat: 'S', round: 'E',
    expect: { fan: 5, items: { sevenPairs: 4, moon: 1 } } });
  v({ id: 'c-7p-terminal-pairs', ref: 'p.7 Seven Pairs stacks only with Mixed Flush, Full Flush and All Honours (Mixed Terminals is a triplet hand)',
    hand: '11m 99m 11p 99p 東東 南南 中中', melds: [], win: '中', source: 'discard', seat: 'W', round: 'W',
    expect: { fan: 4, items: { sevenPairs: 4 }, absent: ['mixedTerminals'] } });

  // ---------------------------------------------------------------- Fan Combinations: All Honours (p.15)
  v({ id: 'c-ah-dragon', ref: 'p.15 All Honours + Dragon = 11',
    hand: '發發', melds: ['pong 東', 'pong 西', 'pong 北', 'pong 中'], win: '發', source: 'discard', seat: 'S', round: 'S',
    expect: { fan: 11, items: { allHonours: 10, dragon: 1 } } });
  v({ id: 'c-ah-act', ref: 'p.15 All Honours + All Concealed Triplets = 13 (limit)',
    hand: '東東東 西西西 北北北 中中中 發發', melds: [], win: '發', source: 'discard', seat: 'S', round: 'S',
    expect: { fan: 13, raw: 16, items: { allConcealedTriplets: 8, allHonours: 7, dragon: 1 } } });
  v({ id: 'c-ah-self-pick', ref: 'p.15 All Honours + Self-Pick (11 pairwise) + Dragon 1 -> 12',
    hand: '發發', melds: ['pong 東', 'pong 西', 'pong 北', 'pong 中'], win: '發', source: 'self', seat: 'S', round: 'S',
    expect: { fan: 12, items: { allHonours: 10, dragon: 1, selfPick: 1 } } });
  v({ id: 'c-ah-kong-replacement', ref: 'p.15 All Honours + Win by Kong Replacement (12 pairwise) + Dragon 1 -> 13',
    hand: '發發', melds: ['kong 東', 'pong 西', 'pong 北', 'pong 中'], win: '發', source: 'self', kongReplacement: 1, seat: 'S', round: 'S',
    expect: { fan: 13, raw: 13, items: { allHonours: 10, dragon: 1, kongReplacement: 2 } } });
  v({ id: 'c-ah-moon', ref: 'p.15 All Honours + Moon Under The Sea (11 pairwise) + Dragon 1 -> 12',
    hand: '發發', melds: ['pong 東', 'pong 西', 'pong 北', 'pong 中'], win: '發', source: 'discard', lastTile: true, seat: 'S', round: 'S',
    expect: { fan: 12, items: { allHonours: 10, dragon: 1, moon: 1 } } });

  // Remaining combination-table cells (pp.13-15), added when the Rules tab gained the full tables
  v({ id: 'c-mf-s4w', ref: 'p.13 Mixed Flush + Small Four Winds (replaces Round / Seat Wind) = 9',
    hand: '123m 西西西 北北', melds: ['pong 東', 'pong 南'], win: '北', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 9, items: { mixedFlush: 3, smallFourWinds: 6 }, absent: ['roundWind', 'seatWind'] } });
  v({ id: 'c-ff-aq', ref: 'p.13 Full Flush + All Quadruplets (replaces All Triplets) = 20, held at 13',
    hand: '99m', melds: ['kong 1m', 'kong 2m', 'kong 3m', 'kong 5m'], win: '9m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 20, items: { fullFlush: 7, allQuadruplets: 13 }, absent: ['allTriplets'] } });
  v({ id: 'c-at-aq', ref: 'p.14 All Quadruplets replaces All Triplets = 13',
    hand: '西西', melds: ['kong 2m', 'kong 5p', 'kong 8s', 'kong 3m'], win: '西', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 13, items: { allQuadruplets: 13 }, absent: ['allTriplets'] } });
  v({ id: 'c-at-b4w', ref: 'p.14 All Triplets + Big Four Winds (the limit on its own) = 13',
    hand: '北北北 55m', melds: ['pong 東', 'pong 南', 'pong 西'], win: '5m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, items: { bigFourWinds: 13 }, itemsExact: false, absent: ['roundWind', 'seatWind'] } });
  v({ id: 'c-mt-dragon', ref: 'p.14 Mixed Terminals + Dragon = 5',
    hand: '999s 中中中 11p', melds: ['pong 1m', 'pong 9p'], win: '1p', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 5, items: { mixedTerminals: 4, dragon: 1 }, absent: ['allTriplets'] } });
  v({ id: 'c-ah-concealed', ref: 'p.15 All Honours + Concealed Hand (11 pairwise) + Dragon 1 -> 12; the discard completes a triplet, so no All Concealed Triplets',
    hand: '南南南 西西西 北北北 中中中 白白', melds: [], win: '中', source: 'discard', seat: 'E', round: 'E',
    expect: { fan: 12, items: { allHonours: 10, dragon: 1, concealed: 1 }, absent: ['allConcealedTriplets'] } });
  v({ id: 'c-ah-luxury', ref: 'p.15 All Honours + Luxury Seven Pairs = 16, held at 13 (an honour quad adds no Wind Fan)',
    hand: '東東東東 南南 西西 北北 中中 發發', melds: [], win: '發', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 13, raw: 16, items: { sevenPairs: 4, luxurySevenPairs: 2, allHonours: 10 }, absent: ['concealed', 'roundWind'] } });
  v({ id: 'c-ah-s3d', ref: 'p.15 All Honours + Small Three Dragons (replaces per-triplet Dragon) = 15, held at 13',
    hand: '東東東 西西西 白白', melds: ['pong 中', 'pong 發'], win: '白', source: 'discard', seat: 'N', round: 'S',
    expect: { fan: 13, raw: 15, items: { allHonours: 10, smallThreeDragons: 5 }, absent: ['dragon'] } });
  v({ id: 'c-ah-double-kong', ref: 'p.15 All Honours + Double Kong Replacement = 13 (limit)',
    hand: '西西西 北北', melds: ['kong 東', 'ckong 南', 'pong 中'], win: '北', source: 'self', kongReplacement: 2, seat: 'W', round: 'W',
    expect: { fan: 13, items: { allHonours: 10, doubleKong: 9 }, itemsExact: false, absent: ['selfPick', 'kongReplacement'] } });

  // ---------------------------------------------------------------- Decomposition choice
  v({ id: 'x-best-decomposition', ref: 'the scorer must choose the reading worth the most Fan (111 222 333 as triplets, not runs)',
    hand: '111m 222m 333m 東東', melds: ['pong 5m'], win: '東', source: 'discard', seat: 'S', round: 'W',
    expect: { fan: 6, items: { allTriplets: 3, mixedFlush: 3 } } });
  v({ id: 'x-win-tile-placement', ref: 'the winning discard completes the 111m triplet: All Triplets + Concealed beats three runs',
    hand: '111m 222m 333m 西西西 44p', melds: [], win: '1m', source: 'discard', seat: 'S', round: 'E',
    expect: { fan: 4, items: { allTriplets: 3, concealed: 1 } } });
  v({ id: 'x-win-tile-placement-self', ref: 'the same hand by self-pick is All Concealed Triplets',
    hand: '111m 222m 333m 西西西 44p', melds: [], win: '1m', source: 'self', seat: 'S', round: 'E',
    expect: { fan: 9, items: { allConcealedTriplets: 8, selfPick: 1 } } });

  // ---------------------------------------------------------------- Payment Table (p.16)
  var POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
  var PAYMENTS = [
    // winner 0; deltas indexed by player
    { id: 'pay-full-self', ref: 'p.16 Self pick: all three players pay the points for your Fan total',
      fan: 5, winner: 0, source: 'self', payer: null, style: 'full', unit: 'points', expect: [72, -24, -24, -24] },
    { id: 'pay-full-discard', ref: 'p.16 Discard: only the discarder pays, at 2x the points',
      fan: 5, winner: 0, source: 'discard', payer: 2, style: 'full', unit: 'points', expect: [48, 0, -48, 0] },
    { id: 'pay-full-robkong', ref: 'Robbing the Kong is paid like a discard by the player whose Kong was robbed',
      fan: 6, winner: 1, source: 'robKong', payer: 3, style: 'full', unit: 'points', expect: [0, 64, 0, -64] },
    { id: 'pay-shared-discard', ref: 'p.16 Older tables: discarder pays double, the other two pay single, for the same total (2x points)',
      fan: 5, winner: 0, source: 'discard', payer: 2, style: 'shared', unit: 'points', expect: [48, -12, -24, -12] },
    { id: 'pay-shared-self', ref: 'p.16 Self pick is unchanged on older tables',
      fan: 5, winner: 0, source: 'self', payer: null, style: 'shared', unit: 'points', expect: [72, -24, -24, -24] },
    { id: 'pay-limit-self', ref: 'p.16 13+ Fan = 384',
      fan: 13, winner: 3, source: 'self', payer: null, style: 'full', unit: 'points', expect: [-384, -384, -384, 1152] },
    { id: 'pay-chips-self', ref: 'p.16 With chips, paying the Fan count (5 Fan = 5 chips)',
      fan: 5, winner: 0, source: 'self', payer: null, style: 'full', unit: 'chips', expect: [15, -5, -5, -5] },
    { id: 'pay-chips-discard', ref: 'p.16 chips — discarder pays at 2x',
      fan: 5, winner: 0, source: 'discard', payer: 1, style: 'full', unit: 'chips', expect: [10, -10, 0, 0] },
    { id: 'pay-chips-limit', ref: 'p.16 "a limit hand pays 13, not 384"',
      fan: 13, winner: 0, source: 'self', payer: null, style: 'full', unit: 'chips', expect: [39, -13, -13, -13] }
  ];

  var API = { vectors: V, POINTS: POINTS, payments: PAYMENTS };
  root.HKMJ_TEST_VECTORS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
