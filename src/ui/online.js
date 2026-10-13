/* HK Mahjong — src/ui/online.js
 * HKMJ.Online: the optional online scoreboard (a Google Apps Script web app writing to a Google Sheet, see
 * server/scoreboard.gs and SCOREBOARD-SETUP.md). Sign in / create account, record each hand a signed-in player wins
 * and each game they finish, and fetch the leaderboard.
 *
 * The scoreboard is switched on by putting the web-app URL in index.html (window.HKMJ_SCOREBOARD_URL). With no URL,
 * or no network (the Cowork preview), everything here quietly does nothing and the game plays as before.
 *
 * Passwords are never sent or stored as typed: the game sends SHA-256("hkmj:" + lower-case name + ":" + password),
 * and the server salts and hashes that again. Records wait in a local outbox until the server confirms them, so a
 * dropped connection does not lose a win.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var SESSION_KEY = 'hkmj.session.v1', OUTBOX_KEY = 'hkmj.outbox.v1', MAX_OUTBOX = 300;
  var URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;

  // ------------------------------------------------------------------ SHA-256 (pure JS, so it works without crypto.subtle)
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function utf8Bytes(s) {
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {          // surrogate pair -> one code point
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(text) {
    var b = utf8Bytes(String(text)), bits = b.length * 8, i, t;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    for (var off = 0; off < b.length; off += 64) {
      for (t = 0; t < 16; t++) w[t] = (b[off + 4 * t] << 24) | (b[off + 4 * t + 1] << 16) | (b[off + 4 * t + 2] << 8) | b[off + 4 * t + 3];
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }

  // ------------------------------------------------------------------ storage (never let storage break the game)
  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function read(key, dflt) {
    try { var s = store(), v = s && s.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function write(key, v) {
    try { var s = store(); if (!s) return; if (v === null || v === undefined) s.removeItem(key); else s.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ config + transport
  function url() {
    var u = String(root.HKMJ_SCOREBOARD_URL || '').trim();
    return URL_RE.test(u) ? u : '';
  }
  function available() { return !!url() && typeof root.fetch === 'function'; }
  function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function passwordHash(name, password) { return sha256('hkmj:' + cleanName(name).toLowerCase() + ':' + String(password)); }

  function parse(r) {
    return r.text().then(function (txt) {
      try { return JSON.parse(txt); } catch (e) { throw new Error('The scoreboard sent an unexpected reply.'); }
    });
  }
  // A text/plain POST is a "simple" request, so the browser sends it to Apps Script without a CORS preflight.
  function post(body) {
    if (!available()) return Promise.reject(new Error('The online scoreboard is not set up.'));
    return root.fetch(url(), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } }).then(parse);
  }
  function get(params) {
    if (!available()) return Promise.reject(new Error('The online scoreboard is not set up.'));
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return root.fetch(url() + '?' + q).then(parse);
  }
  function friendly(err) {
    var m = err && err.message ? err.message : String(err);
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Could not reach the scoreboard. Check your internet connection and try again.';
    return m;
  }

  // ------------------------------------------------------------------ session
  var listeners = [];
  function changed() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); }
  function session() { var s = read(SESSION_KEY, null); return s && s.username && s.pw ? s : null; }
  function user() { var s = session(); return s ? s.username : null; }

  /** mode 'login' or 'register'. Resolves with the canonical username; rejects with a readable Error. */
  function signIn(mode, name, password) {
    name = cleanName(name);
    if (!name) return Promise.reject(new Error('Please enter your name.'));
    if (!password) return Promise.reject(new Error('Please enter your password.'));
    var pw = passwordHash(name, password);
    return post({ action: mode === 'register' ? 'register' : 'login', username: name, pw: pw }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Sign-in failed.');
      write(SESSION_KEY, { username: res.username, pw: pw });
      changed();
      flush();
      return res.username;
    }, function (err) { throw new Error(friendly(err)); });
  }
  function signOut() { write(SESSION_KEY, null); changed(); }

  // ------------------------------------------------------------------ records + outbox
  function outbox() { var b = read(OUTBOX_KEY, []); return Array.isArray(b) ? b : []; }
  function enqueue(item) {
    var s = session(); if (!s) return false;
    var box = outbox();
    item.user = s.username;
    box.push(item);
    if (box.length > MAX_OUTBOX) box = box.slice(-MAX_OUTBOX);
    write(OUTBOX_KEY, box);
    return true;
  }
  var flushing = null, again = false, lastError = null;
  /** Sends the signed-in player's queued records one by one; keeps them on network errors, drops ones the server rejects.
   *  A record an older scoreboard script doesn't know yet (such as 'hand' before version 2) stays queued for later. */
  function flush() {
    if (flushing) { again = true; return flushing; }   // run once more when the current pass ends
    var s = session();
    if (!available() || !s) return Promise.resolve(0);
    var sent = 0, later = {};
    function next() {
      var box = outbox(), idx = -1;
      for (var i = 0; i < box.length; i++) if (box[i].user === s.username && !later[box[i].id]) { idx = i; break; }
      if (idx < 0) return Promise.resolve(sent);
      var item = box[idx], body = {};
      Object.keys(item).forEach(function (k) { if (k !== 'user') body[k] = item[k]; });
      body.username = s.username; body.pw = s.pw;
      return post(body).then(function (res) {
        if (res && res.auth === false) { lastError = 'Please sign in again to save your scores.'; signOut(); return sent; }
        if (res && res.ok === false && /^Unknown request/.test(String(res.error || ''))) { later[item.id] = true; return next(); }
        var now = outbox(), j = -1;
        for (var k = 0; k < now.length; k++) if (now[k].id === item.id) { j = k; break; }
        if (j >= 0) { now.splice(j, 1); write(OUTBOX_KEY, now); }
        if (res && res.ok) sent++;
        lastError = null;
        return next();
      });
    }
    flushing = next().catch(function (err) { lastError = friendly(err); return sent; }).then(function (n) {
      flushing = null;
      if (again) { again = false; return flush().then(function (m) { return n + m; }); }
      return n;
    });
    return flushing;
  }
  var seq = 0;
  function record(action, rec) {
    var item = { action: action, id: Date.now().toString(36) + '-' + (seq++) };
    Object.keys(rec || {}).forEach(function (k) { item[k] = rec[k]; });
    if (!enqueue(item)) return Promise.resolve(0);
    return flush();
  }
  function recordWin(rec) { return record('win', rec); }
  function recordHand(rec) { return record('hand', rec); }
  function recordGame(rec) { return record('game', rec); }

  function leaderboard() {
    var s = session();
    return get({ action: 'leaderboard', player: s ? s.username : '' }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'The scoreboard could not be loaded.');
      return res;
    }, function (err) { throw new Error(friendly(err)); });
  }

  HKMJ.Online = {
    available: available, url: url, user: user, signIn: signIn, signOut: signOut,
    recordWin: recordWin, recordHand: recordHand, recordGame: recordGame, flush: flush, leaderboard: leaderboard,
    pending: function () { var u = user(); return outbox().filter(function (i) { return i.user === u; }).length; },
    lastError: function () { return lastError; },
    onChange: function (fn) { listeners.push(fn); },
    _sha256: sha256, _passwordHash: passwordHash
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Online;
})(typeof globalThis !== 'undefined' ? globalThis : this);
