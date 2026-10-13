# HK Mahjong — Game Specification (rules, scoring, architecture, API contract)

Owner: orchestrator (Opus 5.5). Source of truth for rules: the booklet
the booklet "HK Mahjong Scoring Sheet v1.0" (Sep 25 2026, expanded by V. Nguyen).
Page numbers below (p.N) are the booklet's printed page numbers. **Where this spec and the booklet disagree, the
booklet wins — report the conflict, do not silently pick.** Where the booklet is silent, this spec decides.

Product: a single self-contained HTML file — Hong Kong Mahjong, 1 human vs 3 computer players, scored exactly as the booklet.

---------------------------------------------------------------------------------------------------------------
## 0. Project layout, paths, conventions

Node 18+ runs the build and tests; there are no dependencies (no npm install).

```
hk-mahjong-src/
  SPEC.md, UI_SPEC.md          specs (orchestrator)
  build.js                     bundles everything into index.html (orchestrator)
  src/core/tiles.js            tile model + notation parser (orchestrator, DONE — do not change kind ids)
  src/core/rng.js              seeded PRNG (orchestrator, DONE)
  src/core/hand.js             hand analysis: decompositions, win shapes, shanten, waits   (back end)
  src/core/scoring.js          Fan scoring per booklet, feature catalogue, payments         (back end)
  src/core/engine.js           game state machine                                           (back end)
  src/core/ai.js               computer players                                              (back end)
  src/ui/...                   UI (see UI_SPEC.md)                                           (UI)
  tests/pdf_vectors.js         booklet acceptance vectors (orchestrator — do not edit expectations)
  tests/run_vectors.js         vector runner (orchestrator)
  tests/*.test.js              back-end unit / scenario / simulation tests                  (back end)
```

Module pattern (every JS file): a plain IIFE that attaches to `globalThis.HKMJ` and also sets `module.exports` when
available, so the same file runs in Node tests and in the browser bundle. No imports, no dependencies, no build step
beyond concatenation. Plain ES2017 is fine. Load order: tiles, rng, hand, scoring, engine, ai, then UI files.

```js
(function (root) { 'use strict'; var HKMJ = root.HKMJ || (root.HKMJ = {}); /* ... */ HKMJ.Hand = {...};
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.Hand;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Core modules must be pure logic: no DOM, no timers, no `Math.random` (use `HKMJ.RNG`), deterministic for a seed.

---------------------------------------------------------------------------------------------------------------
## 1. Tiles (src/core/tiles.js — done)

Kinds 0-8 萬 Characters 1-9, 9-17 筒 Dots, 18-26 索 Sticks, 27-30 winds 東南西北, 31-33 dragons 中 發 白,
34-37 flowers 梅蘭菊竹 (1-4), 38-41 seasons 春夏秋冬 (1-4). 144 physical tiles (4 of each 0-33, one of each 34-41).
Helpers: `isSuit suitOf rankOf isHonour isWind isDragon isBonus isFlower isSeason bonusNumber isTerminal
isTerminalOrHonour tileOf windKind windIndex dragonIndex name zh code parse format sort fullSet counts`.
Notation: `"123m 456p 789s 東東東 中中"`, honours also `1z..7z` (東南西北中發白), flowers `1234f`, seasons `1234x`.

---------------------------------------------------------------------------------------------------------------
## 2. Rules of play

### 2.1 Seats, winds, turn order (p.11)
* Players are indices 0..3, fixed for the whole game. **0 = the human, drawn at the bottom of the screen.**
* Turn order is 0 → 1 → 2 → 3 → 0 (counter-clockwise seen from above; player 1 sits on the human's right, 2 opposite,
  3 on the left). "After a discard, play passes to the player on the discarder's right" = `(p + 1) % 4`.
* **Chow only from the player on your left** = the previous player `(p + 3) % 4` = the discarder must be `(claimer+3)%4`.
  Pong and Kong may be claimed from anyone.
* Seat wind: `seatWind(p) = (p - dealer + 4) % 4` (0 East … 3 North). The dealer is always East.
  Seat number for flowers/seasons = seatWind + 1 (East 1, South 2, West 3, North 4).
* Round wind `round` 0..3 (East, South, West, North).

### 2.2 Game structure
* `settings.rounds`: 4 = full game E→S→W→N (booklet: "A game runs four rounds"), 1 = East round only.
* `firstDealer` is chosen by the seeded RNG unless `options.firstDealer` is given.
* After each hand: if the dealer won, or the hand was a draw → the dealer keeps the deal (`dealerRepeat++`).
  Otherwise the deal passes to `(dealer + 1) % 4` ("to the player on East's right", p.11).
  When the deal passes back to `firstDealer`, the round wind advances. After the last round completes → game over.
* Safety cap: at most 300 hands per game (then game over) — only to stop pathological loops in simulations.

### 2.3 Wall, dice, deal, bonus tiles
* 144 tiles shuffled with the game RNG (or a preset wall, see §5.3). Normal draws come from the **front** of the live
  wall; replacement tiles (after a Kong or a bonus tile) come from the **back** ("draw a Replacement Tile from the
  dead end of the wall", p.12). There is no reserved dead wall: every tile can be drawn.
* Dice: roll three d6 per hand for display only (`dice: [a,b,c]`); no gameplay effect.
* Deal (p.11): East takes 4, then S, W, N — three times round — then 1 each, then East takes one more: East 14, others 13.
  Implement exactly this order from the front of the wall (it matters for preset walls).
* Bonus tiles (flowers/seasons): after the deal, starting with the dealer and going in turn order, each player sets
  aside every bonus tile in hand and draws replacements from the back, repeating until none remain.
  During play, a bonus tile drawn at any time is exposed immediately and replaced from the back (repeat as needed).
* A hand is a **draw** (流局) when a player must draw and the wall is empty, or when the final discard is not won.

### 2.4 A turn
1. Draw from the front (skip for the dealer's first turn, and after claiming a Chow/Pong). Replace bonus tiles.
2. The player then chooses one of: **Self-Pick win** (`selfWin`, if valid), **concealed Kong** (holds 4), **added Kong**
   (adds the 4th tile to an exposed Pong), **flower win** (see 2.8), or **discard** one tile.
3. After a concealed/added/claimed Kong the player draws a replacement from the back and continues at step 2.
   A Kong may only be declared if at least 1 tile remains in the wall.
4. After claiming a Chow or Pong the claimer must discard (no win or Kong in that same turn).

### 2.5 Claims on a discard
* Each other player may: **win** (if valid), **kong** (holds 3 of the tile), **pong** (holds 2), **chow** (only the
  next player; holds the two other tiles of a sequence — every possible sequence is a separate option), or **pass**.
* Priority: win > kong/pong > chow. Several win claims → **head bump**: the first claimant in turn order after the
  discarder takes the win (only one winner per hand).
* A claimed tile leaves the discarder's river and becomes part of the claimer's meld (record `from` and `claimed`).
* After the last wall tile has been drawn, the final discard may be claimed **for a win only** (Moon Under The Sea).
* Kongs cannot be claimed from a discard when the wall is empty.

### 2.6 Added Kong & Robbing the Kong (p.2)
When a player adds the 4th tile to an exposed Pong, the other players may **rob** it: win with that tile (if valid).
If robbed, the Kong does not happen (the Pong stays a Pong), the robber wins, the Kong-maker pays as the discarder.
Only added Kongs can be robbed (not concealed Kongs, not Kongs claimed from a discard).

### 2.7 Win validity
A win needs a **winning shape** (§3.2) and **Fan ≥ settings.minFan** after all features including bonus tiles
("Below it you cannot declare a win", p.12). Exceptions: Blessings of Heaven/Earth/Man and Seven/Eight Flowers are
always valid ("the pattern needs no Fan of its own"). The engine must never accept an invalid win. The limit is 13 Fan
("A hand worth more than the Limit simply pays the Limit").

### 2.8 Seven / Eight Flowers (p.9)
When a player collects their 7th bonus tile on their own turn they may declare `flowerWin` at once (instead of
continuing). If they decline at 7 and later collect the 8th, `flowerWin` is offered again. A non-dealer who reaches 7
during the opening replacement is offered it on their first turn. Paid like a Self-Pick. Scored at the printed value
(Seven Flowers 3, Eight Flowers 8); the hand and other bonus features are not counted ("no matter what your hand holds").

### 2.9 Blessings (p.8-9)
* **Heaven 天糊**: the dealer's `selfWin` on the very first turn of the hand (initial 14 after bonus replacement),
  before any discard and without having declared a Kong.
* **Earth 地糊**: a non-dealer wins on the **dealer's first discard** (the first discard of the hand).
* **Man 人糊**: a non-dealer wins by Self-Pick on their **first draw** of the hand (including bonus replacements of
  that draw), provided nobody has made a Chow/Pong/Kong before it.

### 2.10 Flags the engine must track for scoring
`source` ('self'|'discard'|'robKong'), `kongReplacement` (number of Kongs declared since the player's last discard
in this turn chain, capped at 2, only when the winning tile is the replacement drawn after the latest Kong — bonus
replacements after that Kong still count), `lastTile` (self-pick when the wall is empty after the draw, or winning on
the final discard), `blessing`, `seatWind`, `roundWind`, `flowers`.

---------------------------------------------------------------------------------------------------------------
## 3. Scoring (booklet p.1-16)

### 3.1 Principles (p.1)
* Fan = **SUM** of the Fan of all matching features.
* An indented feature **REPLACES** its parent — count the child only, never both.
* Triplets and quadruplets are interchangeable unless stated (a Kong counts as a triplet everywhere).
* Pairs never score (Dragon / Wind Fan needs a triplet).
* Total is capped at 13 (the limit). `rawFan` keeps the uncapped sum for display.

### 3.2 Winning shapes
* **Standard**: 4 sets + 1 pair. Sets: chow (sequence of 3 in one suit), pong (triplet), kong (quad, always a declared
  meld). Declared melds are fixed sets; the concealed tiles must split into the remaining sets + the pair.
* **Seven Pairs †** (opt `sevenPairs`): 7 pairs, no declared melds. Pairs must be different kinds unless
  **Luxury Seven Pairs †** (opt `luxurySevenPairs`) is on, in which case four identical tiles count as two pairs.
* **Knitted Tiles †** (opt `knitted`): 1-4-7 of one suit, 2-5-8 of a second, 3-6-9 of the third (any assignment of the
  three suits, all nine concealed) + one ordinary set (concealed, or the single declared meld: chow/pong/kong) + a pair.
* **Lesser Honours †** (opt `lesserHonours`): 14 different single tiles, no melds, made of honours plus suit tiles that
  all belong to ONE knitted arrangement (147/258/369 across the three suits). Only two shapes: 9 knitted + 5 honours or
  8 knitted + 6 honours.
* **Greater Honours †** (opt `greaterHonours`): all 7 honours once + 7 different suit tiles from one knitted arrangement.
  (7+7 is never Lesser Honours.)
* **Thirteen Orphans**: one each of 1 & 9 of all suits and the 7 honours + one duplicate of any of them. No melds.
* **Nine Gates** is a standard shape (see 3.5).

### 3.3 Feature catalogue — ids, values, rules (use these ids EXACTLY; the UI and tests depend on them)

| id | Fan | 中文 | Rule |
|---|---|---|---|
| selfPick | 1 | 自摸 | winning tile drawn by the winner |
| kongReplacement | 2 | 槓上開花 | won on the replacement tile after a Kong. **Replaces selfPick** |
| doubleKong | 9 | 槓上槓 | Kong, second Kong with/after the replacement, win on the 2nd replacement. **Replaces selfPick & kongReplacement** |
| concealed | 1 | 門前清 | no Chow/Pong/exposed Kong declared (concealed Kongs allowed). Winning on a discard still counts. **Built in (not added)** for allConcealedTriplets, sevenPairs, lesserHonours, greaterHonours, thirteenOrphans, nineGates |
| robKong | 1 | 搶槓 | won by robbing an added Kong |
| moon | 1 | 海底撈月 | winning tile is the last tile of the wall or the last discard |
| allSequences | 1 | 平糊 | all four sets are chows; the pair may be anything (honours allowed) |
| allTriplets | 3 | 對對糊 | all four sets are pongs/kongs |
| allConcealedTriplets | 8 | 四暗刻 | all four sets pongs/kongs and ALL concealed: only concealed Kongs as melds, and a pong completed by a winning **discard/robbed** tile is NOT concealed (a discard may complete the pair). **Replaces allTriplets** |
| allQuadruplets | 13 | 四槓子 | all four sets are Kongs. **Replaces allTriplets** and the † kong Fan |
| dragon | 1 each | 三元牌 | per dragon pong/kong (one item per dragon, detail names it) |
| smallThreeDragons | 5 | 小三元 | two dragon pongs + pair of the third. **Replaces dragon** |
| bigThreeDragons | 8 | 大三元 | three dragon pongs. **Replaces dragon & smallThreeDragons** |
| roundWind | 1 | 圈風 | pong of the round wind |
| seatWind | 1 | 門風 | pong of your seat wind (same pong can give both → 2) |
| smallFourWinds | 6 | 小四喜 | three wind pongs + pair of the fourth. **Replaces roundWind/seatWind** |
| bigFourWinds | 13 | 大四喜 | four wind pongs. **Replaces roundWind/seatWind & smallFourWinds** |
| mixedFlush | 3 | 混一色 | exactly one suit plus at least one honour |
| fullFlush | 7 | 清一色 | one suit, no honours. **Replaces mixedFlush** |
| mixedTerminals | 4 | 混么九 | only 1s, 9s and honours, with at least one of each kind; **includes All Triplets 3** (see 3.4) |
| allTerminals | 13 | 清么九 | only 1s and 9s. **Replaces mixedTerminals & allTriplets** |
| allHonours | 10 | 字一色 | only honours. **Includes All Triplets 3; replaces mixedTerminals & allTriplets**; no flush |
| kong † | 1 open / 2 concealed, each | 槓 | opt `kong`. Per Kong. Replaced by allQuadruplets |
| sevenPairs † | 4 | 七對子 | stacks only with mixedFlush, fullFlush, allHonours (+ win actions & bonus). No dragon/wind/triplet/kong/mixedTerminals Fan |
| luxurySevenPairs † | 2 each | 豪華七對 | per four-of-a-kind inside Seven Pairs (a declared Kong breaks Seven Pairs) |
| knitted † | 5 | 組合龍 | Knitted Tiles. The ordinary set still scores its own features (dragon/wind/† kong); +concealed if no melds; never a flush |
| lesserHonours † | 8 | 全不靠 | concealed built in; selfPick, moon, robKong and bonus tiles still add |
| greaterHonours † | 10 | 七星不靠 | concealed built in; selfPick, moon, robKong and bonus tiles still add |
| thirteenOrphans | 13 | 十三么 | limit |
| nineGates | 13 | 九蓮寶燈 | see 3.5. The Full Flush inside it is not added |
| heaven | 13 | 天糊 | Blessing of Heaven |
| earth | 13 | 地糊 | Blessing of Earth |
| man | 13 | 人糊 | Blessing of Man |
| noFlowers | 1 | 無花 | no bonus tiles at all this hand |
| seatFlower | 1 each | 正花 | each flower/season whose number = your seat number |
| allFlowers | 2 | 一檯花 | all four flowers 梅蘭菊竹 |
| allSeasons | 2 | 一檯花 | all four seasons 春夏秋冬 (a mix of four from both groups does not count) |
| sevenFlowers | 3 | 花糊 | instant win with 7 bonus tiles (fixed value) |
| eightFlowers | 8 | 大花糊 | instant win with 8 bonus tiles (fixed value) |

Bonus-tile features (noFlowers, seatFlower, allFlowers, allSeasons) apply to every normal win and count toward the
minimum. They all add together (no "replaces" in the booklet), e.g. 梅蘭菊竹 at South = allFlowers 2 + seatFlower 1.

### 3.4 Accounting for "includes" (display convention — tests depend on it)
Every counted item has `fan > 0` and `sum(items.fan) === rawFan`.
* allHonours + allTriplets → one item `allHonours 10` (detail "includes All Triplets 3"); allTriplets not listed.
* allHonours + allConcealedTriplets → `allConcealedTriplets 8` + `allHonours 7` (detail "10, less the All Triplets 3 it includes").
* allHonours + allQuadruplets → `allQuadruplets 13` + `allHonours 7`.
* mixedTerminals + allTriplets → one item `mixedTerminals 4`.
* mixedTerminals + allConcealedTriplets → `allConcealedTriplets 8` + `mixedTerminals 1` (booklet: 9).
* mixedTerminals + allQuadruplets → `allQuadruplets 13` + `mixedTerminals 1`.
* allTerminals → `allTerminals 13` (no allTriplets/mixedTerminals items).
* sevenPairs + allHonours → `sevenPairs 4` + `allHonours 10` (= 14 → 13, booklet p.7).
Also return `replaced: [{id,name,zh,fan,reason}]` listing features that matched but were replaced / built in, for the UI.

### 3.5 Nine Gates, Thirteen Orphans detail
* Nine Gates: no declared melds (fully concealed), all 14 tiles one suit, counts c1 ≥ 3, c9 ≥ 3, c2..c8 ≥ 1
  (i.e. 1112345678999 + any tile of that suit; the winning tile may be any of them).
* Thirteen Orphans: concealed by definition.

### 3.6 Choosing the interpretation
Enumerate every interpretation: all standard decompositions × every placement of the winning tile among the concealed
groups that contain its kind, plus each enabled special shape. Score each; pick max capped fan, then max raw fan, then
prefer standard. Placement matters for allConcealedTriplets (a discard completing a pong exposes it).

### 3.7 Scoring API (src/core/scoring.js)
```js
HKMJ.Scoring.evaluate(ctx) -> Evaluation
ctx = {
  hand: kinds[],        // concealed tiles INCLUDING the winning tile (for discard/rob wins the claimed tile is included)
  melds: Meld[],        // declared melds; Meld = {type:'chow'|'pong'|'kong', tiles:kinds[] (sorted; kong 4), concealed:bool, from?, claimed?, added?}
  winTile: kind,        // null for flowerWin
  source: 'self'|'discard'|'robKong',
  kongReplacement: 0|1|2, lastTile: bool,
  seatWind: 0..3, roundWind: 0..3,
  flowers: kinds[],     // bonus tiles held (34..41)
  blessing: null|'heaven'|'earth'|'man',
  flowerWin: bool,      // Seven/Eight Flowers: hand & melds ignored
  settings: { minFan, optional:{kong,sevenPairs,luxurySevenPairs,knitted,lesserHonours,greaterHonours} }
}
Evaluation = {
  winning: bool,        // a winning shape exists (flowerWin: >= 7 bonus tiles)
  valid: bool,          // winning && (fan >= minFan || blessing || flowerWin)
  fan, rawFan, limit: rawFan >= 13,
  items: [{id, name, zh, fan, detail?}],     // counted features (fan > 0)
  replaced: [{id, name, zh, fan, reason}],   // matched but replaced / built in (display only)
  pattern: 'standard'|'sevenPairs'|'knitted'|'lesserHonours'|'greaterHonours'|'thirteenOrphans'|'flowers',
  groups: [{kind:'chow'|'pong'|'kong'|'pair'|'knitted'|'single', tiles, concealed, fromMeld, hasWinTile}],
  points                // Scoring.points(fan)
}
HKMJ.Scoring.points(fan) -> [1,2,4,8,16,24,32,48,64,96,128,192,256,384][min(fan,13)]   (p.16, New Style)
HKMJ.Scoring.payments({fan, winner, source, payer, payment:'full'|'shared', unit:'points'|'chips'}) -> [d0,d1,d2,d3]
HKMJ.Scoring.FEATURES -> { id: {name, zh, fan, fanText, group:'win'|'set'|'tile'|'special'|'bonus', optional:bool, desc, replaces:[ids]} }
HKMJ.Scoring.FEATURE_ORDER -> ids in booklet order (for the rules reference screen)
```
Payments (p.16): unit value `P = points(fan)` ('points') or `P = max(1, min(fan,13))` ('chips', "5 Fan = 5 chips").
* Self-Pick (incl. Heaven, Man, flower wins): each of the three others pays P.
* Discard / Robbing the Kong, `payment:'full'` (discarder pays all, 全銃 — default): the payer pays 2P, nobody else pays.
* Discard / Robbing, `payment:'shared'` (older tables): payer pays P, each of the other two pays P/2 (same 2P total).
Deltas always sum to 0. Blessing of Earth is paid by the dealer (the discarder).

---------------------------------------------------------------------------------------------------------------
## 4. Hand analysis API (src/core/hand.js)
```js
HKMJ.Hand.counts(kinds) -> int[34]
HKMJ.Hand.decompositions(concealedKinds, meldCount) -> [{sets:[{type:'chow'|'pong', tiles}], pair:kind}]  // standard only
HKMJ.Hand.winningShapes(concealedKinds, melds, optional) -> [{pattern, ...}]   // all shapes present (any pattern)
HKMJ.Hand.isWinningShape(concealedKinds, melds, optional) -> bool
HKMJ.Hand.shanten(concealedKinds, meldCount, optional) -> int   // -1 = complete; min over standard / seven pairs / 13 orphans (as enabled)
HKMJ.Hand.waits(concealed13, melds, optional) -> kinds[]        // tiles that would complete a winning shape (ignores Fan)
```
Must be fast: `shanten` is called thousands of times per AI decision — memoise per-suit results (e.g. by count-vector key).

---------------------------------------------------------------------------------------------------------------
## 5. Engine API (src/core/engine.js) — the UI is built against this contract

### 5.1 Construction & control
```js
var g = new HKMJ.Game({
  seed,                       // number|string; default random
  settings,                   // merged over HKMJ.DEFAULT_SETTINGS (below)
  names: ['You','Julie','Bel','Pat'],
  humans: [0],                // indices controlled by a person (UI [0]; simulations [])
  firstDealer,                // optional
  presetWalls                 // optional [wall0, wall1, ...] (arrays of 144 kinds) used for hands 0,1,..., for tests
});
g.start();                    // deals hand 1
g.getPending()                // {type:'turn', player, afterClaim} | {type:'claim', tile, from, waiting:[p..]}
                              // | {type:'robKong', tile, from, waiting:[p..]} | {type:'handEnd', result} | {type:'gameEnd', standings}
g.getActions(p)               // legal actions for p right now ([] if p has no decision pending)
g.act(p, action)              // -> {ok:true} | {ok:false, error}; validates, applies, then auto-advances to the next decision
g.nextHand()                  // from 'handEnd': next hand, or 'gameEnd'
g.getView(p, {revealAll})     // view model for viewer p (5.4)
g.getHints(p)                 // {shanten, waits:[{tile, left, fan, valid}], blockedWin} for p's concealed hand
g.on(fn)                      // subscribe: fn(event) — see 5.5; returns an unsubscribe function
g.serialize() / HKMJ.Game.deserialize(json)   // plain-JSON save/resume (UI autosaves to localStorage)
HKMJ.Game.buildWall({hands:[h0,h1,h2,h3], draws:[...], replacements:[...]}, rng) -> 144 kinds
   // test helper: hands[i] = starting tiles for player i (dealer 14, others 13, before bonus replacement),
   // draws = subsequent live-wall draws in order, replacements = back-end tiles in order; rest filled randomly.
HKMJ.DEFAULT_SETTINGS = {
  minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0,
  optional: { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true }
}
```
Claims: when a discard (or added Kong) happens, compute each other player's options; players whose only option is
pass are auto-passed; if nobody can claim, play continues immediately. Otherwise the engine waits until every player in
`waiting` has called `act` (AI answers are submitted by the controller). Then resolve by priority.

### 5.2 Actions
```js
{type:'discard', tile}                    {type:'selfWin'}            {type:'flowerWin'}
{type:'concealedKong', tile}              {type:'addKong', tile}
{type:'win'}   /* on a discard or robbing a kong */   {type:'kong'}  {type:'pong'}
{type:'chow', tiles:[a,b,c]} /* full sorted sequence incl. the discard */   {type:'pass'}
```
`getActions` returns these objects, and for `win`/`selfWin`/`flowerWin` adds read-only `fan` and `evaluation` so the UI
can show "Win — 5 Fan". `act` matches on type + tile/tiles only.

### 5.3 Rules the engine enforces
Everything in §2. Reject illegal actions with a clear error. Never offer an invalid win. Chow only from the left.
After Chow/Pong only discards. Kong only when the wall has ≥ 1 tile. Final discard: win claims only. Head bump.

### 5.4 View model — `g.getView(viewer)` (plain JSON; never leaks hidden tiles)
```js
{
  viewer, handNo, round, dealer, firstDealer, dealerRepeat, dice, wallCount,
  phase: 'turn'|'claim'|'robKong'|'handEnd'|'gameEnd',
  turn,                           // player whose turn it is (during claims: the discarder / kong maker)
  pending,                        // like getPending(), but only reveals the viewer's own options
  actions,                        // g.getActions(viewer)
  blockedWin,                     // null | {fan, minFan} when viewer has a winning shape now but below the minimum
  lastDiscard: null | {tile, from},
  claimTile: null | {tile, from, kind:'discard'|'robKong'},
  players: [{
    index, name, isHuman, seatWind, isDealer, score,
    handCount,
    hand: kinds[] | null,         // sorted; only for the viewer, or everyone when revealed (handEnd/gameEnd/revealAll)
    drawn: kind | null,           // viewer only: the tile just drawn this turn (it is also inside hand)
    melds: [{type, tiles, concealed, from, claimed, added}],
    flowers: kinds[],
    discards: kinds[],            // river in order; claimed tiles removed
    lastAction: null | 'chow'|'pong'|'kong'|'concealedKong'|'addKong'|'win'|'selfWin'|'flowerWin'
  } x4],
  settings,
  result: null | HandResult,      // when phase is handEnd/gameEnd
  standings: null | [{index, name, score, rank}],
  log                             // last ~60 human-readable lines, newest last
}
HandResult = { type:'win'|'draw', handNo, round, dealer, winner, payer, source:'self'|'discard'|'robKong'|'flowers',
  winTile, evaluation, payments:[4], scoresAfter:[4], hands:[{hand, melds, flowers} x4],
  dealerStays, nextDealer, nextRound, gameOver }
```

### 5.5 Events — `g.on(fn)`
`{type:'handStart', handNo, round, dealer, dice}` `{type:'draw', player, replacement}` `{type:'bonus', player, tile}`
`{type:'discard', player, tile}` `{type:'claim', player, claim:'chow'|'pong'|'kong', tile, from}`
`{type:'concealedKong'|'addKong', player, tile}` `{type:'robKong', player, from, tile}` `{type:'win', player, result}`
`{type:'drawGame', result}` `{type:'handEnd', result}` `{type:'gameEnd', standings}`.
Events are for animation/sound/logging; the UI re-renders from `getView`. Do not put hidden tiles of other players
in events except in `win`/`handEnd` results.

---------------------------------------------------------------------------------------------------------------
## 6. Computer players (src/core/ai.js)
```js
HKMJ.AI.decide(view, actions, {level:'easy'|'normal'|'hard', rng}) -> one of `actions`
HKMJ.AI.suggest(view, actions) -> {action, reason}     // for the human's "Hint" button (uses the hard level)
```
* Uses only the viewer's `view` (no peeking at hidden tiles or the wall order). Always returns an element of `actions`.
* Always takes a valid win (selfWin / win / flowerWin).
* **Must plan for Fan**: with a 3 Fan minimum, speed alone produces unwinnable chicken hands. Evaluate candidate plans —
  e.g. Mixed/Full Flush per suit, All Triplets, dragon/seat/round-wind pongs, Seven Pairs (if enabled), staying
  concealed for Concealed Hand + Self-Pick, Thirteen Orphans when close — using plan-restricted shanten, effective-tile
  counts over unseen tiles, and the Fan the plan reaches (including bonus tiles already held). Only pursue claims that
  keep a plan able to reach the minimum.
* Defence (normal: light, hard: full): recognise threatening opponents (several exposed melds, one-suit melds suggesting
  a flush, honour pongs, late wall) and avoid discarding likely winning tiles (tiles they discarded, honours with 3
  visible, suit tiles outside a suspected flush suit are safer). "Discarder pays all" makes feeding a big hand costly.
* Claims: Chow/Pong/Kong only when the resulting hand is better for its plan; Kong generally yes unless it breaks the hand.
* Levels: easy = efficiency with some randomness, greedy claims, no defence; normal = fan-aware + light defence;
  hard = fan-aware + full defence + better claim/kong judgement.
* Performance: typical decision ≤ 30 ms, worst ≤ 250 ms in Node on a laptop.

---------------------------------------------------------------------------------------------------------------
## 7. Tests & acceptance (back end)
1. `node tests/run_vectors.js` — ALL booklet vectors and payment cases pass.
2. Hand-analysis unit tests (decompositions, waits, shanten vs brute force on random hands).
3. Scenario tests with `presetWalls` / `buildWall`: chow only from the left; priority win > pong > chow; head bump;
   robbing an added Kong; Kong replacement win (single & double); Moon (last tile & last discard); final discard is
   win-only; Heaven/Earth/Man; Seven/Eight Flowers; draw game; dealer rotation (stays on dealer win/draw, passes
   otherwise); round advance and game end for rounds 1 and 4; minimum Fan blocks a win and `blockedWin` is reported;
   invalid actions rejected; serialize → deserialize → identical continuation.
4. Simulation: ≥ 300 complete games (4 AIs, mixed levels & settings, seeds 1..N) with invariants checked after every
   step: 144 tiles conserved (wall + hands + melds + flowers + rivers); concealed + 3×melds = 13 (14 on own turn before
   discarding); scores sum to startingScore×4; every win valid; no exceptions; games terminate.
5. AI quality (report numbers): with 4 normal AIs at minFan 3, ≥ 50% of hands end in a win; 1 hard vs 3 easy over
   ≥ 200 East-round games → hard's mean score clearly above the easy players'; decision time stats.
Provide `node tests/run_all.js` that runs everything and prints a summary.
