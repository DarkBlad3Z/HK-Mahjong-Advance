/* TEMPORARY STAND-IN for src/core/ai.js (used only by tests while the real module is missing).
 * Greedy: take any win, otherwise discard to minimise shanten; pong/kong when it does not hurt.  Never bundled. */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  function decide(view, actions, opts) {
    var rng = (opts && opts.rng) || HKMJ.RNG(7);
    var H = HKMJ.Hand, me = view.players[view.viewer], opt = view.settings.optional;
    for (var i = 0; i < actions.length; i++) {
      var t = actions[i].type;
      if (t === 'selfWin' || t === 'win' || t === 'flowerWin') return actions[i];
    }
    var disc = actions.filter(function (a) { return a.type === 'discard'; });
    if (disc.length) {
      var kong = actions.filter(function (a) { return a.type === 'concealedKong' || a.type === 'addKong'; });
      if (kong.length && rng.next() < 0.7) return kong[0];
      var best = null, bestSh = 99;
      disc.forEach(function (a) {
        var h = me.hand.slice(); h.splice(h.indexOf(a.tile), 1);
        var sh = H.shanten(h, me.melds.length, opt) + rng.next() * 0.5;
        if (sh < bestSh) { bestSh = sh; best = a; }
      });
      return best;
    }
    var claim = actions.filter(function (a) { return a.type === 'kong' || a.type === 'pong'; });
    if (claim.length && rng.next() < 0.5) return claim[0];
    var chow = actions.filter(function (a) { return a.type === 'chow'; });
    if (chow.length && rng.next() < 0.3) return chow[0];
    return actions.filter(function (a) { return a.type === 'pass'; })[0] || actions[0];
  }
  HKMJ.AI = { decide: decide, suggest: function (v, a) { return { action: decide(v, a, {}), reason: 'stub' }; }, _stub: true };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
