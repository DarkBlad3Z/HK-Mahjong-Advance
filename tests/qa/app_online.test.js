#!/usr/bin/env node
/* HK Mahjong QA — app_online.test.js
 * Plays whole games through the real controller (src/ui/app.js, fake DOM and timers) while signed in to the online
 * scoreboard (server/scoreboard.gs in Node, reached through a fake fetch), clicking buttons the way a player would,
 * at Normal, Easy and Hard. Checks that every hand you play (win, loss or draw), every hand you win and every game
 * you finish lands in the sheet exactly once with the right numbers and computer level; that the hand and game-over
 * screens show your Win / Loss; that the computer players keep the game's level when Settings change mid-game; and
 * that nothing is recorded when you are signed out.
 *   node tests/qa/app_online.test.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }

var server = require('../_stubs/gas.js').makeServer({ noActive: false });
server.sandbox.setup();
server.opts.noActive = true;   // the web app has no "active" spreadsheet; it opens the sheet by the ID setup() saved
server.sandbox.bookCache = null;

// ------------------------------------------------------------------ fake browser
var timers = [], tid = 0;
global.setTimeout = function (fn) { timers.push({ id: ++tid, fn: fn }); return tid; };
global.clearTimeout = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
function runTimers(n) { var c = 0; while (timers.length && c < n) { var t = timers.shift(); try { t.fn(); } catch (e) { errors.push(String(e)); } c++; } return c; }
var errors = [];
var origErr = console.error;
console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
var mem = {};
global.localStorage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
global.fetch = function (url, opts) {
  var body = (opts && opts.method === 'POST') ? server.doPost(opts.body)
    : server.doGet(Object.fromEntries(String(url).split('?')[1].split('&').map(function (kv) { var p = kv.split('='); return [decodeURIComponent(p[0]), decodeURIComponent(p[1] || '')]; })));
  return Promise.resolve({ text: function () { return Promise.resolve(JSON.stringify(body)); } });
};
global.HKMJ_SCOREBOARD_URL = 'https://script.google.com/macros/s/AKfycb_APPTEST/exec';
function El(tag) { this.tag = tag; this.attrs = {}; this.innerHTML = ''; this.listeners = {}; this.style = {}; this.classList = { add: function () {}, remove: function () {} }; this.clientWidth = 1440; this.clientHeight = 900; }
El.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; };
El.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
var app = new El('div'), sprite = new El('div');
global.document = { readyState: 'complete', getElementById: function (id) { return id === 'app' ? app : id === 'tile-sprite' ? sprite : null; }, addEventListener: function () {} };
global.window = global;
global.addEventListener = function () {};

['tiles', 'rng', 'hand', 'scoring', 'engine', 'ai'].forEach(function (f) { require(path.join(ROOT, 'src', 'core', f + '.js')); });
['tile-art', 'rules-content', 'online', 'render'].forEach(function (f) { require(path.join(ROOT, 'src', 'ui', f + '.js')); });
var HKMJ = global.HKMJ;
mem['hkmj.settings.v1'] = JSON.stringify({ minFan: 3, rounds: 1, aiLevel: 'normal', speed: 'fast', sound: false, music: false, hints: false });

// which level the computer players are asked to play at
var aiLevels = {}, testDeciding = false, realDecide = HKMJ.AI.decide;
HKMJ.AI.decide = function (view, acts, opts) {
  if (!testDeciding && view && view.viewer !== 0) aiLevels[(opts && opts.level) || '?'] = (aiLevels[(opts && opts.level) || '?'] || 0) + 1;
  return realDecide.apply(this, arguments);
};

function buttons() {
  var out = [], re = /<[^>]*data-action="([^"]+)"[^>]*>/g, m;
  while ((m = re.exec(app.innerHTML))) {
    var tag = m[0], b = new El('button');
    var ar = /data-([a-z-]+)="([^"]*)"/g, a;
    while ((a = ar.exec(tag))) b.attrs['data-' + a[1]] = a[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    out.push(b);
  }
  return out;
}
function click(b) { app.listeners.click[0]({ target: b }); }
function find(action, pred) { return buttons().filter(function (b) { return b.getAttribute('data-action') === action && (!pred || pred(b)); })[0]; }
function settle() { return new Promise(function (r) { setImmediate(r); }); }
function expectedOutcome(r) {
  if (r.type === 'draw' || r.winner === null || r.winner === undefined) return { result: 'Draw', dealtIn: '' };
  if (r.winner === 0) return { result: 'Win', dealtIn: '' };
  return { result: 'Loss', dealtIn: (r.payer === 0 && (r.source === 'discard' || r.source === 'robKong')) ? 'Yes' : '' };
}

async function playOneGame(label, level, opts) {
  opts = opts || {};
  var G = null, myWins = [], ends = [], standings = null, badgeMisses = [], changedMidGame = false;
  click(find('request-new-game'));
  var confirm = find('open-new-game-settings'); if (confirm) click(confirm);
  HKMJ.App.debug.state().modal.draft.aiLevel = level;
  click(find('settings-save'));
  for (var step = 0; step < 20000; step++) {
    if (!G && HKMJ.App.debug.game()) {
      G = HKMJ.App.debug.game();
      G.on(function (e) {
        if (e.type === 'win' && e.player === 0) myWins.push(e.result);
        if (e.type === 'handEnd') ends.push(e.result);
        if (e.type === 'gameEnd') standings = e.standings;
      });
    }
    runTimers(5);
    await settle();
    if (/gameover-modal/.test(app.innerHTML)) break;
    var nh = find('next-hand');
    if (nh) {
      var last = ends[ends.length - 1], want = expectedOutcome(last);
      var cls = want.result === 'Win' ? 'my-result-win' : want.result === 'Loss' ? 'my-result-loss' : 'my-result-draw';
      if (app.innerHTML.indexOf(cls) < 0 || (want.dealtIn && app.innerHTML.indexOf('you dealt in') < 0)) badgeMisses.push(want.result + ' hand ' + last.handNo);
      if (opts.switchLevelTo && !changedMidGame && ends.length === 1) {   // change the level in Settings, keep playing
        click(find('open-settings'));
        HKMJ.App.debug.state().modal.draft.aiLevel = opts.switchLevelTo;
        click(find('settings-save'));
        ok(/settings-confirm/.test(app.innerHTML), label + ': Settings says the level change waits for a new game');
        click(find('settings-keep-playing'));
        changedMidGame = true;
        continue;
      }
      click(nh); continue;
    }
    var acts = G ? G.getActions(0) : [];
    if (!acts.length) continue;
    testDeciding = true;
    var a = HKMJ.AI.decide(G.getView(0), acts, { level: 'normal' });
    testDeciding = false;
    if (a.type === 'discard') {
      var t = find('tile-click', function (x) { return +x.getAttribute('data-tile') === a.tile; });
      if (t) { click(t); var again = find('tile-click', function (x) { return x.getAttribute('data-index') === t.getAttribute('data-index'); }); if (again) click(again); }
      continue;
    }
    var want2 = function (x) {
      if (x.getAttribute('data-type') !== a.type) return false;
      if (a.tile !== undefined && x.hasAttribute('data-tile') && +x.getAttribute('data-tile') !== a.tile) return false;
      if (a.tiles && x.hasAttribute('data-tiles') && x.getAttribute('data-tiles') !== JSON.stringify(a.tiles)) return false;
      return true;
    };
    var b = find('act', want2);
    if (!b && (a.type === 'chow' || /kong/i.test(a.type))) {
      var op = find('open-picker'); if (op) { click(op); var opts2 = buttons().filter(function (x) { return x.getAttribute('data-action') === 'pick-option'; }); if (opts2[0]) click(opts2[0]); continue; }
    }
    if (b) click(b); else { var pass = find('act', function (x) { return x.getAttribute('data-type') === 'pass'; }); if (pass) click(pass); }
  }
  for (var i = 0; i < 20; i++) await settle();
  ok(/gameover-modal/.test(app.innerHTML), label + ': game finished');
  ok(badgeMisses.length === 0, label + ': every hand screen shows your Win / Loss / Draw' + (badgeMisses.length ? ' (missing: ' + badgeMisses.join(', ') + ')' : ''));
  return { wins: myWins, ends: ends, standings: standings };
}

(async function () {
  await HKMJ.Online.signIn('register', 'Vince', 'tiles');
  require(path.join(ROOT, 'src', 'ui', 'app.js'));
  var plan = [['normal', 'Normal'], ['normal', 'Normal', 'hard'], ['easy', 'Easy'], ['easy', 'Easy'], ['hard', 'Hard'], ['hard', 'Hard']];
  var totals = { wins: 0, hands: 0, games: 0 }, perLevel = { easy: 0, normal: 0, hard: 0 }, firsts = { easy: 0, normal: 0, hard: 0 };
  var Wn = server.book.getSheetByName('Wins'), Gs = server.book.getSheetByName('Games'), Hs = server.book.getSheetByName('Hands');
  for (var g = 0; g < plan.length; g++) {
    var level = plan[g][0], shown = plan[g][1], label = 'game ' + (g + 1) + ' (' + shown + ')';
    aiLevels = {};
    var handsBefore = Hs.getLastRow(), winsBefore = Wn.getLastRow();
    var res = await playOneGame(label, level, { switchLevelTo: plan[g][2] });
    totals.games++; totals.wins += res.wins.length; totals.hands += res.ends.length; perLevel[level]++;
    ok(JSON.stringify(Object.keys(aiLevels)) === JSON.stringify([level]), label + ': computer players played at ' + level + ' all game: ' + JSON.stringify(aiLevels));
    ok(Wn.getLastRow() - 1 === totals.wins, label + ': every win recorded once (' + (Wn.getLastRow() - 1) + ' rows, ' + totals.wins + ' wins)');
    ok(Hs.getLastRow() - 1 === totals.hands, label + ': every hand recorded once (' + (Hs.getLastRow() - 1) + ' rows, ' + totals.hands + ' hands)');
    ok(Gs.getLastRow() - 1 === totals.games, label + ': the game recorded once');
    var bad = [];
    res.ends.forEach(function (r, i) {
      var row = handsBefore + 1 + i, want = expectedOutcome(r);
      var got = [Hs.get(row, 4), Hs.get(row, 5), Hs.get(row, 6), Hs.get(row, 10), Hs.get(row, 11)].join('|');
      var exp = [r.handNo, want.result, want.dealtIn, r.payments[0], shown].join('|');
      if (got !== exp) bad.push('hand ' + r.handNo + ' got ' + got + ' want ' + exp);
      if (want.result !== 'Draw' && Hs.get(row, 9) !== r.fan) bad.push('hand ' + r.handNo + ' Fan ' + Hs.get(row, 9) + ' want ' + r.fan);
      if (want.result === 'Loss' && !/\(computer\)$/.test(Hs.get(row, 7))) bad.push('hand ' + r.handNo + ' winner ' + Hs.get(row, 7));
      if (want.result !== 'Draw' && !Hs.get(row, 12) && r.evaluation && r.evaluation.items.length) bad.push('hand ' + r.handNo + ' has no scoring');
    });
    ok(bad.length === 0, label + ': hand rows match the game (' + res.ends.length + ' hands)' + (bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''));
    res.wins.forEach(function (r, i) {
      var row = winsBefore + 1 + i;
      ok(Wn.get(row, 5) === r.fan && Wn.get(row, 6) === r.payments[0] && Wn.get(row, 12) === shown, label + ' win ' + (i + 1) + ': fan ' + r.fan + ', points ' + r.payments[0] + ', level');
    });
    var me = res.standings.filter(function (s) { return s.index === 0; })[0];
    if (me.rank === 1) firsts[level]++;
    var row = Gs.getLastRow();
    ok(Gs.get(row, 4) === me.score && Gs.get(row, 5) === me.rank && Gs.get(row, 7) === res.wins.length && Gs.get(row, 12) === shown &&
      Gs.get(row, 13) === (me.rank === 1 ? 'Win' : 'Loss'), label + ': score ' + me.score + ', place ' + me.rank + ', level, result');
    ok((me.rank === 1 ? /my-result-win gameover-result/ : /my-result-loss gameover-result/).test(app.innerHTML), label + ': game-over screen shows Win / Loss');
    ok(/Saved to the scoreboard for <strong>Vince<\/strong>/.test(app.innerHTML), label + ': game-over screen says it was saved');
    ok(HKMJ.Online.pending() === 0, label + ': nothing left in the outbox');
  }
  var lb = await HKMJ.Online.leaderboard();
  var p = lb.players[0];
  ok(p.name === 'Vince' && p.games === 6 && p.handsWon === totals.wins && p.handsPlayed === totals.hands && p.handWins === totals.wins, 'leaderboard totals match');
  ok(['easy', 'normal', 'hard'].every(function (l) { return p.byLevel[l].games === perLevel[l] && p.byLevel[l].firsts === firsts[l]; }),
    'games and wins by level: ' + JSON.stringify({ easy: p.byLevel.easy.games, normal: p.byLevel.normal.games, hard: p.byLevel.hard.games }));
  ok(p.handsPlayed === p.handWins + p.handsLost + p.handsDrawn, 'every hand is a win, loss or draw');

  // the leaderboard screen, filtered by level
  var st = HKMJ.App.debug.state();
  click(find('open-leaderboard'));
  for (var k = 0; k < 10; k++) await settle();
  ok(/lb-levels/.test(app.innerHTML) && /data-level="hard"/.test(app.innerHTML), 'level buttons on the leaderboard');
  click(find('leaderboard-level', function (b) { return b.getAttribute('data-level') === 'hard'; }));
  ok(st.modal.level === 'hard' && /Games against Hard computer players/.test(app.innerHTML), 'Hard filter');
  click(find('close-modal'));
  click(find('open-leaderboard'));
  for (k = 0; k < 10; k++) await settle();
  ok(st.modal.level === 'hard', 'the filter is remembered');
  click(find('leaderboard-tab', function (b) { return b.getAttribute('data-tab') === 'mine'; }));
  ok(/Recent hands/.test(app.innerHTML) && /mine-levels/.test(app.innerHTML) && /res-(win|loss|draw)/.test(app.innerHTML), 'My games shows hands and results by level');
  click(find('close-modal'));

  HKMJ.Online.signOut();
  var before = [Wn.getLastRow(), Hs.getLastRow(), Gs.getLastRow()].join();
  await playOneGame('signed-out game', 'normal');
  ok([Wn.getLastRow(), Hs.getLastRow(), Gs.getLastRow()].join() === before, 'signed out: nothing recorded');
  ok(/This game was not saved/.test(app.innerHTML), 'signed out: the game-over screen offers to sign in');
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors[0] : ''));
  console.error = origErr;
  console.log('app_online.test: ' + passes + ' passed, ' + fails + ' failed (' + totals.hands + ' hands, ' + totals.wins + ' wins over 6 games).');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL threw ' + (e && e.stack || e)); process.exit(1); });
