#!/usr/bin/env node
/* HK Mahjong QA — app_online.test.js
 * Plays whole games through the real controller (src/ui/app.js, fake DOM and timers) while signed in to the online
 * scoreboard (server/scoreboard.gs in Node, reached through a fake fetch), clicking buttons the way a player would.
 * Checks that every hand you win and every game you finish lands in the sheet exactly once, with the right numbers,
 * and that nothing is recorded when you are signed out.
 *   node tests/qa/app_online.test.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }

var server = require('../_stubs/gas.js').makeServer();
server.sandbox.setup();

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

async function playOneGame(label) {
  var G = null, myWins = [], standings = null;
  click(find('request-new-game'));
  var confirm = find('open-new-game-settings'); if (confirm) click(confirm);
  click(find('settings-save'));
  for (var step = 0; step < 20000; step++) {
    if (!G && HKMJ.App.debug.game()) {
      G = HKMJ.App.debug.game();
      G.on(function (e) { if (e.type === 'win' && e.player === 0) myWins.push(e.result); if (e.type === 'gameEnd') standings = e.standings; });
    }
    runTimers(5);
    await settle();
    if (/gameover-modal/.test(app.innerHTML)) break;
    var nh = find('next-hand');
    if (nh) { click(nh); continue; }
    // play like the computer would, but through the buttons: ask the AI, then click the matching control
    var acts = G ? G.getActions(0) : [];
    if (!acts.length) continue;
    var a = HKMJ.AI.decide(G.getView(0), acts, { level: 'normal' });
    if (a.type === 'discard') {
      var t = find('tile-click', function (x) { return +x.getAttribute('data-tile') === a.tile; });
      if (t) { click(t); var again = find('tile-click', function (x) { return x.getAttribute('data-index') === t.getAttribute('data-index'); }); if (again) click(again); }
      continue;
    }
    var want = function (x) {
      if (x.getAttribute('data-type') !== a.type) return false;
      if (a.tile !== undefined && x.hasAttribute('data-tile') && +x.getAttribute('data-tile') !== a.tile) return false;
      if (a.tiles && x.hasAttribute('data-tiles') && x.getAttribute('data-tiles') !== JSON.stringify(a.tiles)) return false;
      return true;
    };
    var b = find('act', want);
    if (!b && (a.type === 'chow' || /kong/i.test(a.type))) {   // several options: open the picker and choose
      var op = find('open-picker'); if (op) { click(op); var opts = (find('pick-option') ? buttons().filter(function (x) { return x.getAttribute('data-action') === 'pick-option'; }) : []); if (opts[0]) click(opts[0]); continue; }
    }
    if (b) click(b); else { var pass = find('act', function (x) { return x.getAttribute('data-type') === 'pass'; }); if (pass) click(pass); }
  }
  for (var i = 0; i < 20; i++) await settle();
  ok(/gameover-modal/.test(app.innerHTML), label + ': game finished');
  return { wins: myWins, standings: standings };
}

(async function () {
  await HKMJ.Online.signIn('register', 'Vince', 'tiles');
  require(path.join(ROOT, 'src', 'ui', 'app.js'));
  var totalWins = 0, games = 0;
  for (var g = 1; g <= 6; g++) {
    var res = await playOneGame('signed-in game ' + g);
    games++; totalWins += res.wins.length;
    var W = server.book.getSheetByName('Wins'), Gs = server.book.getSheetByName('Games');
    ok(W.getLastRow() - 1 === totalWins, 'game ' + g + ': every win recorded once (' + (W.getLastRow() - 1) + ' rows, ' + totalWins + ' wins)');
    ok(Gs.getLastRow() - 1 === games, 'game ' + g + ': the game recorded once');
    var me = res.standings.filter(function (s) { return s.index === 0; })[0];
    ok(Gs.get(Gs.getLastRow(), 4) === me.score && Gs.get(Gs.getLastRow(), 5) === me.rank && Gs.get(Gs.getLastRow(), 7) === res.wins.length,
      'game ' + g + ': score ' + me.score + ', place ' + me.rank + ', hands won ' + res.wins.length);
    res.wins.forEach(function (r, i) {
      var row = W.getLastRow() - res.wins.length + 1 + i;
      ok(W.get(row, 5) === r.fan && W.get(row, 6) === r.payments[0], 'game ' + g + ' win ' + (i + 1) + ': fan ' + r.fan + ', points ' + r.payments[0]);
    });
    ok(/Saved to the scoreboard for <strong>Vince<\/strong>/.test(app.innerHTML), 'game ' + g + ': game-over screen says it was saved');
    ok(HKMJ.Online.pending() === 0, 'game ' + g + ': nothing left in the outbox');
  }
  var lb = await HKMJ.Online.leaderboard();
  ok(lb.players[0].name === 'Vince' && lb.players[0].games === 6 && lb.players[0].handsWon === totalWins, 'leaderboard totals match');
  HKMJ.Online.signOut();
  var before = server.book.getSheetByName('Wins').getLastRow();
  await playOneGame('signed-out game');
  ok(server.book.getSheetByName('Wins').getLastRow() === before && server.book.getSheetByName('Games').getLastRow() - 1 === 6, 'signed out: nothing recorded');
  ok(/This game was not saved/.test(app.innerHTML), 'signed out: the game-over screen offers to sign in');
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors[0] : ''));
  console.error = origErr;
  console.log('app_online.test: ' + passes + ' passed, ' + fails + ' failed (' + totalWins + ' wins over 6 games).');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL threw ' + (e && e.stack || e)); process.exit(1); });
