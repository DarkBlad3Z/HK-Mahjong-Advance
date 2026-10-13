/* HK Mahjong — core/engine.js  (Owner: back end)
 * The game state machine: seats & winds, wall, deal, bonus tiles, turns, claims (win > kong/pong > chow, head bump),
 * Kongs and replacement tiles, Robbing the Kong, Seven/Eight Flowers, Blessings, hand results & payments, dealer
 * rotation, rounds, the view model, hints, events and save/resume.
 *
 * Contract: SPEC.md §5 (the UI is built against it).  Rules: SPEC.md §2 = booklet p.2, p.8-12, p.16.
 * Pure logic: no DOM, no timers, no Math.random — every random choice uses HKMJ.RNG, so a seed replays exactly.
 * Depends on HKMJ.Tiles, HKMJ.RNG, HKMJ.Hand (isWinningShape, shanten, waits) and HKMJ.Scoring (evaluate, payments),
 * looked up at call time.
 *
 * State lives in two plain-JSON objects:  this.c = fixed configuration (seed, settings, names, humans, preset walls),
 * this.s = everything that changes.  serialize() writes both plus the RNG state; Game.deserialize() restores them.
 * The live wall is an array: normal draws come off the front (shift), replacement tiles off the back (pop).
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;

  var DEFAULT_SETTINGS = {
    minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0,
    optional: { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true, chicken: 'minimum' }
  };
  var DEFAULT_NAMES = ['You', 'Julie', 'Bel', 'Pat'];
  var MAX_HANDS = 300;              // SPEC §2.2 safety cap
  var LOG_KEEP = 300, LOG_VIEW = 60;
  var SAVE_FORMAT = 'hkmj-game', SAVE_VERSION = 1;
  var ACTION_TYPES = ['discard', 'selfWin', 'flowerWin', 'concealedKong', 'addKong', 'win', 'kong', 'pong', 'chow', 'pass'];
  var PHASES = ['idle', 'turn', 'claim', 'robKong', 'handEnd', 'gameEnd'];

  // ------------------------------------------------------------------------------------------------ small helpers
  function clone(x) { return (x === undefined || x === null) ? x : JSON.parse(JSON.stringify(x)); }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
  function isSeat(p) { return isInt(p) && p >= 0 && p < 4; }
  function toKind(x) {
    if (typeof x === 'string' && /^\s*\d+\s*$/.test(x)) x = +x;
    return (isInt(x) && x >= 0 && x < 42) ? x : null;
  }
  function byNum(a, b) { return a - b; }
  function sortNum(a) { a.sort(byNum); return a; }
  function removeOne(arr, k) { var i = arr.indexOf(k); if (i < 0) return false; arr.splice(i, 1); return true; }
  function countOf(arr, k) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i] === k) n++; return n; }
  function copyMeld(m) {
    return { type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed, from: (m.from === undefined ? null : m.from),
      claimed: (m.claimed === undefined ? null : m.claimed), added: !!m.added };
  }
  function tileText(k) { return T.name(k) + ' ' + T.zh(k); }
  function runText(tiles) {                        // "3-4-5 Dots 三四五筒"
    var suit = T.suitOf(tiles[0]);
    return tiles.map(T.rankOf).join('-') + ' ' + T.SUIT_NAMES[suit] + ' ' +
      tiles.map(function (k) { return T.NUM_ZH[T.rankOf(k) - 1]; }).join('') + T.SUIT_ZH[suit];
  }
  function roundText(r) { return T.WIND_NAMES[r] + ' Round ' + T.WIND_ZH[r] + '風'; }
  function fmtNum(x) { return (Math.round(x * 100) / 100).toString(); }
  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'string' && v.trim() !== '') ? +v : v;
    if (!isInt(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function warn(msg, e) { if (typeof console !== 'undefined' && console.error) console.error('HKMJ.Game: ' + msg, e); }

  function mergeSettings(user) {
    var u = (user && typeof user === 'object') ? user : {};
    var out = {};
    Object.keys(u).forEach(function (k) {         // keep extra (UI) keys that are plain JSON
      if (k === 'optional') return;
      try { var v = clone(u[k]); if (v !== undefined) out[k] = v; } catch (e) { /* skip unserialisable */ }
    });
    var d = DEFAULT_SETTINGS;
    out.minFan = clampInt(u.minFan, 0, 13, d.minFan);
    out.payment = (u.payment === 'shared') ? 'shared' : 'full';
    out.unit = (u.unit === 'chips') ? 'chips' : 'points';
    out.rounds = clampInt(u.rounds, 1, 4, d.rounds);
    out.aiLevel = (['easy', 'normal', 'hard'].indexOf(u.aiLevel) >= 0) ? u.aiLevel : d.aiLevel;
    var ss = (typeof u.startingScore === 'string' && u.startingScore.trim() !== '') ? +u.startingScore : u.startingScore;
    out.startingScore = (typeof ss === 'number' && isFinite(ss)) ? ss : d.startingScore;
    out.optional = {};
    var uo = (u.optional && typeof u.optional === 'object') ? u.optional : {};
    Object.keys(d.optional).forEach(function (k) {
      if (k === 'chicken') { out.optional[k] = HKMJ.Hand && HKMJ.Hand.chickenRule ? HKMJ.Hand.chickenRule(uo[k]) : d.optional[k]; return; }
      out.optional[k] = (typeof uo[k] === 'boolean') ? uo[k] : d.optional[k];
    });
    return out;
  }

  function checkWall(w, label) {
    if (!Array.isArray(w) || w.length !== 144) throw new Error(label + ': a wall must be an array of exactly 144 tile kinds');
    var cnt = [];
    for (var k = 0; k < 42; k++) cnt[k] = 0;
    for (var i = 0; i < 144; i++) {
      if (!isInt(w[i]) || w[i] < 0 || w[i] > 41) throw new Error(label + ': bad tile kind at position ' + i + ': ' + w[i]);
      cnt[w[i]]++;
    }
    for (k = 0; k < 42; k++) {
      var want = k < 34 ? 4 : 1;
      if (cnt[k] !== want) throw new Error(label + ': ' + cnt[k] + ' copies of ' + T.code(k) + ' (need ' + want + ')');
    }
  }

  /** Wall positions each player is dealt, in dealing order (p.11: 4-4-4 round the table from the dealer, then 1
   *  each, then the dealer's 14th).  Returns pos[player] = [positions...]. */
  function dealPositions(dealer) {
    var pos = [[], [], [], []];
    var i = 0, r, j, k;
    for (r = 0; r < 3; r++) for (j = 0; j < 4; j++) for (k = 0; k < 4; k++) pos[(dealer + j) % 4].push(i++);
    for (j = 0; j < 4; j++) pos[(dealer + j) % 4].push(i++);
    pos[dealer].push(i++);                         // i === 53 afterwards
    return pos;
  }

  function newPlayer() {
    return { hand: [], melds: [], flowers: [], discards: [], drawn: null, lastAction: null, draws: 0, flowerOffer: false };
  }

  // ------------------------------------------------------------------------------------------------ Game
  function Game(options) {
    options = options || {};
    this._init();
    var rng = HKMJ.RNG(options.seed);
    var names = DEFAULT_NAMES.slice();
    if (Array.isArray(options.names)) {
      for (var i = 0; i < 4; i++) {
        var n = options.names[i];
        if (typeof n === 'string' && n.trim()) names[i] = n.trim();
      }
    }
    var humans = [0];
    if (Array.isArray(options.humans)) {
      humans = [];
      options.humans.forEach(function (h) { if (isSeat(h) && humans.indexOf(h) < 0) humans.push(h); });
      sortNum(humans);
    }
    var presets = null;
    if (options.presetWalls != null) {
      if (!Array.isArray(options.presetWalls)) throw new Error('HKMJ.Game: presetWalls must be an array of walls');
      presets = options.presetWalls.map(function (w, idx) {
        if (w == null) return null;
        checkWall(w, 'HKMJ.Game presetWalls[' + idx + ']');
        return w.slice();
      });
    }
    var firstDealer = isSeat(options.firstDealer) ? options.firstDealer : rng.int(4);
    var settings = mergeSettings(options.settings);
    this.c = { seed: rng.seed, settings: settings, names: names, humans: humans, presetWalls: presets };
    this.rng = rng;
    this.seed = rng.seed;
    var st = settings.startingScore;
    this.s = {
      phase: 'idle', seq: 0,
      firstDealer: firstDealer, dealer: firstDealer, round: 0, dealerRepeat: 0, handNo: 0, scores: [st, st, st, st],
      wall: [], dice: [0, 0, 0],
      players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()],
      turn: firstDealer, afterClaim: false, kongChain: 0, discardCount: 0, interrupted: false,
      lastDiscard: null, claim: null, result: null, standings: null, log: []
    };
  }

  Game.prototype._init = function () {
    this._listeners = [];
    this._queue = [];
    this._flushing = false;
    this._busy = false;
    this._cache = null;
    this._evalErrors = 0;
  };

  // ------------------------------------------------------------------------------------------------ public API
  Game.prototype.start = function () {
    if (this.s.phase !== 'idle') return { ok: false, error: 'The game has already started' };
    return this._run(function () { this._startHand(); });
  };

  Game.prototype.getPending = function () {
    var s = this.s;
    switch (s.phase) {
      case 'turn': return { type: 'turn', player: s.turn, afterClaim: !!s.afterClaim };
      case 'claim':
      case 'robKong': return { type: s.phase, tile: s.claim.tile, from: s.claim.from, waiting: this._waiting() };
      case 'handEnd': return { type: 'handEnd', result: clone(s.result) };
      case 'gameEnd': return { type: 'gameEnd', standings: clone(s.standings) };
      default: return null;
    }
  };

  Game.prototype.getActions = function (p) {
    if (!isSeat(p)) return [];
    var s = this.s;
    if (s.phase === 'turn') return p === s.turn ? clone(this._turnInfo().acts) : [];
    if (s.phase === 'claim' || s.phase === 'robKong') {
      return this._waiting().indexOf(p) >= 0 ? clone(s.claim.options[p]) : [];
    }
    return [];
  };

  Game.prototype.act = function (p, action) {
    return this._run(function () {
      var v = this._validate(p, action);
      if (v.error) return { ok: false, error: v.error };
      this._apply(p, v.match);
      return { ok: true };
    });
  };

  Game.prototype.nextHand = function () {
    var ph = this.s.phase;
    if (ph === 'gameEnd') return { ok: false, error: 'The game is over' };
    if (ph !== 'handEnd') return { ok: false, error: ph === 'idle' ? 'The game has not started — call start()' : 'The hand is still in progress' };
    return this._run(function () {
      var s = this.s, r = s.result;
      if (r.gameOver) {
        s.phase = 'gameEnd'; s.seq++;
        s.standings = this._standings();
        this._log('game', 'Game over — ' + s.standings.map(function (e) { return e.rank + '. ' + e.name + ' ' + fmtNum(e.score); }).join(', '));
        this._emit({ type: 'gameEnd', standings: clone(s.standings) });
        return;
      }
      if (r.dealerStays) s.dealerRepeat++;
      else { s.dealer = r.nextDealer; s.round = r.nextRound; s.dealerRepeat = 0; }
      this._startHand();
    });
  };

  Game.prototype.on = function (fn) {
    var self = this;
    if (typeof fn !== 'function') return function () {};
    this._listeners.push(fn);
    return function () { var i = self._listeners.indexOf(fn); if (i >= 0) self._listeners.splice(i, 1); };
  };

  Game.prototype.serialize = function () {
    return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, config: this.c, state: this.s, rng: this.rng.getState() });
  };

  Game.deserialize = function (json) {
    var data = (typeof json === 'string') ? JSON.parse(json) : clone(json);
    if (!data || data.format !== SAVE_FORMAT) throw new Error('HKMJ.Game.deserialize: not a saved HK Mahjong game');
    if (data.version !== SAVE_VERSION) throw new Error('HKMJ.Game.deserialize: unsupported save version ' + data.version);
    var c = data.config, s = data.state;
    try {
      if (!c || !s || !Array.isArray(s.players) || s.players.length !== 4 || PHASES.indexOf(s.phase) < 0 ||
          !Array.isArray(s.wall) || !Array.isArray(s.scores) || !c.settings || !c.settings.optional || !Array.isArray(c.names) ||
          ((s.phase === 'claim' || s.phase === 'robKong') && !s.claim) || ((s.phase === 'handEnd' || s.phase === 'gameEnd') && !s.result)) {
        throw new Error('missing fields');
      }
      if (s.phase !== 'idle') {                      // every one of the 144 tiles must be somewhere
        var all = s.wall.slice();
        s.players.forEach(function (P) {
          all = all.concat(P.hand, P.flowers, P.discards);
          P.melds.forEach(function (m) { all = all.concat(m.tiles); });
        });
        checkWall(all, 'tiles');
      }
    } catch (e) {
      throw new Error('HKMJ.Game.deserialize: the saved game is incomplete or corrupted (' + e.message + ')');
    }
    var g = Object.create(Game.prototype);
    g._init();
    g.c = c;
    g.s = s;
    g.seed = c.seed;
    g.rng = HKMJ.RNG.fromState(isInt(data.rng) ? data.rng : 0);
    return g;
  };

  /** Test helper (SPEC §5.1): build a 144-tile wall.
   *  spec.hands[i]   starting tiles of PLAYER i (array of kinds or notation; the dealer's has 14, others 13, before
   *                  bonus replacement), in dealing order — e.g. the dealer's 14th entry is the tile dealt last.
   *                  Shorter hands / null entries are filled randomly with non-bonus tiles.
   *  spec.draws      live-wall draws after the deal, in order (null entries = random).
   *  spec.replacements  back-of-wall tiles in the order they will be drawn (null entries = random).
   *  spec.dealer     optional; otherwise the player whose hand has 14 entries (default 0).
   *  Everything else is filled randomly with rng (default a fixed seed).  Throws on impossible specs. */
  Game.buildWall = function (spec, rng) {
    spec = spec || {};
    rng = rng || HKMJ.RNG(1);
    function list(x, label) {
      if (x == null) return [];
      if (typeof x === 'string') return T.parse(x);
      if (!Array.isArray(x)) throw new Error('buildWall: ' + label + ' must be an array or notation string');
      return x.map(function (k) {
        if (k == null) return null;
        if (typeof k === 'string') { var p = T.parse(k); if (p.length !== 1) throw new Error('buildWall: bad tile "' + k + '"'); return p[0]; }
        if (!isInt(k) || k < 0 || k > 41) throw new Error('buildWall: bad tile kind ' + k);
        return k;
      });
    }
    var hands = [0, 1, 2, 3].map(function (i) { return list(spec.hands && spec.hands[i], 'hands[' + i + ']'); });
    var dealer = isSeat(spec.dealer) ? spec.dealer : -1;
    if (dealer < 0) { for (var i = 0; i < 4; i++) if (hands[i].length === 14) { dealer = i; break; } }
    if (dealer < 0) dealer = 0;
    var pos = dealPositions(dealer);
    var wall = new Array(144), fixed = new Array(144);
    var avail = [];
    for (var k = 0; k < 42; k++) avail[k] = k < 34 ? 4 : 1;
    function put(at, kind, label) {
      if (kind == null) return;
      if (fixed[at]) throw new Error('buildWall: ' + label + ' overlaps another specified tile at wall position ' + at);
      if (--avail[kind] < 0) throw new Error('buildWall: too many copies of ' + T.code(kind));
      wall[at] = kind; fixed[at] = true;
    }
    for (var p = 0; p < 4; p++) {
      if (hands[p].length > pos[p].length) throw new Error('buildWall: hands[' + p + '] has ' + hands[p].length + ' tiles, max ' + pos[p].length);
      for (i = 0; i < hands[p].length; i++) put(pos[p][i], hands[p][i], 'hands[' + p + ']');
    }
    var draws = list(spec.draws, 'draws'), reps = list(spec.replacements, 'replacements');
    if (53 + draws.length + reps.length > 144) throw new Error('buildWall: draws + replacements do not fit in the wall');
    for (i = 0; i < draws.length; i++) put(53 + i, draws[i], 'draws');
    for (i = 0; i < reps.length; i++) put(143 - i, reps[i], 'replacements');
    var rest = [];
    for (k = 0; k < 42; k++) for (var c = 0; c < avail[k]; c++) rest.push(k);
    rng.shuffle(rest);
    var plain = rest.filter(function (x) { return !T.isBonus(x); });
    var bonus = rest.filter(T.isBonus);
    var handSlot = new Array(144);
    for (p = 0; p < 4; p++) pos[p].forEach(function (at) { handSlot[at] = true; });
    for (i = 0; i < 53; i++) if (!fixed[i]) wall[i] = plain.shift();   // random hand fill: never bonus tiles
    var tail = rng.shuffle(plain.concat(bonus));
    for (i = 53; i < 144; i++) if (!fixed[i]) wall[i] = tail.shift();
    checkWall(wall, 'buildWall');
    return wall;
  };

  // ------------------------------------------------------------------------------------------------ view model
  Game.prototype.getView = function (viewer, opts) {
    var s = this.s, c = this.c;
    var v = isSeat(viewer) ? viewer : -1;
    var revealAll = !!(opts && opts.revealAll);
    var ended = s.phase === 'handEnd' || s.phase === 'gameEnd';
    var reveal = revealAll || ended;
    var players = [];
    for (var i = 0; i < 4; i++) {
      var P = s.players[i];
      players.push({
        index: i, name: c.names[i], isHuman: c.humans.indexOf(i) >= 0,
        seatWind: (i - s.dealer + 4) % 4, isDealer: i === s.dealer, score: s.scores[i],
        handCount: P.hand.length,
        hand: (i === v || reveal) ? P.hand.slice() : null,
        drawn: ((i === v || revealAll) && P.drawn !== null && P.drawn !== undefined) ? P.drawn : null,
        melds: P.melds.map(copyMeld),
        flowers: P.flowers.slice(),
        discards: P.discards.slice(),
        lastAction: P.lastAction || null
      });
    }
    var inClaim = (s.phase === 'claim' || s.phase === 'robKong') && s.claim;
    var logTail = s.log.slice(-LOG_VIEW);
    return {
      viewer: v >= 0 ? v : null,
      handNo: s.handNo, round: s.round, dealer: s.dealer, firstDealer: s.firstDealer, dealerRepeat: s.dealerRepeat,
      dice: s.dice.slice(), wallCount: s.wall.length,
      phase: s.phase,
      turn: s.turn,
      pending: this._pendingFor(v),
      actions: v >= 0 ? this.getActions(v) : [],
      blockedWin: this._blockedFor(v),
      lastDiscard: s.lastDiscard ? { tile: s.lastDiscard.tile, from: s.lastDiscard.from } : null,
      claimTile: inClaim ? { tile: s.claim.tile, from: s.claim.from, kind: s.claim.kind } : null,
      players: players,
      settings: clone(c.settings),
      result: ended ? clone(s.result) : null,
      standings: s.phase === 'gameEnd' ? clone(s.standings) : null,
      log: logTail.map(function (e) { return e.t; }),
      logKinds: logTail.map(function (e) { return e.k; })   // extra: 'hand'|'bonus'|'discard'|'claim'|'kong'|'win'|'draw'|'pay'|'deal'|'game'
    };
  };

  Game.prototype._pendingFor = function (v) {
    var p = this.getPending();
    if (p && (p.type === 'claim' || p.type === 'robKong')) p.waiting = p.waiting.indexOf(v) >= 0 ? [v] : [];
    return p;
  };

  Game.prototype._blockedFor = function (v) {
    var s = this.s;
    if (!isSeat(v)) return null;
    if (s.phase === 'turn' && s.turn === v && !s.afterClaim) return clone(this._turnInfo().blocked);
    if ((s.phase === 'claim' || s.phase === 'robKong') && s.claim && s.claim.blocked && s.claim.blocked[v]) return clone(s.claim.blocked[v]);
    return null;
  };

  /** {shanten, waits:[{tile, left, fan, valid, selfFan, selfValid}], blockedWin}.  fan/valid = winning on a discard,
   *  selfFan/selfValid = by Self-Pick (extra).  Waits are listed when the concealed hand is waiting (13-tile shape). */
  Game.prototype.getHints = function (p) {
    var out = { shanten: null, waits: [], blockedWin: null };
    var s = this.s, c = this.c;
    if (!isSeat(p) || s.phase === 'idle') return out;
    try {
      var P = s.players[p], H = HKMJ.Hand, opt = c.settings.optional;
      // hand.js accepts the meld list as well as a count (then tiles locked in melds are not counted on)
      if (H && H.shanten) out.shanten = H.shanten(P.hand.slice(), P.melds.map(copyMeld), opt);
      var live = s.phase === 'turn' || s.phase === 'claim' || s.phase === 'robKong';
      if (live && H && H.waits && P.hand.length % 3 === 1) {
        var ws = H.waits(P.hand.slice(), P.melds.map(copyMeld), opt) || [];
        for (var i = 0; i < ws.length; i++) {
          var w = ws[i];
          var left = Math.max(0, 4 - this._visibleCount(p, w));
          var hand = P.hand.concat([w]);
          var ed = this._evaluate(this._ctx(p, hand, w, 'discard', {}));
          var es = this._evaluate(this._ctx(p, hand.slice(), w, 'self', {}));
          out.waits.push({ tile: w, left: left, fan: ed ? ed.fan : 0, valid: !!(ed && ed.valid),
            selfFan: es ? es.fan : 0, selfValid: !!(es && es.valid) });
        }
      }
      out.blockedWin = this._blockedFor(p);
    } catch (e) { warn('getHints failed', e); }
    return out;
  };

  Game.prototype._visibleCount = function (p, k) {
    var s = this.s, n = countOf(s.players[p].hand, k);
    s.players.forEach(function (P) {
      n += countOf(P.discards, k);
      P.melds.forEach(function (m) { n += countOf(m.tiles, k); });
    });
    if (s.phase === 'robKong' && s.claim && s.claim.from !== p && s.claim.tile === k) n++;   // the declared Kong tile
    return n;
  };

  // ------------------------------------------------------------------------------------------------ plumbing
  /** Run a state change atomically: on an internal exception the state is restored and {ok:false} returned.
   *  Events raised during the change are delivered afterwards, when the state is consistent. */
  Game.prototype._run = function (fn) {
    if (this._busy) return { ok: false, error: 'The engine is busy (re-entrant call)' };
    var s = this.s, log = s.log, logLen = log.length, qLen = this._queue.length;
    s.log = null;
    var snap = JSON.stringify(s);
    s.log = log;
    var rngState = this.rng.getState();
    var res;
    this._busy = true;
    try {
      res = fn.call(this) || { ok: true };
    } catch (e) {
      warn('internal error', e);
      this.s = JSON.parse(snap);
      log.length = logLen;
      this.s.log = log;
      this.rng = HKMJ.RNG.fromState(rngState);
      this._queue.length = qLen;
      this._cache = null;
      res = { ok: false, error: 'Internal error: ' + ((e && e.message) || String(e)) };
    }
    this._busy = false;
    if (this.s.log.length > LOG_KEEP) this.s.log.splice(0, this.s.log.length - LOG_KEEP);
    this._flush();
    return res;
  };

  Game.prototype._emit = function (ev) { this._queue.push(ev); };

  Game.prototype._flush = function () {
    if (this._flushing) return;
    this._flushing = true;
    try {
      while (this._queue.length) {
        var ev = this._queue.shift();
        var ls = this._listeners.slice();
        for (var i = 0; i < ls.length; i++) {
          try { ls[i](ev); } catch (e) { warn('event listener threw', e); }
        }
      }
    } finally { this._flushing = false; }
  };

  Game.prototype._log = function (kind, text) { this.s.log.push({ k: kind, t: text }); };
  Game.prototype._nm = function (p) { return this.c.names[p]; };
  Game.prototype._isYou = function (p) { return /^you$/i.test(this.c.names[p]); };
  Game.prototype._vb = function (p, base, third) { return this._isYou(p) ? base : (third || base + 's'); };
  Game.prototype._poss = function (p) { return this._isYou(p) ? 'your' : this.c.names[p] + "'s"; };
  Game.prototype._obj = function (p) { return this._isYou(p) ? 'you' : this.c.names[p]; };
  Game.prototype._say = function (p, base, third, rest) { return this._nm(p) + ' ' + this._vb(p, base, third) + (rest ? ' ' + rest : ''); };

  Game.prototype._waiting = function () {
    var c = this.s.claim, out = [];
    if (!c) return out;
    for (var i = 1; i < 4; i++) {
      var q = (c.from + i) % 4;
      if (c.options[q] && !c.responses[q]) out.push(q);
    }
    return out;
  };

  // ------------------------------------------------------------------------------------------------ evaluation
  Game.prototype._ctx = function (p, hand, winTile, source, x) {
    var s = this.s, P = s.players[p], set = this.c.settings;
    return {
      hand: hand, melds: P.melds.map(copyMeld), winTile: (winTile === undefined ? null : winTile), source: source,
      kongReplacement: x.kongReplacement || 0, lastTile: !!x.lastTile,
      seatWind: (p - s.dealer + 4) % 4, roundWind: s.round,
      flowers: P.flowers.slice(), blessing: x.blessing || null, flowerWin: !!x.flowerWin,
      settings: { minFan: set.minFan, optional: clone(set.optional) }
    };
  };

  /** Scoring.evaluate guarded by a cheap shape test; null when the tiles do not form a winning shape.
   *  Never throws (a failure in hand/scoring is reported and treated as "no win"). */
  Game.prototype._evaluate = function (ctx) {
    try {
      var H = HKMJ.Hand;
      if (!ctx.flowerWin && H && typeof H.isWinningShape === 'function' &&
          !H.isWinningShape(ctx.hand.slice(), ctx.melds.map(copyMeld), ctx.settings.optional)) return null;
      var ev = HKMJ.Scoring.evaluate(ctx);
      return (ev && ev.winning) ? ev : null;
    } catch (e) {
      this._evalErrors++;
      warn('hand evaluation failed', e);
      return null;
    }
  };

  /** Flags for a Self-Pick by p in the current turn (SPEC §2.9, §2.10). */
  Game.prototype._selfFlags = function (p) {
    var s = this.s, P = s.players[p], blessing = null;
    if (p === s.dealer) {
      if (s.discardCount === 0 && !s.interrupted) blessing = 'heaven';          // dealer's opening 14, no Kong yet
    } else if (P.draws === 1 && s.kongChain === 0 && !s.interrupted) {
      blessing = 'man';                                                         // non-dealer's first draw, nobody claimed
    }
    return { kongReplacement: Math.min(s.kongChain, 2), lastTile: s.wall.length === 0, blessing: blessing };
  };

  /** Flags for p winning on the current discard from `from`. */
  Game.prototype._discardFlags = function (p, from) {
    var s = this.s;
    var earth = s.discardCount === 1 && from === s.dealer && p !== s.dealer;   // the dealer's first discard
    return { kongReplacement: 0, lastTile: s.wall.length === 0, blessing: earth ? 'earth' : null };
  };

  Game.prototype._evalSelf = function (p) {
    var P = this.s.players[p];
    if (P.hand.length % 3 !== 2) return null;
    var winTile = (P.drawn !== null && P.drawn !== undefined) ? P.drawn : P.hand[P.hand.length - 1];
    return this._evaluate(this._ctx(p, P.hand.slice(), winTile, 'self', this._selfFlags(p)));
  };

  Game.prototype._evalFlowers = function (p) {
    var P = this.s.players[p];
    return this._evaluate(this._ctx(p, P.hand.slice(), null, 'self', { flowerWin: true }));
  };

  /** Everything p may do in the current turn, computed once per decision point. */
  Game.prototype._turnInfo = function () {
    var s = this.s;
    if (this._cache && this._cache.seq === s.seq) return this._cache.info;
    var p = s.turn, P = s.players[p], acts = [], blocked = null, minFan = this.c.settings.minFan;
    if (!s.afterClaim) {
      var ev = this._evalSelf(p);
      if (ev) {
        if (ev.valid) acts.push({ type: 'selfWin', fan: ev.fan, evaluation: ev });
        else blocked = withChicken({ fan: ev.fan, minFan: minFan }, ev);
      }
      if (P.flowerOffer && P.flowers.length >= 7) {
        var fe = this._evalFlowers(p);
        if (fe && fe.valid) acts.push({ type: 'flowerWin', fan: fe.fan, evaluation: fe });
      }
      if (s.wall.length >= 1) {                                        // a Kong needs a replacement tile
        var cnt = T.counts(P.hand), k;
        for (k = 0; k < 34; k++) if (cnt[k] === 4) acts.push({ type: 'concealedKong', tile: k });
        P.melds.forEach(function (m) {
          if (m.type === 'pong' && cnt[m.tiles[0]] > 0) acts.push({ type: 'addKong', tile: m.tiles[0] });
        });
      }
    }
    var seen = {};
    P.hand.forEach(function (t) { if (!seen[t]) { seen[t] = true; acts.push({ type: 'discard', tile: t }); } });
    var info = { acts: acts, blocked: blocked };
    this._cache = { seq: s.seq, info: info };
    return info;
  };

  /** Claim options of q on discard t from `from`: {acts, blocked}. */
  Game.prototype._claimOptionsFor = function (q, t, from) {
    var s = this.s, P = s.players[q], acts = [], blocked = null;
    var finalDiscard = s.wall.length === 0;                             // Moon: only a win may take it
    var ev = this._evaluate(this._ctx(q, P.hand.concat([t]), t, 'discard', this._discardFlags(q, from)));
    if (ev) {
      if (ev.valid) acts.push({ type: 'win', fan: ev.fan, evaluation: ev });
      else blocked = withChicken({ fan: ev.fan, minFan: this.c.settings.minFan, tile: t }, ev);
    }
    if (!finalDiscard) {
      var n = countOf(P.hand, t);
      if (n >= 3) acts.push({ type: 'kong' });                          // wall >= 1 here
      if (n >= 2) acts.push({ type: 'pong' });
      if (q === (from + 1) % 4 && T.isSuit(t)) {                        // chow only from the player on your left
        var r = T.rankOf(t);
        [[-2, -1], [-1, 1], [1, 2]].forEach(function (o) {
          if (r + o[0] < 1 || r + o[1] > 9) return;
          var a = t + o[0], b = t + o[1];
          if (P.hand.indexOf(a) >= 0 && P.hand.indexOf(b) >= 0) acts.push({ type: 'chow', tiles: sortNum([a, b, t]) });
        });
      }
    }
    if (acts.length) acts.push({ type: 'pass' });
    return { acts: acts, blocked: blocked };
  };

  /** Robbing options of q on the tile k being added to a Kong by `from`. */
  Game.prototype._robOptionsFor = function (q, k) {
    var P = this.s.players[q];
    var ev = this._evaluate(this._ctx(q, P.hand.concat([k]), k, 'robKong', {}));
    if (!ev) return { acts: [], blocked: null };
    if (ev.valid) return { acts: [{ type: 'win', fan: ev.fan, evaluation: ev }, { type: 'pass' }], blocked: null };
    return { acts: [], blocked: withChicken({ fan: ev.fan, minFan: this.c.settings.minFan, tile: k }, ev) };
  };

  // ------------------------------------------------------------------------------------------------ validation
  Game.prototype._validate = function (p, action) {
    var s = this.s;
    if (!isSeat(p)) return { error: 'Invalid player: ' + String(p) };
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return { error: 'Invalid action: expected an object like {type:"discard", tile:5}' };
    }
    var type = action.type;
    if (ACTION_TYPES.indexOf(type) < 0) return { error: 'Unknown action type "' + type + '"' };
    if (s.phase === 'idle') return { error: 'The game has not started — call start()' };
    if (s.phase === 'handEnd') return { error: 'The hand is over — call nextHand()' };
    if (s.phase === 'gameEnd') return { error: 'The game is over' };
    var who = this._nm(p), acts;
    if (s.phase === 'turn') {
      if (p !== s.turn) return { error: 'It is not ' + who + "'s turn (waiting for " + this._nm(s.turn) + ')' };
      acts = this._turnInfo().acts;
    } else {
      var c = s.claim;
      if (!c.options[p]) {
        return { error: who + ' has no claim on this ' + (c.kind === 'robKong' ? 'Kong' : 'discard') +
          (p === c.from ? ' (it is ' + this._poss(p) + ' own tile)' : '') };
      }
      if (c.responses[p]) return { error: who + ' has already answered this claim' };
      acts = c.options[p];
    }
    var same = acts.filter(function (a) { return a.type === type; });
    if (!same.length) return { error: this._unavailable(p, type) };
    var k, m;
    if (type === 'discard' || type === 'concealedKong' || type === 'addKong') {
      k = toKind(action.tile);
      if (k === null) return { error: 'Action "' + type + '" needs a tile kind (0-41), got ' + JSON.stringify(action.tile) };
      m = same.filter(function (a) { return a.tile === k; })[0];
      if (!m) {
        if (type === 'discard') return { error: 'Cannot discard ' + tileText(k) + ': it is not in ' + this._poss(p) + ' hand' };
        if (type === 'concealedKong') return { error: 'No concealed Kong of ' + tileText(k) + ': it needs all four tiles in the hand' };
        return { error: 'No added Kong of ' + tileText(k) + ': it needs an exposed Pong of it and the fourth tile in the hand' };
      }
      return { match: m };
    }
    if (type === 'chow') {
      if (!Array.isArray(action.tiles) || action.tiles.length !== 3) return { error: 'A Chow needs tiles: [a, b, c] (the full sequence including the discard)' };
      var ts = action.tiles.map(toKind);
      if (ts.some(function (x) { return x === null; })) return { error: 'A Chow needs three tile kinds, got ' + JSON.stringify(action.tiles) };
      sortNum(ts);
      m = same.filter(function (a) { return a.tiles[0] === ts[0] && a.tiles[1] === ts[1] && a.tiles[2] === ts[2]; })[0];
      if (!m) return { error: 'That Chow is not possible: ' + ts.map(T.code).join(' ') };
      return { match: m };
    }
    return { match: same[0] };
  };

  /** Adds chicken: true only when the chicken-hand table rule (not the minimum) is what blocks the win. */
  function withChicken(o, src) { if (src && (src.chickenBarred || src.chicken)) o.chicken = true; return o; }
  function blockedText(b) {
    return b.chicken ? 'Winning shape, but it is a chicken hand 雞糊 (no Fan of its own) — this table does not allow chicken hands'
      : 'Winning shape, but only ' + b.fan + ' Fan — this table needs ' + b.minFan;
  }
  Game.prototype._unavailable = function (p, type) {
    var s = this.s, info;
    var TURN = ['discard', 'selfWin', 'flowerWin', 'concealedKong', 'addKong'];
    if (s.phase === 'turn') {
      if (TURN.indexOf(type) < 0) return 'Cannot "' + type + '" now: that answers a discard, and it is ' + this._poss(p) + ' turn';
      if (s.afterClaim) return 'After a Chow or Pong you must discard (no win or Kong in the same turn)';
      if (type === 'selfWin') {
        info = this._turnInfo();
        if (info.blocked) return blockedText(info.blocked);
        return 'Self-Pick is not possible: the hand is not complete';
      }
      if (type === 'flowerWin') return 'Seven/Eight Flowers can be declared only right after collecting the 7th or 8th bonus tile';
      if (s.wall.length === 0) return 'A Kong needs at least one tile left in the wall';
      return type === 'concealedKong' ? 'No concealed Kong possible: it needs all four tiles in the hand'
        : 'No added Kong possible: it needs an exposed Pong and its fourth tile in the hand';
    }
    var c = s.claim;
    if (TURN.indexOf(type) >= 0) return 'Cannot "' + type + '" now: waiting for answers to a ' + (c.kind === 'robKong' ? 'Kong' : 'discard');
    if (c.kind === 'robKong') return 'Only a win (Robbing the Kong) or pass is possible on an added Kong';
    if (type === 'win') {
      if (c.blocked && c.blocked[p]) return blockedText(c.blocked[p]);
      return 'This tile does not complete ' + this._poss(p) + ' hand';
    }
    if (s.wall.length === 0) return 'The final discard can only be claimed for a win';
    if (type === 'chow') {
      if (p !== (c.from + 1) % 4) return 'Chow only from the player on your left';
      return 'No Chow possible with this tile';
    }
    if (type === 'kong') return 'A Kong on a discard needs three of the tile in the hand';
    if (type === 'pong') return 'A Pong needs two of the tile in the hand';
    return 'Action "' + type + '" is not available';
  };

  // ------------------------------------------------------------------------------------------------ transitions
  Game.prototype._apply = function (p, m) {
    var s = this.s;
    if (s.phase === 'turn') {
      var P = s.players[p];
      var offered = this._turnInfo().acts.some(function (a) { return a.type === 'flowerWin'; });
      if (offered && m.type !== 'flowerWin') P.flowerOffer = false;          // declined: offered again at the 8th
      switch (m.type) {
        case 'selfWin': this._finishWin(p, 'self', null, this._winTileSelf(p), m.evaluation, this._selfFlags(p), []); return;
        case 'flowerWin': this._finishWin(p, 'flowers', null, null, m.evaluation, { kongReplacement: 0, lastTile: false, blessing: null }, []); return;
        case 'concealedKong': this._concealedKong(p, m.tile); return;
        case 'addKong': this._addKong(p, m.tile); return;
        case 'discard': this._discard(p, m.tile); return;
      }
      throw new Error('unhandled turn action ' + m.type);
    }
    var c = s.claim;
    c.responses[p] = m.type === 'chow' ? { type: 'chow', tiles: m.tiles.slice() } : { type: m.type };
    if (this._waiting().length === 0) this._resolveClaim();
  };

  Game.prototype._winTileSelf = function (p) {
    var P = this.s.players[p];
    return (P.drawn !== null && P.drawn !== undefined) ? P.drawn : P.hand[P.hand.length - 1];
  };

  Game.prototype._setTurn = function (p, afterClaim) {
    var s = this.s;
    s.turn = p; s.afterClaim = !!afterClaim; s.claim = null;
    s.phase = 'turn'; s.seq++;
    if (!afterClaim && this.c.humans.indexOf(p) >= 0) {
      var b = this._turnInfo().blocked;
      if (b) this._emit(withChicken({ type: 'blockedWin', player: p, tile: this._winTileSelf(p), fan: b.fan, minFan: b.minFan }, b));
    }
  };

  Game.prototype._startHand = function () {
    var s = this.s, c = this.c, rng = this.rng;
    s.handNo++;
    s.dice = [rng.int(6) + 1, rng.int(6) + 1, rng.int(6) + 1];
    var preset = c.presetWalls && c.presetWalls[s.handNo - 1];
    s.wall = preset ? preset.slice() : rng.shuffle(T.fullSet());
    s.players = [newPlayer(), newPlayer(), newPlayer(), newPlayer()];
    s.turn = s.dealer; s.afterClaim = false; s.kongChain = 0; s.discardCount = 0; s.interrupted = false;
    s.lastDiscard = null; s.claim = null; s.result = null; s.standings = null;
    var d = s.dealer, w = s.wall, P, p, j, r, k;
    this._emit({ type: 'handStart', handNo: s.handNo, round: s.round, dealer: d, dice: s.dice.slice() });
    this._log('hand', 'Hand ' + s.handNo + ' — ' + roundText(s.round) + ' · ' + this._say(d, 'deal') +
      (s.dealerRepeat ? ' (repeat ' + s.dealerRepeat + ')' : '') + ' · dice ' + s.dice.join('·'));
    // Deal (p.11): four tiles each three times round from the dealer, then one each, then the dealer's 14th.
    for (r = 0; r < 3; r++) for (j = 0; j < 4; j++) for (k = 0; k < 4; k++) s.players[(d + j) % 4].hand.push(w.shift());
    for (j = 0; j < 4; j++) s.players[(d + j) % 4].hand.push(w.shift());
    var fourteenth = w.shift();
    s.players[d].hand.push(fourteenth);
    // Bonus tiles: dealer first, in turn order; each player replaces from the back until none remain.
    var dealerDrawn = T.isBonus(fourteenth) ? null : fourteenth;
    for (j = 0; j < 4; j++) {
      p = (d + j) % 4; P = s.players[p];
      var revealed = [];
      var bonus = P.hand.filter(T.isBonus);
      while (bonus.length) {
        P.hand = P.hand.filter(function (x) { return !T.isBonus(x); });
        for (var b = 0; b < bonus.length; b++) {
          this._collectBonus(p, bonus[b]);
          revealed.push(bonus[b]);
          var rep = w.pop();
          this._emit({ type: 'draw', player: p, replacement: true });
          P.hand.push(rep);
          if (p === d && dealerDrawn === null && !T.isBonus(rep)) dealerDrawn = rep;
        }
        bonus = P.hand.filter(T.isBonus);
      }
      if (p === d && dealerDrawn === null) dealerDrawn = P.hand[P.hand.length - 1];
      sortNum(P.hand);
      if (revealed.length) {
        this._log('bonus', this._say(p, 'reveal', null, revealed.map(tileText).join(', ') + ' and ' +
          this._vb(p, 'draw') + (revealed.length > 1 ? ' replacements' : ' a replacement')));
      }
    }
    s.players[d].drawn = dealerDrawn;
    this._setTurn(d, false);
  };

  Game.prototype._collectBonus = function (p, t) {
    var P = this.s.players[p];
    P.flowers.push(t);
    if (P.flowers.length === 7 || P.flowers.length === 8) P.flowerOffer = true;   // p.9 Seven / Eight Flowers
    this._emit({ type: 'bonus', player: p, tile: t });
  };

  /** p draws (front, or back for a replacement), setting aside bonus tiles.  Returns false if the hand ended. */
  Game.prototype._draw = function (p, fromBack) {
    var s = this.s, P = s.players[p];
    if (!s.wall.length) { this._endDraw('wall'); return false; }
    var t = fromBack ? s.wall.pop() : s.wall.shift();
    if (!fromBack) P.draws++;
    this._emit({ type: 'draw', player: p, replacement: !!fromBack });
    while (T.isBonus(t)) {
      this._collectBonus(p, t);
      this._log('bonus', this._say(p, 'reveal', null, tileText(t) +
        (s.wall.length ? ' and ' + this._vb(p, 'draw') + ' a replacement' : ' — no tile is left to replace it')));
      if (!s.wall.length) {
        if (P.flowerOffer && P.flowers.length >= 7) {
          // The 7th/8th bonus tile was the last tile: the flower win is declared at once (a draw is the only alternative).
          var fe = this._evalFlowers(p);
          if (fe && fe.valid) {
            P.drawn = null;
            this._finishWin(p, 'flowers', null, null, fe, { kongReplacement: 0, lastTile: true, blessing: null }, []);
            return false;
          }
        }
        this._endDraw('wall');
        return false;
      }
      t = s.wall.pop();
      this._emit({ type: 'draw', player: p, replacement: true });
    }
    P.hand.push(t); sortNum(P.hand);
    P.drawn = t;
    return true;
  };

  Game.prototype._nextTurn = function (p) {
    var s = this.s;
    s.turn = p; s.afterClaim = false; s.kongChain = 0; s.claim = null;
    if (this._draw(p, false)) this._setTurn(p, false);
  };

  Game.prototype._discard = function (p, t) {
    var s = this.s, P = s.players[p];
    removeOne(P.hand, t);
    P.discards.push(t);
    P.drawn = null; P.lastAction = null;
    s.afterClaim = false; s.kongChain = 0; s.discardCount++;
    s.lastDiscard = { tile: t, from: p };
    this._emit({ type: 'discard', player: p, tile: t });
    this._log('discard', this._say(p, 'discard', null, tileText(t)));
    this._openClaims('discard', t, p);
  };

  /** After a discard or an added Kong: collect each other player's options; wait for those who have any. */
  Game.prototype._openClaims = function (kind, t, from) {
    var s = this.s, options = {}, blocked = {}, any = false;
    for (var i = 1; i < 4; i++) {
      var q = (from + i) % 4;
      var o = kind === 'discard' ? this._claimOptionsFor(q, t, from) : this._robOptionsFor(q, t);
      if (o.acts.length) { options[q] = o.acts; any = true; }
      if (o.blocked) {
        blocked[q] = withChicken({ fan: o.blocked.fan, minFan: o.blocked.minFan }, o.blocked);
        if (this.c.humans.indexOf(q) >= 0) this._emit(withChicken({ type: 'blockedWin', player: q, tile: t, fan: o.blocked.fan, minFan: o.blocked.minFan }, o.blocked));
      }
    }
    s.turn = from;
    if (any) {
      s.claim = { kind: kind, tile: t, from: from, options: options, responses: {}, blocked: blocked };
      s.phase = kind === 'discard' ? 'claim' : 'robKong';
      s.seq++;
      return;
    }
    s.claim = null;
    if (kind === 'discard') this._noClaim(from);
    else this._completeAddKong(from, t);
  };

  Game.prototype._noClaim = function (from) {
    var s = this.s;
    s.claim = null;
    if (!s.wall.length) { this._endDraw('finalDiscard'); return; }   // the final discard was not won
    this._nextTurn((from + 1) % 4);
  };

  Game.prototype._resolveClaim = function () {
    var s = this.s, c = s.claim;
    var order = [(c.from + 1) % 4, (c.from + 2) % 4, (c.from + 3) % 4];
    var resp = function (q) { return c.responses[q] ? c.responses[q].type : null; };
    var winners = order.filter(function (q) { return resp(q) === 'win'; });
    if (winners.length) {                                               // win beats everything; head bump in turn order
      var w = winners[0];
      var ev = c.options[w].filter(function (a) { return a.type === 'win'; })[0].evaluation;
      if (winners.length > 1) {
        var self = this;
        this._log('claim', 'Head bump 截糊: ' + this._say(w, 'are', 'is') + ' first in turn order after ' + this._obj(c.from) +
          ', ahead of ' + winners.slice(1).map(function (q) { return self._obj(q); }).join(' and '));
      }
      if (c.kind === 'robKong') this._robWin(w, c.from, c.tile, ev, winners.slice(1));
      else this._discardWin(w, c.from, c.tile, ev, winners.slice(1));
      return;
    }
    if (c.kind === 'robKong') { var km = c.from, kt = c.tile; s.claim = null; this._completeAddKong(km, kt); return; }
    var pk = order.filter(function (q) { return resp(q) === 'kong' || resp(q) === 'pong'; })[0];
    if (pk !== undefined) { this._claimMeld(pk, resp(pk), c.tile, c.from, null); return; }
    var ch = order.filter(function (q) { return resp(q) === 'chow'; })[0];
    if (ch !== undefined) { this._claimMeld(ch, 'chow', c.tile, c.from, c.responses[ch].tiles); return; }
    this._noClaim(c.from);
  };

  Game.prototype._takeFromRiver = function (from, t) {
    var D = this.s.players[from];
    var i = D.discards.lastIndexOf(t);
    if (i < 0) throw new Error('claimed tile is not in the river');
    D.discards.splice(i, 1);
  };

  Game.prototype._claimMeld = function (q, type, t, from, tiles) {
    var s = this.s, Q = s.players[q];
    this._takeFromRiver(from, t);
    var meldTiles, i;
    if (type === 'chow') {
      meldTiles = sortNum(tiles.slice());
      var used = meldTiles.slice(); removeOne(used, t);
      used.forEach(function (k) { if (!removeOne(Q.hand, k)) throw new Error('chow tile missing'); });
    } else {
      var n = type === 'kong' ? 3 : 2;
      for (i = 0; i < n; i++) if (!removeOne(Q.hand, t)) throw new Error(type + ' tile missing');
      meldTiles = type === 'kong' ? [t, t, t, t] : [t, t, t];
    }
    Q.melds.push({ type: type, tiles: meldTiles, concealed: false, from: from, claimed: t, added: false });
    s.interrupted = true; s.lastDiscard = null; s.claim = null;
    Q.lastAction = type; Q.drawn = null;
    this._emit({ type: 'claim', player: q, claim: type, tile: t, from: from });
    this._log('claim', type === 'chow' ? this._say(q, 'chow', null, tileText(t) + ' — ' + runText(meldTiles))
      : this._say(q, type, null, tileText(t)));
    s.turn = q; s.kongChain = 0;
    if (type === 'kong') {
      s.kongChain = 1; s.afterClaim = false;
      if (this._draw(q, true)) this._setTurn(q, false);
    } else {
      this._setTurn(q, true);                                          // must discard now
    }
  };

  Game.prototype._concealedKong = function (p, k) {
    var s = this.s, P = s.players[p];
    for (var i = 0; i < 4; i++) if (!removeOne(P.hand, k)) throw new Error('concealed kong tile missing');
    P.melds.push({ type: 'kong', tiles: [k, k, k, k], concealed: true, from: null, claimed: null, added: false });
    s.interrupted = true; s.kongChain++;
    P.lastAction = 'concealedKong'; P.drawn = null;
    this._emit({ type: 'concealedKong', player: p, tile: k });
    this._log('kong', this._say(p, 'declare', null, 'a concealed Kong of ' + tileText(k)));
    if (this._draw(p, true)) this._setTurn(p, false);
  };

  Game.prototype._addKong = function (p, k) {
    this._log('kong', this._say(p, 'add', null, tileText(k) + ' to a Pong to make a Kong'));
    this._openClaims('robKong', k, p);                                  // others may rob it (p.2)
  };

  Game.prototype._completeAddKong = function (p, k) {
    var s = this.s, P = s.players[p];
    if (!removeOne(P.hand, k)) throw new Error('added kong tile missing');
    var m = P.melds.filter(function (x) { return x.type === 'pong' && x.tiles[0] === k; })[0];
    if (!m) throw new Error('added kong without a pong');
    m.type = 'kong'; m.tiles = [k, k, k, k]; m.added = true;
    s.interrupted = true; s.kongChain++; s.turn = p; s.claim = null;
    P.lastAction = 'addKong'; P.drawn = null;
    this._emit({ type: 'addKong', player: p, tile: k });
    if (this._draw(p, true)) this._setTurn(p, false);
  };

  Game.prototype._discardWin = function (w, from, t, ev, bumped) {
    var s = this.s, W = s.players[w];
    this._takeFromRiver(from, t);
    W.hand.push(t); sortNum(W.hand);
    s.lastDiscard = null;
    this._finishWin(w, 'discard', from, t, ev, this._discardFlags(w, from), bumped);
  };

  Game.prototype._robWin = function (w, from, k, ev, bumped) {
    var s = this.s, W = s.players[w], K = s.players[from];
    if (!removeOne(K.hand, k)) throw new Error('robbed tile missing');
    K.drawn = null;
    W.hand.push(k); sortNum(W.hand);
    this._emit({ type: 'robKong', player: w, from: from, tile: k });
    this._log('win', this._say(w, 'rob', null, 'the Kong on ' + tileText(k) + ' 搶槓'));
    this._finishWin(w, 'robKong', from, k, ev, { kongReplacement: 0, lastTile: false, blessing: null }, bumped);
  };

  // ------------------------------------------------------------------------------------------------ hand end
  Game.prototype._outcome = function (winner) {
    var s = this.s;
    var stays = (winner === null) || winner === s.dealer;               // p.11: East keeps the deal after a win or a draw
    var nextDealer = stays ? s.dealer : (s.dealer + 1) % 4;
    var nextRound = s.round + ((!stays && nextDealer === s.firstDealer) ? 1 : 0);
    return { dealerStays: stays, nextDealer: nextDealer, nextRound: nextRound,
      gameOver: nextRound >= this.c.settings.rounds || s.handNo >= MAX_HANDS };
  };

  Game.prototype._handsSnapshot = function () {
    return this.s.players.map(function (P) { return { hand: P.hand.slice(), melds: P.melds.map(copyMeld), flowers: P.flowers.slice() }; });
  };

  Game.prototype._finishWin = function (w, source, payer, winTile, ev, flags, bumped) {
    var s = this.s, set = this.c.settings, self = this;
    ev = clone(ev);
    var pay = HKMJ.Scoring.payments({ fan: ev.fan, winner: w, source: source === 'flowers' ? 'self' : source,
      payer: payer, payment: set.payment, unit: set.unit });
    if (!Array.isArray(pay) || pay.length !== 4) throw new Error('Scoring.payments returned ' + JSON.stringify(pay));
    for (var i = 0; i < 4; i++) s.scores[i] += pay[i];
    s.players[w].lastAction = source === 'self' ? 'selfWin' : (source === 'flowers' ? 'flowerWin' : 'win');
    var o = this._outcome(w);
    var result = {
      type: 'win', handNo: s.handNo, round: s.round, dealer: s.dealer, winner: w, payer: payer, source: source,
      winTile: winTile, evaluation: ev, payments: pay.slice(), scoresAfter: s.scores.slice(), hands: this._handsSnapshot(),
      dealerStays: o.dealerStays, nextDealer: o.nextDealer, nextRound: o.nextRound, gameOver: o.gameOver,
      // extras for the UI / tests
      fan: ev.fan, dealerRepeat: s.dealerRepeat, seatWind: (w - s.dealer + 4) % 4,
      flags: { kongReplacement: flags.kongReplacement || 0, lastTile: !!flags.lastTile, blessing: flags.blessing || null },
      bumped: (bumped || []).slice(), reason: null
    };
    s.result = result; s.claim = null;
    s.phase = 'handEnd'; s.seq++;
    var fanText = ev.fan + ' Fan' + (ev.fan >= 13 ? ' (limit)' : '');
    var BLESS = { heaven: 'Blessing of Heaven 天糊', earth: 'Blessing of Earth 地糊', man: 'Blessing of Man 人糊' };
    var how;
    if (source === 'self') how = 'by Self-Pick' + (flags.blessing ? ' — ' + BLESS[flags.blessing] : '');
    else if (source === 'discard') how = 'on ' + this._poss(payer) + ' discard, ' + tileText(winTile) + (flags.blessing ? ' — ' + BLESS[flags.blessing] : '');
    else if (source === 'robKong') how = 'by Robbing the Kong';
    else how = 'with ' + (s.players[w].flowers.length >= 8 ? 'Eight Flowers 大花糊' : 'Seven Flowers 花糊');
    this._log('win', this._say(w, 'win', null, how + ' — ' + fanText));
    this._log('pay', 'Payments: ' + pay.map(function (x, j) { return x ? self._nm(j) + ' ' + (x > 0 ? '+' : '') + fmtNum(x) : null; })
      .filter(Boolean).join(', '));
    this._logNext(o);
    this._emit({ type: 'win', player: w, result: clone(result) });
    this._emit({ type: 'handEnd', result: clone(result) });
  };

  Game.prototype._endDraw = function (reason) {
    var s = this.s;
    var o = this._outcome(null);
    var result = {
      type: 'draw', handNo: s.handNo, round: s.round, dealer: s.dealer, winner: null, payer: null, source: null,
      winTile: null, evaluation: null, payments: [0, 0, 0, 0], scoresAfter: s.scores.slice(), hands: this._handsSnapshot(),
      dealerStays: o.dealerStays, nextDealer: o.nextDealer, nextRound: o.nextRound, gameOver: o.gameOver,
      fan: 0, dealerRepeat: s.dealerRepeat, seatWind: null, flags: null, bumped: [],
      reason: reason                                                   // 'wall' (nothing left to draw) | 'finalDiscard'
    };
    s.result = result; s.claim = null;
    s.players.forEach(function (P) { P.drawn = null; });
    s.phase = 'handEnd'; s.seq++;
    this._log('draw', 'Draw game 流局 — ' + (reason === 'finalDiscard' ? 'nobody won the final discard' : 'the wall is exhausted'));
    this._logNext(o);
    this._emit({ type: 'drawGame', result: clone(result) });
    this._emit({ type: 'handEnd', result: clone(result) });
  };

  Game.prototype._logNext = function (o) {
    var s = this.s;
    if (o.gameOver) { this._log('deal', 'That was the last hand of the game.'); return; }
    if (o.dealerStays) { this._log('deal', this._nm(s.dealer) + ' ' + this._vb(s.dealer, 'keep') + ' the deal.'); return; }
    this._log('deal', 'The deal passes to ' + this._obj(o.nextDealer) + '.' +
      (o.nextRound !== s.round ? ' ' + roundText(o.nextRound) + ' begins.' : ''));
  };

  Game.prototype._standings = function () {
    var s = this.s, c = this.c;
    var arr = [0, 1, 2, 3].map(function (i) { return { index: i, name: c.names[i], score: s.scores[i], rank: 0 }; });
    arr.sort(function (a, b) { return (b.score - a.score) || (a.index - b.index); });
    arr.forEach(function (e, i) { e.rank = (i > 0 && Math.abs(e.score - arr[i - 1].score) < 1e-9) ? arr[i - 1].rank : i + 1; });
    return arr;
  };

  Game.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  Game.MAX_HANDS = MAX_HANDS;
  Game.dealPositions = dealPositions;
  HKMJ.Game = Game;
  HKMJ.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
