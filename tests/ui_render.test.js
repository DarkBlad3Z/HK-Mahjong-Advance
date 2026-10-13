#!/usr/bin/env node
/* HK Mahjong — tests/ui_render.test.js  (Owner: UI, per UI_SPEC.md §7)
 * Loads core + UI modules in plain Node (no browser). Uses the REAL back end (src/core/hand,scoring,engine,ai.js)
 * if present, else falls back to dev/mock-engine.js (same SPEC.md §5/§6 contract either way, so this file needs
 * no changes when the switch happens). Plays complete games and drives deliberately engineered scenarios via
 * HKMJ.Game.buildWall, rendering every intermediate view/result/draw/game-over/settings/rules screen through
 * HKMJ.UI, asserting no exceptions, no leaked "NaN"/"undefined", and the key markers called out in UI_SPEC §7.
 *
 *   node tests/ui_render.test.js            -> run everything, exit 1 on any failure
 *   node tests/ui_render.test.js --verbose  -> print progress
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var CORE = path.join(ROOT, 'src', 'core');
var UI = path.join(ROOT, 'src', 'ui');
var VERBOSE = process.argv.indexOf('--verbose') >= 0;

// ------------------------------------------------------------------ module loading (real engine, else mock)

function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

var usingReal = ['hand.js', 'scoring.js', 'engine.js', 'ai.js'].every(function (f) { return exists(path.join(CORE, f)); });

require(path.join(CORE, 'tiles.js'));
require(path.join(CORE, 'rng.js'));
if (usingReal) {
  require(path.join(CORE, 'hand.js'));
  require(path.join(CORE, 'scoring.js'));
  require(path.join(CORE, 'engine.js'));
  require(path.join(CORE, 'ai.js'));
} else {
  require(path.join(ROOT, 'dev', 'mock-engine.js'));
}
require(path.join(UI, 'tile-art.js'));
require(path.join(UI, 'rules-content.js'));
require(path.join(UI, 'render.js'));

var HKMJ = globalThis.HKMJ;
var T = HKMJ.Tiles;
console.log('ui_render.test.js: using ' + (usingReal ? 'REAL' : 'MOCK') + ' engine (src/core/engine.js ' + (usingReal ? 'found' : 'not found yet') + ')');

// ------------------------------------------------------------------ tiny assert harness (mirrors tests/run_vectors.js style)

var passes = 0, fails = 0;
function ok(cond, label) { if (cond) { passes++; if (VERBOSE) console.log('ok   ' + label); } else { fails++; console.log('FAIL ' + label); } }
function tryRun(label, fn) {
  try { fn(); ok(true, label); }
  catch (e) { fails++; console.log('FAIL ' + label + ' threw: ' + (e && e.stack || e)); }
}

// ------------------------------------------------------------------ §7: render.js must not touch document/window

tryRun('render.js source has no document/window API usage', function () {
  var src = fs.readFileSync(path.join(UI, 'render.js'), 'utf8');
  // Property-access form only (document.foo / window.foo / document[..] / window[..]) so prose mentions of
  // the words "document"/"window" in comments (e.g. this very check's own description) don't false-positive.
  var bad = src.match(/\b(document|window)\s*[.\[]/);
  if (bad) throw new Error('found forbidden DOM usage "' + bad[0] + '" in render.js');
});

// ------------------------------------------------------------------ HTML sanity helpers

function assertClean(html, label) {
  if (typeof html !== 'string' || !html.length) throw new Error(label + ': render produced an empty/non-string result');
  var m = html.match(/NaN|undefined/);
  if (m) {
    var i = html.indexOf(m[0]);
    throw new Error(label + ': leaked "' + m[0] + '" in output — context: ...' + html.slice(Math.max(0, i - 50), i + 50) + '...');
  }
}
function countOccurrences(html, needle) { return (html.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }

var uiBase = { selectedIndex: null, hintInfo: null, hintSuggestion: null, aiThinking: {}, toast: null, callouts: [], picker: null };
function baseUiFor(view) {
  var u = { selectedIndex: null, hintInfo: null, hintSuggestion: null, aiThinking: {}, toast: null, callouts: [], picker: null };
  try { u.hintInfo = null; } catch (e) { /* ignore */ }
  return u;
}

var coverage = {
  turnRendered: 0, claimRendered: 0, robKongRendered: 0, handEndRendered: 0, gameEndRendered: 0,
  fourteenTileChecks: 0, actionBarChecks: 0, winTriangleSeen: false, drawSeen: false, gameEndSeen: false,
  robKongSeen: false, multiChowPickerSeen: false, multiKongPickerSeen: false,
  patternsSeen: {}
};

/** Renders the full table for `view` and runs the UI_SPEC §7 marker checks against it. */
function renderAndCheckTable(view, label) {
  var ui = baseUiFor(view);
  var html = HKMJ.UI.renderRoot({ screen: 'game', view: view, ui: ui });
  assertClean(html, label);

  // Marker: 14 hand tiles on your turn (viewer's own 14-tile decision point)
  var me = view.players[0];
  if (me.hand && me.hand.length === 14) {
    coverage.fourteenTileChecks++;
    var tileClicks = countOccurrences(html, 'data-action="tile-click"');
    ok(tileClicks === 14, label + ': 14 hand tiles rendered when holding 14 (' + tileClicks + ')');
  }
  // Marker: action buttons present when actions exist
  if (view.actions && view.actions.length) {
    coverage.actionBarChecks++;
    ok(html.indexOf('action-bar') >= 0, label + ': action bar present when actions exist');
  }
  return html;
}

function renderAndCheckResult(view, label) {
  var ui = baseUiFor(view);
  var html = HKMJ.UI.renderRoot({ screen: 'game', view: view, ui: ui });
  assertClean(html, label);
  if (view.phase === 'handEnd') {
    coverage.handEndRendered++;
    ok(html.indexOf('modal') >= 0, label + ': hand-result modal markup present');
    if (view.result.type === 'draw') {
      coverage.drawSeen = true;
      ok(/Draw/.test(html), label + ': draw wording present');
    } else {
      var groups = view.result.evaluation && view.result.evaluation.groups || [];
      var pattern = view.result.evaluation && view.result.evaluation.pattern;
      if (pattern) coverage.patternsSeen[pattern] = (coverage.patternsSeen[pattern] || 0) + 1;
      if (groups.some(function (g) { return g.hasWinTile; })) {
        coverage.winTriangleSeen = true;
        ok(html.indexOf('win-triangle') >= 0, label + ': red-triangle marker present on the winning tile');
      }
    }
  } else if (view.phase === 'gameEnd') {
    coverage.gameEndRendered++;
    coverage.gameEndSeen = true;
    ok(html.indexOf('standing') >= 0, label + ': game-over standings present');
  }
  return html;
}

// ------------------------------------------------------------------ drive complete games, rendering every step

var LEVELS = ['easy', 'normal', 'hard'];
var SEEDS = usingReal ? 40 : 30;
var GUARD = 8000;

for (var s = 0; s < SEEDS; s++) {
  var g;
  tryRun('game seed ' + s + ' plays to completion without exceptions', function () {
    g = new HKMJ.Game({ seed: 70000 + s, names: ['You', 'Julie', 'Bel', 'Pat'], humans: [0] });
    g.start();
    var guard = 0;
    while (guard++ < GUARD) {
      var pend = g.getPending();
      if (pend.type === 'gameEnd') { renderAndCheckResult(g.getView(0), 'seed' + s + ' gameEnd'); break; }
      if (pend.type === 'handEnd') {
        renderAndCheckResult(g.getView(0), 'seed' + s + ' handEnd#' + pend.result.handNo);
        var r = g.nextHand();
        if (!r.ok) throw new Error('nextHand failed: ' + r.error);
        continue;
      }
      if (pend.type === 'turn') {
        if (pend.player === 0) {
          coverage.turnRendered++;
          renderAndCheckTable(g.getView(0), 'seed' + s + ' turn(you)');
        }
        var actions = g.getActions(pend.player);
        if (!actions.length) throw new Error('turn player ' + pend.player + ' has no legal actions');
        if (pend.player === 0 && actions.filter(function (a) { return a.type === 'concealedKong' || a.type === 'addKong'; }).length > 1) {
          coverage.multiKongPickerSeen = true;
        }
        var view = g.getView(pend.player);
        var action = HKMJ.AI.decide(view, actions, { level: LEVELS[pend.player % 3] });
        var res = g.act(pend.player, action);
        if (!res.ok) throw new Error('act failed for player ' + pend.player + ': ' + res.error + ' action=' + JSON.stringify(action));
        continue;
      }
      if (pend.type === 'claim' || pend.type === 'robKong') {
        if (pend.type === 'robKong') coverage.robKongSeen = true;
        if (pend.waiting.indexOf(0) >= 0) {
          coverage[pend.type === 'robKong' ? 'robKongRendered' : 'claimRendered']++;
          renderAndCheckTable(g.getView(0), 'seed' + s + ' ' + pend.type + '(you)');
          var myActs = g.getActions(0);
          if (myActs.filter(function (a) { return a.type === 'chow'; }).length > 1) coverage.multiChowPickerSeen = true;
        }
        pend.waiting.slice().forEach(function (p) {
          var v = g.getView(p), a = g.getActions(p);
          var act = HKMJ.AI.decide(v, a, { level: LEVELS[p % 3] });
          var r2 = g.act(p, act);
          if (!r2.ok) throw new Error('claim act failed for player ' + p + ': ' + r2.error);
        });
        continue;
      }
      throw new Error('unknown pending type ' + pend.type);
    }
    if (guard >= GUARD) throw new Error('guard limit hit — game did not terminate');
  });
}

// ------------------------------------------------------------------ deliberately engineered scenarios (deterministic)

function buildScenario(hands, extra) {
  // hands[0] is always the full 14-tile hand below, so it is the dealer; buildWall auto-detects that from the
  // 14-tile hand, and the Game must be told the same thing so the deal actually lands the tiles on player 0.
  var spec = Object.assign({ hands: hands }, extra || {});
  var wall = HKMJ.Game.buildWall(spec, HKMJ.RNG(1));
  return new HKMJ.Game(Object.assign({ presetWalls: [wall], firstDealer: 0, humans: [0], names: ['You', 'Julie', 'Bel', 'Pat'] }, extra && extra.gameOpts));
}

// Blessing of Heaven: dealer (player 0)'s opening 14 tiles are already a complete standard hand.
tryRun('Blessing of Heaven scenario renders correctly', function () {
  var hands = [
    T.parse('123456789m 111p 55p'),
    T.parse('123456789s 1234s'),
    T.parse('2233445566778p'),
    T.parse('東東東東南南南南西西西西中')
  ];
  var g = buildScenario(hands);
  g.start();
  var actions = g.getActions(0);
  var win = actions.filter(function (a) { return a.type === 'selfWin'; })[0];
  if (!win) throw new Error('selfWin not offered on a complete opening hand');
  renderAndCheckTable(g.getView(0), 'heaven pre-win');
  var res = g.act(0, { type: 'selfWin' });
  if (!res.ok) throw new Error('selfWin act failed: ' + res.error);
  var view = g.getView(0);
  ok(view.phase === 'handEnd', 'heaven: reaches handEnd');
  ok(view.result.evaluation.items.some(function (it) { return it.id === 'heaven'; }), 'heaven: evaluation includes the heaven item');
  var html = renderAndCheckResult(view, 'heaven handEnd');
  ok(/Heaven|天糠/.test(html), 'heaven: title mentions Blessing of Heaven');
});

// Seven Pairs (also triggers Heaven as a side effect of being the dealer's opening hand — that is fine, it
// still exercises the sevenPairs `pattern` and its pair-group rendering, which is what this checks).
tryRun('Seven Pairs shape renders pair groups correctly', function () {
  var hands = [
    T.parse('中中發發東東南南西西北北 11m'),
    T.parse('123456789p 1234s'),
    T.parse('123456789m 123p'),
    T.parse('123456789s 456p')
  ];
  var g = buildScenario(hands);
  g.start();
  var actions = g.getActions(0);
  var win = actions.filter(function (a) { return a.type === 'selfWin'; })[0];
  if (!win) throw new Error('selfWin not offered on a Seven Pairs opening hand');
  ok(win.evaluation.pattern === 'sevenPairs', 'seven pairs: evaluation.pattern is sevenPairs (got ' + win.evaluation.pattern + ')');
  g.act(0, { type: 'selfWin' });
  var html = renderAndCheckResult(g.getView(0), 'sevenPairs handEnd');
  ok(html.indexOf('result-group-pair') >= 0, 'seven pairs: pair groups rendered');
});

// Thirteen Orphans.
tryRun('Thirteen Orphans shape renders single-tile groups correctly', function () {
  var hands = [
    T.parse('19m 19p 19s 東南西北中發白東'),
    T.parse('123456789p 1234s'),
    T.parse('123456789m 123p'),
    T.parse('123456789s 456p')
  ];
  var g = buildScenario(hands);
  g.start();
  var actions = g.getActions(0);
  var win = actions.filter(function (a) { return a.type === 'selfWin'; })[0];
  if (!win) throw new Error('selfWin not offered on a Thirteen Orphans opening hand');
  ok(win.evaluation.pattern === 'thirteenOrphans', 'thirteen orphans: evaluation.pattern is thirteenOrphans (got ' + win.evaluation.pattern + ')');
  g.act(0, { type: 'selfWin' });
  var html = renderAndCheckResult(g.getView(0), 'thirteenOrphans handEnd');
  ok(html.indexOf('result-group-single') >= 0, 'thirteen orphans: single-tile groups rendered');
});

// ------------------------------------------------------------------ standalone screens (not reachable via play alone)

tryRun('start screen renders (no save)', function () {
  var html = HKMJ.UI.renderRoot({ screen: 'start', saveExists: false });
  assertClean(html, 'start(no save)');
  ok(html.indexOf('Continue') < 0, 'start: no Continue button without a save');
});
tryRun('start screen renders (with save)', function () {
  var html = HKMJ.UI.renderRoot({ screen: 'start', saveExists: true });
  assertClean(html, 'start(with save)');
  ok(html.indexOf('continue-game') >= 0, 'start: Continue button present with a save');
});

function draftSettings() {
  var d = JSON.parse(JSON.stringify(HKMJ.DEFAULT_SETTINGS));
  d.name = 'You'; d.speed = 'normal'; d.hints = true; d.sound = true;
  return d;
}
tryRun('settings modal renders (new game)', function () {
  var html = HKMJ.UI.renderRoot({ screen: 'start', modal: { type: 'settings', draft: draftSettings(), forNewGame: true } });
  assertClean(html, 'settings(new game)');
  ok(html.indexOf('Start Game') >= 0, 'settings: new-game primary button labelled Start Game');
});
tryRun('settings modal renders (mid-game, with restart confirm)', function () {
  var html = HKMJ.UI.renderRoot({ screen: 'game', view: null, modal: { type: 'settings', draft: draftSettings(), forNewGame: false, confirmingRestart: true } });
  assertClean(html, 'settings(restart confirm)');
  ok(html.indexOf('settings-restart-now') >= 0, 'settings: restart-now control present when confirming');
});
tryRun('confirm modal renders', function () {
  var html = HKMJ.UI.renderRoot({ screen: 'game', view: null, modal: { type: 'confirm', message: 'Start a new game?', confirmAction: 'x', cancelAction: 'y' } });
  assertClean(html, 'confirm modal');
});

HKMJ.RulesContent.tabs.forEach(function (tab) {
  tryRun('rules modal renders tab "' + tab.id + '"', function () {
    var html = HKMJ.UI.renderRoot({ screen: 'start', modal: { type: 'rules', tab: tab.id, settings: HKMJ.DEFAULT_SETTINGS } });
    assertClean(html, 'rules(' + tab.id + ')');
    ok(html.indexOf('rules-tab') >= 0, 'rules(' + tab.id + '): tab bar present');
  });
});

// ------------------------------------------------------------------ summary

console.log('\nCoverage: ' + JSON.stringify(coverage));
console.log((usingReal ? 'REAL' : 'MOCK') + ' engine — ' + passes + ' passed, ' + fails + ' failed.');
if (!coverage.gameEndSeen) console.log('NOTE: no game reached gameEnd naturally within the seed budget (not a failure, just less coverage).');
if (!coverage.drawSeen) console.log('NOTE: no drawn hand seen naturally within the seed budget.');
if (!coverage.robKongSeen) console.log('NOTE: no Robbing-the-Kong seen naturally within the seed budget (rare).');
if (!coverage.multiChowPickerSeen) console.log('NOTE: no multi-option Chow picker seen naturally within the seed budget.');
if (!coverage.multiKongPickerSeen) console.log('NOTE: no multi-option Kong picker seen naturally within the seed budget (rare).');
process.exit(fails ? 1 : 0);
