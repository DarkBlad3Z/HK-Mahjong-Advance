#!/usr/bin/env node
/* HK Mahjong — tests/chicken.test.js
 * Table rule "Chicken hand can win 雞糊" (settings.optional.chicken).
 * A chicken hand = a complete hand whose only Fan (if any) comes from bonus tiles. 'minimum' (default, booklet p.12):
 * it needs the Minimum Fan like any hand. 'always': it may win even below the minimum. 'never': it can never win.
 * Other hands still need the Minimum Fan; blessings and flower wins are unaffected.
 *   node tests/chicken.test.js
 */
'use strict';
var path = require('path');
['tiles', 'rng', 'hand', 'scoring', 'engine', 'ai'].forEach(function (f) { require(path.join(__dirname, '..', 'src', 'core', f + '.js')); });
var HKMJ = globalThis.HKMJ, T = HKMJ.Tiles, S = HKMJ.Scoring;
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }

function ctx(hand, win, opts, extra) {
  return Object.assign({
    hand: T.parse(hand), melds: [{ type: 'chow', tiles: T.parse('234p'), concealed: false }], winTile: T.parse(win)[0], source: 'discard',
    seatWind: 1, roundWind: 0, flowers: T.parse('1f'),          // Plum = Flower 1: not South's seat flower -> no bonus Fan
    settings: { minFan: opts.minFan, optional: { chicken: opts.chicken } }
  }, extra || {});
}
// mixed suits, chows + a pong, exposed chow, a non-seat flower: no Fan at all
var CHICKEN = '123m 567s 888p 55s', WIN = '5s';
// the same shape with a Red Dragon pong instead: 1 Fan (Dragon)
var ONE_FAN = '123m 567s 中中中 55s';

var e = S.evaluate(ctx(CHICKEN, WIN, { minFan: 3, chicken: 'never' }));
ok(e.winning && e.chicken === true && e.fan === 0, 'chicken hand recognised (0 Fan): ' + JSON.stringify({ c: e.chicken, f: e.fan }));
ok(e.valid === false, 'chicken off, min 3: cannot win');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 0, chicken: 'never' })).valid === false, 'chicken off, min 0: still cannot win');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 3, chicken: 'always' })).valid === true, 'chicken on, min 3: may win');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 0, chicken: 'always' })).valid === true, 'chicken on, min 0: may win');

// booklet default ('minimum'): a chicken hand wins only when it reaches the minimum
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 0, chicken: 'minimum' })).valid === true, 'booklet rule, min 0: chicken hand wins (p.12)');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 1, chicken: 'minimum' })).valid === false, 'booklet rule, min 1: chicken hand cannot win');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 0 })).valid === true, 'no rule given = booklet rule');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 3, chicken: 'minimum' })).chickenBarred === false, 'below the minimum is not "barred by the chicken rule"');
ok(S.evaluate(ctx(CHICKEN, WIN, { minFan: 0, chicken: 'never' })).chickenBarred === true, 'never: barred by the chicken rule');

// flowers-only Fan still counts as a chicken hand
var seat = S.evaluate(ctx(CHICKEN, WIN, { minFan: 1, chicken: 'never' }, { flowers: T.parse('2f') }));   // Orchid = South's seat flower
ok(seat.chicken === true && seat.fan === 1, 'seat flower only: still a chicken hand, 1 Fan');
ok(seat.valid === false, 'flowers-only chicken, chicken off: cannot win even though 1 Fan meets min 1');
var none = S.evaluate(ctx(CHICKEN, WIN, { minFan: 3, chicken: 'always' }, { flowers: [] }));
ok(none.chicken === true && none.fan === 1 && none.valid === true, 'No Flowers 1 Fan only: chicken hand, may win when on');

// a hand with Fan of its own is not a chicken hand and still needs the minimum
var one = S.evaluate(ctx(ONE_FAN, WIN, { minFan: 3, chicken: 'always' }));
ok(one.chicken === false && one.fan === 1 && one.valid === false, 'Dragon 1 Fan, min 3, chicken on: still below the minimum');
ok(S.evaluate(ctx(ONE_FAN, WIN, { minFan: 1, chicken: 'never' })).valid === true, 'Dragon 1 Fan, min 1, chicken off: wins normally');

// blessings are never chicken hands; flower wins unaffected
var hv = S.evaluate(Object.assign(ctx(CHICKEN, WIN, { minFan: 3, chicken: 'never' }), { blessing: 'heaven', source: 'self' }));
ok(hv.valid === true && hv.chicken === false, 'Blessing of Heaven on a chicken shape: wins');
var fw = S.evaluate({ flowerWin: true, flowers: T.parse('1234f 123x'), seatWind: 1, settings: { minFan: 3, optional: { chicken: 'never' } } });
ok(fw.valid === true, 'Seven Flowers still wins with chicken off');

// engine: the setting is kept, defaults off, and changes whether a win is offered
ok(HKMJ.DEFAULT_SETTINGS.optional.chicken === 'minimum', 'default: booklet rule (needs the minimum)');
var g = new HKMJ.Game({ seed: 3, settings: { optional: { chicken: 'always' } } });
ok(g.getView(0).settings.optional.chicken === 'always', 'engine keeps optional.chicken = always');
ok(new HKMJ.Game({ seed: 3, settings: { optional: { chicken: 'bogus' } } }).getView(0).settings.optional.chicken === 'minimum', 'engine rejects an unknown value');
ok(new HKMJ.Game({ seed: 3 }).getView(0).settings.optional.chicken === 'minimum', 'engine default optional.chicken = minimum');

// full games: with minimum 3 and chicken on, chicken wins happen and every win is either a chicken hand or >= 3 Fan
var chickenWins = 0, badWins = 0, games = 0;
for (var seed = 1; seed <= 40; seed++) {
  var G = new HKMJ.Game({ seed: seed, settings: { minFan: 3, rounds: 1, optional: { chicken: 'always' } } });
  G.on(function (ev) {
    if (ev.type !== 'win') return;
    var r = ev.result, v = r.evaluation;
    if (r.source === 'flowers' || (v && v.items.some(function (i) { return i.id === 'heaven' || i.id === 'earth' || i.id === 'man'; }))) return;
    if (v.chicken) chickenWins++; else if (v.fan < 3) badWins++;
  });
  G.start();
  for (var guard = 0; guard < 6000; guard++) {
    var p = G.getPending();
    if (p.type === 'gameEnd') break;
    if (p.type === 'handEnd') { G.nextHand(); continue; }
    (p.type === 'turn' ? [p.player] : p.waiting).forEach(function (q) { G.act(q, HKMJ.AI.decide(G.getView(q), G.getActions(q), { level: 'normal' })); });
  }
  games++;
}
ok(badWins === 0, 'no non-chicken win below 3 Fan (' + badWins + ')');
ok(chickenWins > 0, 'chicken wins occur when allowed (' + chickenWins + ' in ' + games + ' games)');

console.log('chicken.test: ' + passes + ' passed, ' + fails + ' failed.');
process.exit(fails ? 1 : 0);
