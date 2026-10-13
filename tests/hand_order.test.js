#!/usr/bin/env node
/* HK Mahjong — tests/hand_order.test.js
 * The player's own hand arrangement (HKMJ.UI.handOrder in src/ui/render.js): Sort, drag moves, and keeping the
 * arrangement in step with draws, discards, claims and Kong replacements. Also renders the table at every
 * display size to check all four hands use the same tile sizes.
 *   node tests/hand_order.test.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
['tiles', 'rng', 'hand', 'scoring', 'engine', 'ai'].forEach(function (f) { require(path.join(ROOT, 'src', 'core', f + '.js')); });
['tile-art', 'rules-content', 'render'].forEach(function (f) { require(path.join(ROOT, 'src', 'ui', f + '.js')); });
var HKMJ = globalThis.HKMJ, T = HKMJ.Tiles, HO = HKMJ.UI.handOrder;

var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }
function eq(a, b, label) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, label + '  got ' + A + ' want ' + B); }
function P(s) { return T.parse(s); }

// fresh deal: sorted, the dealer's 14th tile apart at the right end
var r = HO.reconcile(null, P('9m 1m 5p 東 2s 1m'), P('5p')[0]);
eq(r.order, P('1m 1m 9m 2s 東 5p'), 'fresh: sorted with the drawn tile last');
eq(r.drawn, P('5p')[0], 'fresh: drawn tile marked');
eq(HO.reconcile(r, P('9m 1m 5p 東 2s 1m'), P('5p')[0]), r, 'reconcile is idempotent');

// a custom arrangement survives a discard
var custom = { order: P('東 9m 1m 2s 1m'), drawn: null };
eq(HO.reconcile(custom, P('東 1m 2s 1m'), null).order, P('東 1m 2s 1m'), 'discard: the rest keep their places');

// drawing puts the new tile apart at the right end, keeping the arrangement
var drawn = HO.reconcile(custom, P('東 9m 1m 2s 1m 3m'), P('3m')[0]);
eq(drawn.order, P('東 9m 1m 2s 1m 3m'), 'draw: new tile appended apart');
eq(drawn.drawn, P('3m')[0], 'draw: marked as drawn');

// discarding another tile: the kept drawn tile joins the hand in order (before the first higher tile) ...
var after = HO.reconcile(drawn, P('東 9m 1m 1m 3m'), null, { placeNew: 'sorted' });
eq(after.order, P('東 9m 1m 1m 3m'), 'after discard: drawn tile placed beside its own suit (after the highest lower tile)');
eq(after.drawn, null, 'after discard: nothing apart');
// ... or stays at the right end
eq(HO.reconcile(drawn, P('東 9m 1m 1m 3m'), null, { placeNew: 'end' }).order, P('東 9m 1m 1m 3m'), 'placeNew end: stays at the right end');

// discarding the drawn tile itself
eq(HO.reconcile(drawn, P('東 9m 1m 2s 1m'), null).order, P('東 9m 1m 2s 1m'), 'discard drawn: arrangement unchanged');

// pong: two tiles leave the hand
eq(HO.reconcile({ order: P('5p 東 1m 5p 9s'), drawn: null }, P('東 1m 9s'), null).order, P('東 1m 9s'), 'claim: melded tiles removed');

// concealed kong with the drawn 4th tile, then a replacement tile arrives
var k = { order: P('7s 1m 7s 2p 7s 7s'), drawn: P('7s')[0] };
var kr = HO.reconcile(k, P('1m 2p 4m'), P('4m')[0]);
eq(kr.order, P('1m 2p 4m'), 'kong: kong tiles out, replacement apart');
eq(kr.drawn, P('4m')[0], 'kong: replacement marked as drawn');

// duplicates keep their positions
eq(HO.reconcile({ order: P('2m 5s 2m 5s'), drawn: null }, P('2m 5s 5s'), null).order, P('2m 5s 5s'), 'duplicates: a removed copy is taken from the right');
eq(HO.reconcile({ order: P('1m 2m 3p 7m'), drawn: null }, P('1m 2m 3p 7m 5m'), null).order, P('1m 2m 5m 3p 7m'), 'into order: beside the highest lower tile of its suit');
eq(HO.reconcile({ order: P('7m 3p 東'), drawn: null }, P('7m 3p 東 2m'), null).order, P('2m 7m 3p 東'), 'into order: before the lowest higher tile of its suit');
eq(HO.reconcile({ order: P('東 3p'), drawn: null }, P('東 3p 9s'), null).order, P('東 3p 9s'), 'into order (arranged hand): a suit you do not hold goes to the right end');
eq(HO.reconcile({ order: P('1m 5p 東'), drawn: null }, P('1m 5p 東 3s'), null).order, P('1m 5p 3s 東'), 'into order (sorted hand): new suit slots into suit order');
eq(HO.reconcile({ order: P('1m 5m 9m'), drawn: null }, P('1m 5m 9m 5m'), null).order, P('1m 5m 5m 9m'), 'into order: sorted hand stays sorted');

// sort and move
var s = HO.sorted(P('9m 東 1m 3p'), P('9m')[0]);
eq(s.order, P('1m 3p 東 9m'), 'sort: suit order, drawn still apart');
eq(HO.move(P('1m 2m 3m 4m'), 0, 3), P('2m 3m 4m 1m'), 'move to the end');
eq(HO.move(P('1m 2m 3m 4m'), 3, 0), P('4m 1m 2m 3m'), 'move to the start');
eq(HO.move(P('1m 2m 3m 4m'), 1, 2), P('1m 3m 2m 4m'), 'move one right');

// handDisplay uses the arrangement only while it matches the hand
var view = { players: [{ hand: P('1m 2m 3m'), drawn: null }] };
eq(HO.display(view, { handOrder: P('3m 1m 2m'), handDrawn: null }).kinds, P('3m 1m 2m'), 'display: arrangement used');
eq(HO.display(view, { handOrder: P('3m 1m 9m'), handDrawn: null }).kinds, P('1m 2m 3m'), 'display: stale arrangement ignored');

// fuzz: random draws, discards, claims — the order is always the hand, kept tiles never change relative order
var R = HKMJ.RNG(4242), rng = function () { return R.next(); }, bad = 0;
for (var game = 0; game < 400; game++) {
  var wall = []; for (var t = 0; t < 34; t++) for (var c = 0; c < 4; c++) wall.push(t);
  for (var i = wall.length - 1; i > 0; i--) { var jx = Math.floor(rng() * (i + 1)); var tmp = wall[i]; wall[i] = wall[jx]; wall[jx] = tmp; }
  var hand = wall.splice(0, 13), st = HO.reconcile(null, hand, null);
  for (var step = 0; step < 40 && wall.length; step++) {
    var before = st.order.slice(), op = rng();
    var d = null;
    if (op < 0.5) { d = wall.pop(); hand.push(d); }
    else if (op < 0.8 && hand.length > 1) { hand.splice(Math.floor(rng() * hand.length), 1); }
    else if (hand.length > 3) { hand.splice(Math.floor(rng() * hand.length), 1); hand.splice(Math.floor(rng() * hand.length), 1); }
    if (rng() < 0.3) st = { order: HO.move(st.order, Math.floor(rng() * st.order.length), Math.floor(rng() * st.order.length)), drawn: null };
    before = st.order.slice();
    st = HO.reconcile(st, hand, d, { placeNew: rng() < 0.5 ? 'sorted' : 'end' });
    if (!HO.sameTiles(st.order, hand)) bad++;
    if (d !== null && (st.drawn !== d || st.order[st.order.length - 1] !== d)) bad++;
    // relative order of tiles present both before and after is preserved (subsequence check on the kept body)
    var body = st.drawn === null ? st.order : st.order.slice(0, -1), bi = 0;
    var cnt = {}; hand.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
    var keptBefore = before.filter(function (x) { if (cnt[x] > 0) { cnt[x]--; return true; } return false; });
    for (var q = 0; q < body.length && bi < keptBefore.length; q++) if (body[q] === keptBefore[bi]) bi++;
    if (bi < keptBefore.length - (st.drawn === null ? 1 : 0) - 1) bad++;
  }
}
ok(bad === 0, 'fuzz: ' + bad + ' invariant violations over 400 random hands');

// every display size: all four seats use the same hand-tile size; side hands fit the felt
var g = new HKMJ.Game({ seed: 99, names: ['You', 'Julie', 'Bel', 'Pat'], humans: [0] });
g.start();
['standard', 'large', 'xlarge'].forEach(function (size) {
  var html = HKMJ.UI.renderRoot({ screen: 'game', view: g.getView(0), ui: { displaySize: size, callouts: [], aiThinking: {} } });
  var z = HKMJ.UI.SIZES[size];
  ok(html.indexOf('--hand-w:' + z.hw + 'px') >= 0, size + ': hand size variable emitted');
  ok(html.indexOf('ui-size-' + size) >= 0 && html.indexOf('canvas-scale size-' + size) >= 0, size + ': size classes present');
  ok((html.match(/tile-side/g) || []).length === g.getView(0).players[1].handCount + g.getView(0).players[3].handCount, size + ': side hands drawn tile by tile');
  ok((html.match(/class="tile tile-hand tile-back"/g) || []).length === g.getView(0).players[2].handCount, size + ': top hand uses the hand tile size');
  ok(!/NaN|undefined/.test(html), size + ': no NaN/undefined');
  ok(html.indexOf('data-action="sort-hand"') >= 0, size + ': Sort button present');
});

console.log('hand_order.test: ' + passes + ' passed, ' + fails + ' failed.');
process.exit(fails ? 1 : 0);
