/* HK Mahjong — core/rng.js
 * Small seeded PRNG (mulberry32) so games, tests and simulations are reproducible.
 *   var r = HKMJ.RNG(12345);  r.next() -> [0,1)   r.int(n) -> 0..n-1   r.shuffle(arr) (in place, returns arr)
 *   r.getState() -> uint32 ;  HKMJ.RNG.fromState(uint32) -> generator continuing from that state (for save/resume)
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});

  function hashSeed(seed) {
    if (seed === undefined || seed === null) return (Date.now() ^ 0x9E3779B9) >>> 0;
    if (typeof seed === 'string') {
      var h = 2166136261;
      for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    return seed >>> 0;
  }

  function make(state) {
    var s = state >>> 0;
    function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function int(n) { return Math.floor(next() * n); }
    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) { var j = int(i + 1); var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
      return a;
    }
    function pick(a) { return a[int(a.length)]; }
    function getState() { return s >>> 0; }
    return { next: next, int: int, shuffle: shuffle, pick: pick, getState: getState };
  }

  function RNG(seed) {
    var r = make(hashSeed(seed));
    r.seed = r.getState();
    return r;
  }
  RNG.fromState = function (state) { var r = make(state); r.seed = null; return r; };

  HKMJ.RNG = RNG;
  if (typeof module !== 'undefined' && module.exports) module.exports = RNG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
