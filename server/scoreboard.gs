/**
 * HK Mahjong 香港麻雀 — online scoreboard (Google Apps Script), version 2
 *
 * Keeps the scoreboard in the Google Sheet this script is attached to and answers the game:
 *   - create an account / sign in (username + password)
 *   - record every hand a signed-in player plays (win, loss or draw) with how the winning hand scored, the full
 *     scoring of each hand they win, and each game they finish, with the computer level (Easy, Normal or Hard)
 *   - send the leaderboard, hall of fame and recent results back to the game
 *
 * Tabs (setup() creates them): Players, Games, Wins, Hands (raw records), Stats (one formula row per player),
 * Leaderboard (Stats sorted by total score) and Hall of Fame (records and hand champions).
 * A sheet made by version 1 is upgraded automatically the first time this version runs. Records are kept.
 *
 * Passwords never go in the sheet. The game sends a SHA-256 hash of the password; this script salts and hashes
 * it again and keeps it in Script Properties, which people who can only view the sheet cannot see.
 *
 * Setup — full steps in SCOREBOARD-SETUP.md:
 *   1. In your Google Drive folder: New → Google Sheets. Name it "HK Mahjong Scoreboard".
 *   2. In the sheet: Extensions → Apps Script. Replace everything with this file. Save.
 *   3. Pick "setup" in the function list and click Run. Allow access when Google asks.
 *   4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *   5. Put the Web app URL (it ends in /exec) into the game's index.html (HKMJ_SCOREBOARD_URL).
 * Updating from an older version: replace everything in Code.gs with this file and Save, then
 *   Deploy → Manage deployments → pencil icon → Version: New version → Deploy. The URL stays the same.
 */

var SCOREBOARD_VERSION = 2;
var SCHEMA = 2;   // sheet layout; ensureTabs() upgrades sheets made by older versions

// Hands counted on the Stats / Leaderboard tabs and in the Hall of Fame: [scoring id, name shown].
var HANDS = [
  ['fullFlush', 'Full Flush'], ['mixedFlush', 'Mixed Flush'], ['allTriplets', 'All Triplets'],
  ['allConcealedTriplets', 'All Concealed Triplets'], ['allQuadruplets', 'All Quadruplets'],
  ['mixedTerminals', 'Mixed Terminals'], ['allTerminals', 'All Terminals'], ['allHonours', 'All Honours'],
  ['smallThreeDragons', 'Small Three Dragons'], ['bigThreeDragons', 'Big Three Dragons'],
  ['smallFourWinds', 'Small Four Winds'], ['bigFourWinds', 'Big Four Winds'],
  ['sevenPairs', 'Seven Pairs'], ['luxurySevenPairs', 'Luxury Seven Pairs'], ['knitted', 'Knitted Tiles'],
  ['lesserHonours', 'Lesser Honours'], ['greaterHonours', 'Greater Honours'],
  ['thirteenOrphans', 'Thirteen Orphans'], ['nineGates', 'Nine Gates'],
  ['heaven', 'Blessing of Heaven'], ['earth', 'Blessing of Earth'], ['man', 'Blessing of Man'],
  ['sevenFlowers', 'Seven Flowers'], ['eightFlowers', 'Eight Flowers'],
  ['kongReplacement', 'Win by Kong Replacement'], ['doubleKong', 'Double Kong Replacement'],
  ['robKong', 'Robbing the Kong'], ['moon', 'Moon Under The Sea'], ['chicken', 'Chicken Hand']
];
// Computer levels: [key the game sends, name shown on the sheet]
var LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];

var TABS = {
  players: 'Players', games: 'Games', wins: 'Wins', hands: 'Hands', stats: 'Stats', board: 'Leaderboard', hall: 'Hall of Fame'
};
var HEAD = {
  players: ['Player', 'Joined', 'Last seen'],
  games: ['Finished', 'Player', 'Game ID', 'Final score', 'Place', 'Hands played', 'Hands won', 'Self-picks',
    'Biggest win (Fan)', 'Minimum Fan', 'Rounds', 'Computer level', 'Result'],
  wins: ['Time', 'Player', 'Game ID', 'Hand no.', 'Fan', 'Points won', 'How', 'Scoring', 'Hand IDs', 'Limit hand',
    'Chicken hand', 'Computer level'],
  hands: ['Time', 'Player', 'Game ID', 'Hand no.', 'Result', 'Dealt in', 'Winner', 'How', 'Fan', 'Points', 'Computer level',
    'Scoring'],
  // Stats columns A..K, then one column per entry of HANDS, then STATS_EXTRA, then LEVEL_STATS for each level
  stats: ['Player', 'Games', '1st places', 'Win rate', 'Total score', 'Average score', 'Best game', 'Hands won',
    'Self-picks', 'Biggest hand (Fan)', 'Limit hands']
};
var STATS_EXTRA = ['Games lost', 'Hands played', 'Hands lost', 'Draws', 'Dealt in', 'Hand win rate'];
var LEVEL_STATS = ['games', '1st places', 'win rate', 'total score', 'hands played', 'hands won'];
var COL = {   // 1-based Stats column numbers
  handsFirst: HEAD.stats.length + 1,                                        // L
  extraFirst: HEAD.stats.length + HANDS.length + 1,                         // AO
  levelFirst: HEAD.stats.length + HANDS.length + STATS_EXTRA.length + 1     // AU
};
function statsHeaders() {
  var h = HEAD.stats.concat(HANDS.map(function (x) { return x[1]; }), STATS_EXTRA);
  LEVELS.forEach(function (l) { LEVEL_STATS.forEach(function (c) { h.push(l[1] + ' ' + c); }); });
  return h;
}
var NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,19}$/u;

// ================================================================================================ web app entry points

function doGet(e) { return respond(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}'); } catch (err) { body = {}; }
  return respond(body);
}

function respond(req) {
  var out;
  try { out = withLock(function () { return route(req || {}); }); }
  catch (err) { out = { ok: false, error: String(err && err.message ? err.message : err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function route(req) {
  switch (String(req.action || '')) {
    case 'ping': return { ok: true, version: SCOREBOARD_VERSION };
    case 'register': return register(req);
    case 'login': return login(req);
    case 'win': return recordWin(req);
    case 'hand': return recordHand(req);
    case 'game': return recordGame(req);
    case 'leaderboard': return leaderboard(req);
    default: return { ok: false, error: 'Unknown request.', unknown: true };
  }
}

// ================================================================================================ accounts

function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
/** Free text from the game, made safe for a cell: no control characters, and nothing that Sheets would read as a
 * formula (a leading =, +, - or @ is dropped). */
function safeText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^[\s=+\-@]+/, '').slice(0, max);
}
function keyOf(name) { return 'user:' + cleanName(name).toLowerCase(); }
function hex(bytes) { return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
function sha256(s) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function props() { return PropertiesService.getScriptProperties(); }

function getAccount(name) {
  var raw = props().getProperty(keyOf(name));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function register(req) {
  var name = cleanName(req.username), pw = String(req.pw || '');
  if (!NAME_RE.test(name)) return { ok: false, error: 'Use 2–20 letters or numbers for your name (spaces, dots, dashes and underscores are fine).' };
  if (!/^[0-9a-f]{64}$/.test(pw)) return { ok: false, error: 'Please choose a password.' };
  if (getAccount(name)) return { ok: false, error: 'That name is already taken. Sign in instead, or pick another name.' };
  // After a password reset the player comes back under the same name: keep the spelling already on the sheet.
  ensureTabs();
  var known = findRow(tab(TABS.players), function (r) { return String(r[0]).toLowerCase() === name.toLowerCase(); });
  if (known) name = String(tab(TABS.players).getRange(known, 1).getValue()) || name;
  touchPlayer(name, true);   // sheet rows first, so a failed write doesn't leave a half-made account
  var salt = Utilities.getUuid();
  props().setProperty(keyOf(name), JSON.stringify({ name: name, salt: salt, hash: sha256(salt + pw), joined: new Date().toISOString() }));
  return { ok: true, username: name };
}

/** Returns the account for a valid username + password hash, or null. */
function check(req) {
  var acct = getAccount(req.username);
  if (!acct) return null;
  return sha256(acct.salt + String(req.pw || '')) === acct.hash ? acct : null;
}

function login(req) {
  var acct = check(req);
  if (!acct) return { ok: false, error: 'That name and password do not match.' };
  ensureTabs();
  touchPlayer(acct.name, false);
  return { ok: true, username: acct.name };
}

// ================================================================================================ records

function num(v, lo, hi, dflt) {
  var n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function lvKey(v) {
  var s = String(v == null ? '' : v).toLowerCase().trim();
  for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === s) return s;
  return '';
}
/** 'normal' / 'Normal' -> 'Normal'; anything else -> ''. */
function levelOf(v) {
  var k = lvKey(v);
  for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === k) return LEVELS[i][1];
  return '';
}

var HOW = { self: 'Self-pick', discard: 'Discard', robKong: 'Robbing the Kong', flowers: 'Flowers' };
var RESULTS = { win: 'Win', loss: 'Loss', draw: 'Draw' };

/** Row number (2 or more) of the newest row whose first four cells match pred, or 0. Reads only those cells. */
function findRecord(sheet, pred) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return 0;
  var vals = sheet.getRange(2, 1, n, 4).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (pred(vals[i])) return i + 2;
  return 0;
}
function sameHand(acct, gameId, handNo) {
  return function (r) { return r[1] === acct.name && String(r[2]) === gameId && Number(r[3]) === handNo; };
}

/** "Full Flush 7, Self-Pick 1" from the game's list of scoring items. */
function scoringText(items) {
  return (Array.isArray(items) ? items.slice(0, 30) : []).map(function (it) {
    return safeText(it && (it.name || it.id), 40) + ' ' + num(it && it.fan, 0, 13, 0);
  }).join(', ');
}

function recordWin(req) {
  var acct = check(req);
  if (!acct) return { ok: false, error: 'Please sign in again.', auth: false };
  ensureTabs();
  var sheet = tab(TABS.wins);
  var gameId = safeText(req.gameId, 40), handNo = num(req.handNo, 0, 999, 0);
  if (gameId && findRecord(sheet, sameHand(acct, gameId, handNo))) return { ok: true, duplicate: true };
  var items = Array.isArray(req.items) ? req.items.slice(0, 30) : [];
  var ids = items.map(function (it) { return String(it && it.id || '').replace(/[^A-Za-z]/g, ''); }).filter(Boolean);
  var fan = num(req.fan, 0, 13, 0);
  if (req.chicken && ids.indexOf('chicken') < 0) ids.push('chicken');
  var scoring = scoringText(items);
  sheet.appendRow([new Date(), acct.name, gameId, handNo, fan, num(req.points, -100000, 100000, 0),
    HOW[req.source] || 'Discard', scoring, ',' + ids.join(',') + ',', fan >= 13 ? 'Yes' : '', req.chicken ? 'Yes' : '',
    levelOf(req.aiLevel)]);
  touchPlayer(acct.name, false);
  return { ok: true };
}

/** Every hand a signed-in player plays to the end: Win, Loss or Draw, with how the winning hand scored. */
function recordHand(req) {
  var acct = check(req);
  if (!acct) return { ok: false, error: 'Please sign in again.', auth: false };
  var result = RESULTS[String(req.result || '').toLowerCase()];
  if (!result) return { ok: false, error: 'Unknown hand result.' };
  ensureTabs();
  var sheet = tab(TABS.hands);
  var gameId = safeText(req.gameId, 40), handNo = num(req.handNo, 0, 999, 0);
  if (gameId && findRecord(sheet, sameHand(acct, gameId, handNo))) return { ok: true, duplicate: true };
  var draw = result === 'Draw';
  sheet.appendRow([new Date(), acct.name, gameId, handNo, result, result === 'Loss' && req.dealtIn ? 'Yes' : '',
    result === 'Win' ? acct.name : (draw ? '' : safeText(req.winner, 40)), draw ? '' : (HOW[req.source] || ''),
    draw ? '' : num(req.fan, 0, 13, 0), num(req.points, -100000, 100000, 0), levelOf(req.aiLevel),
    draw ? '' : scoringText(req.items)]);
  touchPlayer(acct.name, false);
  return { ok: true };
}

function recordGame(req) {
  var acct = check(req);
  if (!acct) return { ok: false, error: 'Please sign in again.', auth: false };
  ensureTabs();
  var sheet = tab(TABS.games);
  var gameId = safeText(req.gameId, 40);
  if (gameId && findRecord(sheet, function (r) { return r[1] === acct.name && String(r[2]) === gameId; })) return { ok: true, duplicate: true };
  var place = num(req.place, 1, 4, 4);
  sheet.appendRow([new Date(), acct.name, gameId, num(req.score, -1000000, 1000000, 0), place,
    num(req.hands, 0, 999, 0), num(req.handsWon, 0, 999, 0), num(req.selfPicks, 0, 999, 0), num(req.biggestFan, 0, 13, 0),
    num(req.minFan, 0, 13, 3), num(req.rounds, 1, 4, 4), levelOf(req.aiLevel), place === 1 ? 'Win' : 'Loss']);
  touchPlayer(acct.name, false);
  return { ok: true };
}

// ================================================================================================ leaderboard (for the game)

/** Everything the game's Leaderboard screen shows, computed from the raw Games, Wins and Hands rows. */
function leaderboard(req) {
  ensureTabs();
  var games = rows(TABS.games), wins = rows(TABS.wins), hands = rows(TABS.hands), players = rows(TABS.players);
  var out = summarize(players, games, wins, hands);
  var me = cleanName(req.player || '').toLowerCase();
  if (me) {
    var mine = function (r) { return String(r[1]).toLowerCase() === me; };
    out.myGames = games.filter(mine).slice(-15).reverse().map(gameObj);
    out.myWins = wins.filter(mine).slice(-15).reverse().map(winObj);
    out.myHands = hands.filter(mine).slice(-20).reverse().map(handObj);
  }
  out.ok = true;
  return out;
}

function iso(d) { return d instanceof Date ? d.toISOString() : String(d || ''); }
function gameObj(r) {
  return { time: iso(r[0]), player: r[1], score: Number(r[3]) || 0, place: Number(r[4]) || 0, hands: Number(r[5]) || 0,
    handsWon: Number(r[6]) || 0, level: levelOf(r[11]), result: String(r[12] || '') || (Number(r[4]) === 1 ? 'Win' : 'Loss') };
}
function winObj(r) {
  return { time: iso(r[0]), player: r[1], fan: Number(r[4]) || 0, points: Number(r[5]) || 0, how: r[6], scoring: r[7],
    level: levelOf(r[11]) };
}
function handObj(r) {
  return { time: iso(r[0]), handNo: Number(r[3]) || 0, result: String(r[4] || ''), dealtIn: r[5] === 'Yes',
    winner: String(r[6] || ''), how: String(r[7] || ''), fan: Number(r[8]) || 0, points: Number(r[9]) || 0, level: levelOf(r[10]),
    scoring: String(r[11] || '') };
}

function blankStats() {
  return { games: 0, firsts: 0, totalScore: 0, bestGame: null, handsWon: 0, selfPicks: 0, biggestFan: 0, limitHands: 0,
    handsPlayed: 0, handWins: 0, handsLost: 0, handsDrawn: 0, dealtIn: 0 };
}
function finishStats(s) {
  s.bestGame = s.bestGame === null ? 0 : s.bestGame;
  s.gamesLost = s.games - s.firsts;
  s.winRate = s.games ? s.firsts / s.games : 0;
  s.avgScore = s.games ? s.totalScore / s.games : 0;
  s.handWinRate = s.handsPlayed ? s.handWins / s.handsPlayed : 0;
  return s;
}

/** Pure: players/games/wins/hands rows (no header) -> leaderboard JSON. Same definitions as the Stats tab formulas.
 *  Each player also has byLevel.easy / .normal / .hard with the same numbers for games against that computer level. */
function summarize(players, games, wins, hands) {
  hands = hands || [];
  var by = {}, order = [];
  function p(name) {
    var k = String(name).toLowerCase();
    if (!by[k]) {
      var s = blankStats();
      s.name = String(name); s.hands = {}; s.byLevel = {};
      LEVELS.forEach(function (l) { s.byLevel[l[0]] = blankStats(); });
      by[k] = s; order.push(k);
    }
    return by[k];
  }
  function both(s, level, fn) { fn(s); if (level) fn(s.byLevel[level]); }
  players.forEach(function (r) { if (r[0]) p(r[0]); });
  games.forEach(function (r) {
    if (!r[1]) return;
    var score = Number(r[3]) || 0, first = Number(r[4]) === 1;
    both(p(r[1]), lvKey(r[11]), function (s) {
      s.games++; if (first) s.firsts++;
      s.totalScore += score;
      s.bestGame = s.bestGame === null ? score : Math.max(s.bestGame, score);
    });
  });
  var firstTo = {}, recent = [];
  wins.forEach(function (r) {
    if (!r[1]) return;
    var p0 = p(r[1]), fan = Number(r[4]) || 0;
    both(p0, lvKey(r[11]), function (s) {
      s.handsWon++;
      if (r[6] === 'Self-pick') s.selfPicks++;
      if (fan > s.biggestFan) s.biggestFan = fan;
      if (r[9] === 'Yes') s.limitHands++;
    });
    String(r[8] || '').split(',').forEach(function (id) {
      if (!id) return;
      p0.hands[id] = (p0.hands[id] || 0) + 1;
      if (!firstTo[id]) firstTo[id] = { player: p0.name, time: iso(r[0]) };
    });
    recent.push(winObj(r));
  });
  hands.forEach(function (r) {
    if (!r[1]) return;
    var res = String(r[4]);
    both(p(r[1]), lvKey(r[10]), function (s) {
      s.handsPlayed++;
      if (res === 'Win') s.handWins++; else if (res === 'Loss') s.handsLost++; else if (res === 'Draw') s.handsDrawn++;
      if (r[5] === 'Yes') s.dealtIn++;
    });
  });
  var list = order.map(function (k) {
    var s = finishStats(by[k]);
    LEVELS.forEach(function (l) { finishStats(s.byLevel[l[0]]); });
    s.chickens = s.hands.chicken || 0;
    return s;
  });
  list.sort(function (a, b) { return (b.totalScore - a.totalScore) || (b.firsts - a.firsts) || (b.handsWon - a.handsWon) || (a.name < b.name ? -1 : 1); });
  list.forEach(function (s, i) { s.rank = i + 1; });

  function best(label, unit, val) {
    var top = null;
    list.forEach(function (s) { if (val(s) > 0 && (!top || val(s) > val(top))) top = s; });
    return top ? { award: label, player: top.name, value: val(top), unit: unit || '' } : null;
  }
  function field(f) { return function (s) { return s[f]; }; }
  var records = [best('Top scorer (total points)', 'points', field('totalScore')), best('Most games won', 'games', field('firsts'))]
    .concat(LEVELS.map(function (l) { return best('Most games won on ' + l[1], 'games', function (s) { return s.byLevel[l[0]].firsts; }); }))
    .concat([best('Most hands won', 'hands', field('handsWon')), best('Most limit hands (13 Fan)', 'hands', field('limitHands')),
      best('Most self-picks', 'self-picks', field('selfPicks')), best('Chicken champion', 'chicken hands', field('chickens'))])
    .filter(Boolean);
  var bestGameRow = null, bigWinRow = null;
  games.forEach(function (r) { if (r[1] && (!bestGameRow || Number(r[3]) > Number(bestGameRow[3]))) bestGameRow = r; });
  wins.forEach(function (r) { if (r[1] && (!bigWinRow || Number(r[4]) > Number(bigWinRow[4]))) bigWinRow = r; });
  if (bestGameRow) records.splice(1, 0, { award: 'Best single game', player: bestGameRow[1], value: Number(bestGameRow[3]) || 0, unit: 'points', time: iso(bestGameRow[0]) });
  if (bigWinRow) records.splice(2, 0, { award: 'Biggest hand', player: bigWinRow[1], value: Number(bigWinRow[4]) || 0, unit: 'Fan', time: iso(bigWinRow[0]), detail: bigWinRow[7] });

  var champions = HANDS.map(function (h) {
    var top = null;
    list.forEach(function (s) { var n = s.hands[h[0]] || 0; if (n > 0 && (!top || n > top.n)) top = { player: s.name, n: n }; });
    if (!top) return null;
    return { id: h[0], hand: h[1], player: top.player, count: top.n, first: firstTo[h[0]].player, firstTime: firstTo[h[0]].time };
  }).filter(Boolean);

  return { version: SCOREBOARD_VERSION, updated: new Date().toISOString(), hands: HANDS, levels: LEVELS, players: list,
    records: records, champions: champions, recent: recent.slice(-10).reverse() };
}

// ================================================================================================ sheet helpers

// The sheet this script is attached to. Google doesn't give web apps the "active" spreadsheet, so setup() also
// remembers its ID and the web app opens it by that ID.
var bookCache = null;
function book() {
  if (bookCache) return bookCache;
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
  if (!ss) {
    var id = props().getProperty('sheetId');
    if (!id) throw new Error('The scoreboard is not set up yet. Open the sheet, then Extensions → Apps Script, and run "setup".');
    ss = SpreadsheetApp.openById(id);
  }
  bookCache = ss;
  return ss;
}
function tab(name) { return book().getSheetByName(name); }

function rows(name) {
  var sh = tab(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var first = name === TABS.stats ? 3 : 2;
  if (sh.getLastRow() < first) return [];
  return sh.getRange(first, 1, sh.getLastRow() - first + 1, sh.getLastColumn()).getValues();
}

function findRow(sheet, pred) {
  if (sheet.getLastRow() < 2) return 0;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < vals.length; i++) if (pred(vals[i])) return i + 2;
  return 0;
}

/** Adds the player to Players (and a formula row to Stats) the first time; updates "Last seen". */
function touchPlayer(name, isNew) {
  var sh = tab(TABS.players), now = new Date();
  var row = findRow(sh, function (r) { return String(r[0]).toLowerCase() === name.toLowerCase(); });
  if (row) { sh.getRange(row, 3).setValue(now); return; }
  sh.appendRow([name, now, now]);
  addStatsRow(name);
}

function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** One Stats row of formulas (columns B onwards) over the Games, Wins and Hands tabs for the player in column A. */
function statsFormulas(r) {
  var A = '$A' + r, G = 'Games!', W = 'Wins!', H = 'Hands!';
  var f = [
    '=COUNTIF(' + G + '$B$2:$B,' + A + ')',
    '=COUNTIFS(' + G + '$B$2:$B,' + A + ',' + G + '$E$2:$E,1)',
    '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')',
    '=SUMIF(' + G + '$B$2:$B,' + A + ',' + G + '$D$2:$D)',
    '=IF(B' + r + '=0,0,E' + r + '/B' + r + ')',
    '=IF(B' + r + '=0,0,MAXIFS(' + G + '$D$2:$D,' + G + '$B$2:$B,' + A + '))',
    '=COUNTIF(' + W + '$B$2:$B,' + A + ')',
    '=COUNTIFS(' + W + '$B$2:$B,' + A + ',' + W + '$G$2:$G,"Self-pick")',
    '=IF(H' + r + '=0,0,MAXIFS(' + W + '$E$2:$E,' + W + '$B$2:$B,' + A + '))',
    '=COUNTIFS(' + W + '$B$2:$B,' + A + ',' + W + '$J$2:$J,"Yes")'
  ];
  HANDS.forEach(function (h, i) {
    var c = colLetter(COL.handsFirst + i);
    f.push('=COUNTIFS(' + W + '$B$2:$B,' + A + ',' + W + '$I$2:$I,"*,"&' + c + '$2&",*")');
  });
  var played = colLetter(COL.extraFirst + 1) + r;
  f.push('=B' + r + '-C' + r);
  f.push('=COUNTIF(' + H + '$B$2:$B,' + A + ')');
  f.push('=COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$E$2:$E,"Loss")');
  f.push('=COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$E$2:$E,"Draw")');
  f.push('=COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$F$2:$F,"Yes")');
  f.push('=IF(' + played + '=0,0,COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$E$2:$E,"Win")/' + played + ')');
  LEVELS.forEach(function (l, i) {
    var c0 = COL.levelFirst + i * LEVEL_STATS.length, g = colLetter(c0) + r, w = colLetter(c0 + 1) + r, L = '"' + l[1] + '"';
    f.push('=COUNTIFS(' + G + '$B$2:$B,' + A + ',' + G + '$L$2:$L,' + L + ')');
    f.push('=COUNTIFS(' + G + '$B$2:$B,' + A + ',' + G + '$E$2:$E,1,' + G + '$L$2:$L,' + L + ')');
    f.push('=IF(' + g + '=0,0,' + w + '/' + g + ')');
    f.push('=SUMIFS(' + G + '$D$2:$D,' + G + '$B$2:$B,' + A + ',' + G + '$L$2:$L,' + L + ')');
    f.push('=COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$K$2:$K,' + L + ')');
    f.push('=COUNTIFS(' + H + '$B$2:$B,' + A + ',' + H + '$E$2:$E,"Win",' + H + '$K$2:$K,' + L + ')');
  });
  return f;
}

function addStatsRow(name) {
  var sh = tab(TABS.stats), r = Math.max(sh.getLastRow() + 1, 3);
  var f = statsFormulas(r);
  fit(sh, r, f.length + 1);
  sh.getRange(r, 1).setValue(name);
  sh.getRange(r, 2, 1, f.length).setFormulas([f]);
}
/** Gives every player on the Players tab a Stats row. */
function syncStatsRows() {
  var have = {};
  rows(TABS.stats).forEach(function (r) { if (r[0]) have[String(r[0]).toLowerCase()] = true; });
  rows(TABS.players).forEach(function (r) {
    var k = String(r[0]).toLowerCase();
    if (r[0] && !have[k]) { have[k] = true; addStatsRow(String(r[0])); }
  });
}
/** New tabs start with 1000 rows and 26 columns, and Google refuses ranges past the edge: make room first. */
function fit(sh, rowsNeeded, colsNeeded) {
  var mc = sh.getMaxColumns(), mr = sh.getMaxRows();
  if (colsNeeded > mc) sh.insertColumnsAfter(mc, colsNeeded - mc);
  if (rowsNeeded > mr) sh.insertRowsAfter(mr, rowsNeeded - mr);
  return sh;
}

// ================================================================================================ setup and upgrades

/** Creates any missing tab, rebuilds the headers, formulas and formatting, and fills in the new columns. Safe to run
 *  again at any time: records are never deleted. */
function setup() {
  bookCache = null;
  props().setProperty('sheetId', book().getId());
  ensureTabs(true);
  return 'Scoreboard tabs are ready.';
}

var tabsChecked = false;
function ensureTabs(force) {
  if (tabsChecked && !force) return;
  var ss = book();
  makeTab(ss, TABS.players, HEAD.players, formatPlayers);
  makeTab(ss, TABS.games, HEAD.games, formatGames);
  makeTab(ss, TABS.wins, HEAD.wins, formatWins);
  makeTab(ss, TABS.hands, HEAD.hands, formatHands);
  var newStats = !ss.getSheetByName(TABS.stats);
  makeTab(ss, TABS.stats, null, buildStats);
  makeTab(ss, TABS.board, null, buildBoard);
  makeTab(ss, TABS.hall, null, buildHall);
  var dflt = ss.getSheetByName('Sheet1');
  if (dflt && ss.getSheets().length > 1 && dflt.getLastRow() === 0) ss.deleteSheet(dflt);
  tabsChecked = true;
  if (force || Number(props().getProperty('schema') || 0) < SCHEMA) upgrade();
  else if (newStats) syncStatsRows();   // the Stats tab was deleted: give everyone their row back
}

function makeTab(ss, name, headers, init) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  if (headers) { fit(sh, 1, headers.length); styleHeader(sh.getRange(1, 1, 1, headers.length).setValues([headers])); sh.setFrozenRows(1); }
  if (init) init(sh);
  return sh;
}
function styleHeader(range) { return range.setFontWeight('bold').setBackground('#1f5b45').setFontColor('#ffffff').setWrap(true); }
/** Rewrites row 1 when it doesn't match the current headers. Data rows are never touched. */
function syncHeader(sh, headers) {
  fit(sh, 1, headers.length);
  var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(cur[i]) !== headers[i]) {
      styleHeader(sh.getRange(1, 1, 1, headers.length).setValues([headers]));
      sh.setFrozenRows(1);
      return true;
    }
  }
  return false;
}

function formatPlayers(sh) {
  sh.getRange('B:C').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setColumnWidth(1, 160); sh.setColumnWidths(2, 2, 140);
}
function formatGames(sh) {
  sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('C:C').setNumberFormat('@');
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 130);
}
function formatWins(sh) {
  sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('C:C').setNumberFormat('@'); sh.getRange('I:I').setNumberFormat('@');
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 130); sh.setColumnWidth(8, 420); sh.setColumnWidth(9, 260);
}
function formatHands(sh) {
  sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('C:C').setNumberFormat('@');
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 130); sh.setColumnWidth(7, 150); sh.setColumnWidth(12, 420);
}
/** Percent and decimal formats for the Stats columns, shifted right by `off` columns (the Leaderboard has a Rank column). */
function statFormats(sh, off) {
  var pct = [4, COL.extraFirst + 5].concat(LEVELS.map(function (l, i) { return COL.levelFirst + i * LEVEL_STATS.length + 2; }));
  pct.forEach(function (c) { var L = colLetter(c + off); sh.getRange(L + ':' + L).setNumberFormat('0.0%'); });
  var D = colLetter(6 + off);
  sh.getRange(D + ':' + D).setNumberFormat('0.0');
}

/** Stats: header rows, formats, and the formulas of every player row. */
function buildStats(sh) {
  var head = statsHeaders(), n = head.length;
  fit(sh, 2, n);
  styleHeader(sh.getRange(1, 1, 1, n).setValues([head]));
  var ids = head.map(function (h, i) {
    var k = i + 1 - COL.handsFirst;
    return i === 0 ? 'Scoring ID' : (k >= 0 && k < HANDS.length ? HANDS[k][0] : '');
  });
  sh.getRange(2, 1, 1, n).setValues([ids]).setFontColor('#888888').setFontSize(8);
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
  statFormats(sh, 0);
  sh.setColumnWidth(1, 150);
  var last = sh.getLastRow();
  if (last >= 3) {
    var blank = head.slice(1).map(function () { return ''; });
    var f = sh.getRange(3, 1, last - 2, 1).getValues().map(function (nm, i) { return nm[0] ? statsFormulas(i + 3) : blank; });
    sh.getRange(3, 2, f.length, n - 1).setFormulas(f);
  }
}

/** Leaderboard: Stats sorted by total score, then 1st places. */
function buildBoard(sh) {
  var head = ['Rank'].concat(statsHeaders());
  fit(sh, 2, head.length);
  styleHeader(sh.getRange(1, 1, 1, head.length).setValues([head]));
  var last = colLetter(head.length - 1);
  sh.getRange('A2').setFormula('=ARRAYFORMULA(IF(LEN(B2:B),ROW(B2:B)-1,))');
  sh.getRange('B2').setFormula('=IFERROR(SORT(FILTER(Stats!A3:' + last + ',LEN(Stats!A3:A)),5,FALSE,3,FALSE),"")');
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  statFormats(sh, 1);
  sh.setColumnWidth(1, 50); sh.setColumnWidth(2, 150);
}

/** Brings a sheet made by an older version up to date. Only fills in and adds; never removes records. */
function upgrade() {
  syncHeader(tab(TABS.players), HEAD.players);
  if (syncHeader(tab(TABS.games), HEAD.games)) formatGames(tab(TABS.games));
  if (syncHeader(tab(TABS.wins), HEAD.wins)) formatWins(tab(TABS.wins));
  syncHeader(tab(TABS.hands), HEAD.hands);
  backfill();
  buildStats(tab(TABS.stats));
  syncStatsRows();
  buildBoard(tab(TABS.board));
  var hall = tab(TABS.hall);
  hall.clear();
  buildHall(hall);
  props().setProperty('schema', String(SCHEMA));
}

/** Fills the columns added in version 2 for records saved before: the computer level and Win/Loss of each game, the
 *  level of each win (taken from its game), and a Hands row for every saved win. */
function backfill() {
  var key = function (name, gameId) { return String(name).toLowerCase() + '|' + gameId; };
  var games = rows(TABS.games), levelOfGame = {};
  if (games.length) {
    var g = games.map(function (r) {
      var lv = levelOf(r[11]) || String(r[11] == null ? '' : r[11]);
      if (r[1]) levelOfGame[key(r[1], r[2])] = lv;
      return [lv, r[12] ? r[12] : (r[1] ? (Number(r[4]) === 1 ? 'Win' : 'Loss') : '')];
    });
    fit(tab(TABS.games), g.length + 1, 13).getRange(2, 12, g.length, 2).setValues(g);
  }
  var wins = rows(TABS.wins), levels = wins.map(function (r) { return levelOf(r[11]) || levelOfGame[key(r[1], r[2])] || ''; });
  if (wins.length) fit(tab(TABS.wins), wins.length + 1, 12).getRange(2, 12, wins.length, 1).setValues(levels.map(function (lv) { return [lv]; }));
  var have = {};
  rows(TABS.hands).forEach(function (r) { have[key(r[1], r[2]) + '|' + Number(r[3])] = true; });
  var add = [];
  wins.forEach(function (r, i) {
    var k = key(r[1], r[2]) + '|' + Number(r[3]);
    if (!r[1] || have[k]) return;
    have[k] = true;
    add.push([r[0], r[1], r[2], r[3], 'Win', '', r[1], r[6], r[4], r[5], levels[i], r[7]]);
  });
  var hs = tab(TABS.hands);
  if (add.length) fit(hs, hs.getLastRow() + add.length, HEAD.hands.length).getRange(hs.getLastRow() + 1, 1, add.length, HEAD.hands.length).setValues(add);
}

/** Hall of Fame: records at the top, then the champion and first winner of every hand — all formulas. */
function buildHall(sh) {
  var S = 'Stats!', G = 'Games!', W = 'Wins!';
  function topOf(col) { return '=IF(MAX(' + S + col + '3:' + col + ')<=0,"",INDEX(' + S + '$A$3:$A,MATCH(MAX(' + S + col + '3:' + col + '),' + S + col + '3:' + col + ',0)))'; }
  function maxOf(col) { return '=IF(MAX(' + S + col + '3:' + col + ')<=0,"",MAX(' + S + col + '3:' + col + '))'; }
  var chickenCol = colLetter(COL.handsFirst + HANDS.length - 1);
  var head = [['Record', 'Player', 'Value', 'When', 'Details']];
  var rec = [
    ['Top scorer (total points)', topOf('E'), maxOf('E'), '', ''],
    ['Best single game (points)', '=IFERROR(INDEX(' + G + '$B$2:$B,MATCH(MAX(' + G + '$D$2:$D),' + G + '$D$2:$D,0)),"")',
      '=IF(COUNT(' + G + '$D$2:$D)=0,"",MAX(' + G + '$D$2:$D))', '=IFERROR(INDEX(' + G + '$A$2:$A,MATCH(MAX(' + G + '$D$2:$D),' + G + '$D$2:$D,0)),"")', ''],
    ['Biggest hand (Fan)', '=IFERROR(INDEX(' + W + '$B$2:$B,MATCH(MAX(' + W + '$E$2:$E),' + W + '$E$2:$E,0)),"")',
      '=IF(COUNT(' + W + '$E$2:$E)=0,"",MAX(' + W + '$E$2:$E))', '=IFERROR(INDEX(' + W + '$A$2:$A,MATCH(MAX(' + W + '$E$2:$E),' + W + '$E$2:$E,0)),"")',
      '=IFERROR(INDEX(' + W + '$H$2:$H,MATCH(MAX(' + W + '$E$2:$E),' + W + '$E$2:$E,0)),"")'],
    ['Most games won', topOf('C'), maxOf('C'), '', '']
  ].concat(LEVELS.map(function (l, i) {
    var c = colLetter(COL.levelFirst + i * LEVEL_STATS.length + 1);
    return ['Most games won on ' + l[1], topOf(c), maxOf(c), '', ''];
  })).concat([
    ['Most hands won', topOf('H'), maxOf('H'), '', ''],
    ['Most limit hands (13 Fan)', topOf('K'), maxOf('K'), '', ''],
    ['Most self-picks', topOf('I'), maxOf('I'), '', ''],
    ['Chicken champion', topOf(chickenCol), maxOf(chickenCol), '', '']
  ]);
  sh.getRange(1, 1, 1, 5).setValues(head);
  sh.getRange(2, 1, rec.length, 5).setValues(rec.map(function (r) { return [r[0], '', '', '', '']; }));
  sh.getRange(2, 2, rec.length, 4).setFormulas(rec.map(function (r) { return r.slice(1); }));
  var start = rec.length + 3;
  fit(sh, start + HANDS.length, 6);
  sh.getRange(start, 1, 1, 6).setValues([['Hand', 'Scoring ID', 'Champion (most wins)', 'Wins', 'First to win it', 'When']]);
  var hands = HANDS.map(function (h, i) {
    var r = start + 1 + i, col = colLetter(COL.handsFirst + i), rng = S + col + '$3:' + col;
    return [h[1], h[0],
      '=IF(MAX(' + rng + ')<=0,"",INDEX(' + S + '$A$3:$A,MATCH(MAX(' + rng + '),' + rng + ',0)))',
      '=IF(MAX(' + rng + ')<=0,"",MAX(' + rng + '))',
      '=IFERROR(INDEX(' + W + '$B$2:$B,MATCH("*,"&$B' + r + '&",*",' + W + '$I$2:$I,0)),"")',
      '=IFERROR(INDEX(' + W + '$A$2:$A,MATCH("*,"&$B' + r + '&",*",' + W + '$I$2:$I,0)),"")'];
  });
  sh.getRange(start + 1, 1, hands.length, 2).setValues(hands.map(function (h) { return h.slice(0, 2); }));
  sh.getRange(start + 1, 3, hands.length, 4).setFormulas(hands.map(function (h) { return h.slice(2); }));
  [1, start].forEach(function (r) {
    sh.getRange(r, 1, 1, r === 1 ? 5 : 6).setFontWeight('bold').setBackground('#1f5b45').setFontColor('#ffffff');
  });
  sh.getRange(start + 1, 2, hands.length, 1).setFontColor('#888888').setFontSize(8);
  sh.getRange('D:D').setNumberFormat('0');
  sh.getRange(2, 4, rec.length, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(start + 1, 6, hands.length, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 3, rec.length, 1).setNumberFormat('#,##0');
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 170); sh.setColumnWidth(5, 170); sh.setColumnWidth(6, 110);
  sh.setFrozenRows(1);
}

// ================================================================================================ owner tools (menu)

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mahjong scoreboard')
    .addItem('Set up or repair the tabs', 'setup')
    .addItem('Reset a player’s password…', 'resetPasswordPrompt')
    .addToUi();
}

/** Forgets a player's password so they can create the account again with the same name; their records stay. */
function resetPassword(name) {
  props().deleteProperty(keyOf(name));
  return 'Password reset for ' + cleanName(name) + '. They can now choose a new one with "Create account".';
}

function resetPasswordPrompt() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Reset a player’s password', 'Player name:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var name = cleanName(r.getResponseText());
  if (!getAccount(name)) { ui.alert('No account named "' + name + '".'); return; }
  ui.alert(resetPassword(name));
}
