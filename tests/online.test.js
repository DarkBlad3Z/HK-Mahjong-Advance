#!/usr/bin/env node
/* HK Mahjong — tests/online.test.js
 * End to end: the game's online client (src/ui/online.js) talking to the real server script (server/scoreboard.gs,
 * run in Node with fake Google services) through a fake fetch. Covers sign-up, sign-in, recording wins and games,
 * the offline outbox and retry, a bad session, the leaderboard, and the sign-in / leaderboard screens.
 *   node tests/online.test.js
 */
'use strict';
var path = require('path'), crypto = require('crypto');
var ROOT = path.join(__dirname, '..');
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }

var server = require('./_stubs/gas.js').makeServer();
var URL = 'https://script.google.com/macros/s/AKfycbx_TEST-123/exec';
var online = true, requests = 0;
var mem = {};
global.localStorage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
global.fetch = function (url, opts) {
  requests++;
  if (!online) return Promise.reject(new TypeError('Failed to fetch'));
  var body;
  if (opts && opts.method === 'POST') body = server.doPost(opts.body);
  else {
    var q = {}; String(url).split('?')[1].split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    body = server.doGet(q);
  }
  return Promise.resolve({ text: function () { return Promise.resolve(JSON.stringify(body)); } });
};
global.HKMJ_SCOREBOARD_URL = URL;
['tiles', 'rng', 'hand', 'scoring', 'engine', 'ai'].forEach(function (f) { require(path.join(ROOT, 'src', 'core', f + '.js')); });
['tile-art', 'rules-content', 'online', 'render'].forEach(function (f) { require(path.join(ROOT, 'src', 'ui', f + '.js')); });
var O = globalThis.HKMJ.Online, UI = globalThis.HKMJ.UI;
server.sandbox.setup();

function rowsOf(tab) { var s = server.book.getSheetByName(tab); return s.getLastRow() - 1; }
function expectReject(p, re, label) {
  return p.then(function () { ok(false, label + ' (resolved)'); }, function (e) { ok(re.test(e.message), label + ': ' + e.message); });
}

(async function () {
  // config
  ok(O.available(), 'available with an Apps Script URL');
  global.HKMJ_SCOREBOARD_URL = 'https://example.com/steal';
  ok(!O.available(), 'other URLs are ignored');
  global.HKMJ_SCOREBOARD_URL = 'https://script.google.com/a/macros/example.org/s/AKfy_x/exec';
  ok(O.available(), 'Google Workspace web-app URLs accepted');
  global.HKMJ_SCOREBOARD_URL = URL;
  ok(O._passwordHash('Julie ', 'tea') === crypto.createHash('sha256').update('hkmj:julie:tea').digest('hex'), 'password hash = sha256("hkmj:" + lower name + ":" + password)');

  // accounts
  await expectReject(O.signIn('login', 'Julie', 'tea'), /do not match/, 'sign in before the account exists');
  await expectReject(O.signIn('register', '', 'x'), /name/, 'empty name');
  ok(await O.signIn('register', 'Julie', 'tea') === 'Julie' && O.user() === 'Julie', 'create account signs you in');
  var sess = JSON.parse(mem['hkmj.session.v1']);
  ok(/^[0-9a-f]{64}$/.test(sess.pw) && JSON.stringify(mem).indexOf('tea') < 0, 'only the hash is kept in this browser');
  O.signOut();
  ok(O.user() === null, 'sign out');
  await expectReject(O.signIn('login', 'julie', 'TEA'), /do not match/, 'wrong password');
  ok(await O.signIn('login', 'julie', 'tea') === 'Julie', 'sign in ignoring name case');

  // records
  await O.recordWin({ gameId: 'g1', handNo: 1, fan: 8, points: 64, source: 'self', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }, { id: 'selfPick', name: 'Self-Pick', fan: 1 }] });
  ok(rowsOf('Wins') === 1 && O.pending() === 0, 'win saved, outbox empty');
  online = false;
  await O.recordWin({ gameId: 'g1', handNo: 3, fan: 13, points: 256, source: 'discard', items: [{ id: 'thirteenOrphans', name: 'Thirteen Orphans', fan: 13 }] });
  ok(rowsOf('Wins') === 1 && O.pending() === 1 && /internet/.test(O.lastError()), 'offline: the win waits in the outbox');
  await O.recordGame({ gameId: 'g1', score: 300, place: 1, hands: 8, handsWon: 2, selfPicks: 1, biggestFan: 13, minFan: 3, rounds: 1, aiLevel: 'normal' });
  ok(O.pending() === 2, 'offline: the game waits too');
  online = true;
  ok(await O.flush() === 2 && rowsOf('Wins') === 2 && rowsOf('Games') === 1 && O.pending() === 0, 'back online: both sent in order');
  ok(await O.flush() === 0, 'nothing left to send');

  // a second player; records queued under one name wait for that player
  O.signOut();
  ok(await O.recordWin({ gameId: 'g2', handNo: 1, fan: 3 }) === 0 && O.pending() === 0, 'signed out: nothing recorded');
  ok(await O.signIn('register', 'Bel', 'bel') === 'Bel', 'Bel signs up');
  online = false;
  await O.recordWin({ gameId: 'g7', handNo: 2, fan: 0, points: 4, source: 'discard', chicken: true, items: [] });
  O.signOut();
  online = true;
  await O.signIn('login', 'Julie', 'tea');
  ok(O.pending() === 0 && JSON.parse(mem['hkmj.outbox.v1']).length === 1, "Bel's queued win is not sent as Julie");
  O.signOut();
  await O.signIn('login', 'Bel', 'bel');
  await O.flush();
  ok(JSON.parse(mem['hkmj.outbox.v1']).length === 0 && rowsOf('Wins') === 3, "Bel's win goes up when Bel signs in");

  // a stale session (password reset by the owner) signs you out instead of losing the record silently
  server.sandbox.resetPassword('Bel');
  await O.recordWin({ gameId: 'g7', handNo: 4, fan: 5 });
  ok(O.user() === null && /sign in again/i.test(O.lastError()) && JSON.parse(mem['hkmj.outbox.v1']).length === 1, 'bad session: signed out, record kept');

  // leaderboard
  await O.signIn('login', 'Julie', 'tea');
  var lb = await O.leaderboard();
  ok(lb.players[0].name === 'Julie' && lb.players[0].handsWon === 2 && lb.players[0].limitHands === 1 && lb.myWins.length === 2, 'leaderboard data for the signed-in player');
  online = false;
  await expectReject(O.leaderboard(), /internet/, 'leaderboard offline');
  online = true;

  // screens
  var onlineState = { available: true, user: 'Julie', pending: 0 };
  var html = UI.renderRoot({ screen: 'start', online: onlineState, modal: { type: 'leaderboard', tab: 'board', data: lb } });
  ok(/Signed in as <strong>Julie<\/strong>/.test(html) && /lb-me/.test(html) && /1,?0?\d*/.test(html), 'leaderboard tab renders, your row highlighted');
  ['hall', 'hands', 'mine'].forEach(function (t) {
    var h = UI.renderRoot({ screen: 'start', online: onlineState, modal: { type: 'leaderboard', tab: t, data: lb } });
    ok(h.indexOf('undefined') < 0 && h.indexOf('NaN') < 0, t + ' tab renders cleanly');
  });
  ok(/Thirteen Orphans/.test(UI.renderRoot({ screen: 'start', online: onlineState, modal: { type: 'leaderboard', tab: 'hall', data: lb } })), 'hall of fame lists the Thirteen Orphans');
  ok(/Loading/.test(UI.renderRoot({ screen: 'start', online: onlineState, modal: { type: 'leaderboard', tab: 'board', loading: true } })), 'loading state');
  var evil = { players: [{ name: '<img src=x onerror=alert(1)>', rank: 1, games: 1, firsts: 0, winRate: 0, totalScore: 0, avgScore: 0, bestGame: 0, handsWon: 0, selfPicks: 0, biggestFan: 0, limitHands: 0, hands: {} }] };
  ok(UI.renderRoot({ screen: 'start', online: onlineState, modal: { type: 'leaderboard', tab: 'board', data: evil } }).indexOf('<img') < 0, 'names are escaped');
  var login = UI.renderRoot({ screen: 'start', online: { available: true, user: null }, modal: { type: 'login', username: 'Pat', error: 'That name and password do not match.' } });
  ok(/data-login="username"[^>]*value="Pat"/.test(login) && /role="alert"/.test(login) && /type="password"/.test(login), 'sign-in form');
  var start = UI.renderRoot({ screen: 'start', online: { available: true, user: null } });
  ok(/open-login/.test(start) && /open-leaderboard/.test(start), 'start screen offers sign-in and the leaderboard');
  ok(!/open-leaderboard|open-login/.test(UI.renderRoot({ screen: 'start' })), 'no scoreboard buttons when it is not set up');

  console.log('online.test: ' + passes + ' passed, ' + fails + ' failed (' + requests + ' requests).');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL threw ' + (e && e.stack || e)); process.exit(1); });
