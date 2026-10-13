# HK Mahjong — UI Specification & Art Direction

Read SPEC.md first (§0 paths/conventions, §5 engine contract, §3.3 feature ids). The UI is a single page that the build
inlines into one HTML file. 1 human (player 0, bottom) vs 3 computer players. Target: desktop browsers (Chrome/Safari),
1280×800 and up; it must scale down gracefully to ~1024×640.

## 1. Files (UI owner)
```
src/ui/index.html        page template: <style>/*__CSS__*/</style> ... <script>/*__JS__*/</script>  (build.js fills these)
src/ui/styles.css        all styles
src/ui/tile-art.js       HKMJ.TileArt: builds an inline SVG <symbol> sprite for all 42 kinds + the tile back
src/ui/rules-content.js  HKMJ.RulesContent: the booklet reference (paraphrased) for the Rules screen
src/ui/render.js         HKMJ.UI.render*: PURE functions view -> HTML string (no DOM access — testable in Node)
src/ui/app.js            controller: DOM mounting, event delegation, game loop/AI pacing, modals, settings, save/resume, sound
dev/mock-engine.js       optional stand-in implementing SPEC §5 if the real engine is not ready yet (never bundled)
tests/ui_render.test.js  Node test: drive a game (real engine if present, else mock) and render every view/modal
```
`build.manifest.json` (repo root) lists the files that are bundled, in order — add UI files there if you create more.

## 2. Art direction — "a Hong Kong mahjong parlour at night"
* **Table**: deep jade-green felt (radial gradient `#11624b` centre → `#0a3f31` edge, with a very subtle noise/weave
  texture via layered CSS gradients), framed by a dark rosewood rail (`#3a2217` → `#5b3522`) with a thin brass inner line
  `#c9a44c`. Soft vignette.
* **Tiles**: warm ivory face (`#fbf6e8` → `#efe5cf`), rounded corners (6px at full size), a two-layer body like real HK
  tiles — ivory face over a **jade-green back layer** (`#1f7a5c`, lip `#2e9a76`) visible as the tile's thickness on the
  bottom edge (box-shadow stack), plus a soft drop shadow. Tile backs (opponents' hands, concealed-Kong outer tiles):
  solid jade with a faint lighter bevel.
* **Tile faces** (SVG, viewBox 0 0 60 80, drawn once as `<symbol id="tk-{kind}">`):
  * 萬 Characters: Chinese numeral 一二三四五六七八九 on top in ink `#1c2230`, 萬 below in red `#c1272d`, bold Song/Ming serif.
  * 筒 Dots: classic layouts — 1 big ornate circle (concentric rings red/blue/green); 2 vertical; 3 diagonal; 4 square;
    5 square + red centre; 6 = 2 green on top + 4 red below; 7 = 3 green diagonal + 4 red square; 8 = 2×4 blue;
    9 = 3×3 rows blue/red/green. Colours blue `#1f4f9e`, green `#1f7a3a`, red `#c1272d`; each dot a ring with inner dot.
  * 索 Sticks: bamboo sticks (rounded rect with node lines) in green `#1f7a3a`, some red/blue accents as on real tiles;
    1 Sticks = a stylised bird (peacock/sparrow — green body, red crest, simple shapes, NOT a copyrighted design);
    layouts: 2 vertical, 3 = 1 over 2, 4 = 2×2, 5 = 2×2 + red centre, 6 = 2×3, 7 = 1 red over 2×3, 8 = two V/M rows, 9 = 3×3 (red centre column).
  * Winds 東南西北: large ink characters `#1c2230`. Dragons: 中 red, 發 green, 白 = blue double-line rectangle frame (`#1f4f9e`).
  * Flowers 梅蘭菊竹 / Seasons 春夏秋冬: small number (1-4) top-left, character top-right, simple original motif
    (plum blossom pink, orchid purple, chrysanthemum gold, bamboo green; seasons with a colour band). Keep them tasteful.
  * CJK font stack for tiles/labels: `"Songti TC","STSong","Noto Serif CJK TC","Noto Serif TC","PMingLiU","MingLiU",serif`.
* **Chrome & panels** borrow the booklet's look: warm paper cards `#fbf7ec` with `#cdbf9a` borders, section colours —
  Win Actions green `#2e7d32`, Hands by Set Type terracotta `#b5563b`, Hands by Tile Type blue `#2a64b0`, Special Hands
  olive `#8a7420`, Bonus Tiles magenta `#a8327a`; olive-gold headings `#8a7420`; the winning tile marked with a small
  **red triangle** under it exactly like the booklet's examples.
* **Type**: headings `"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif`; UI text
  `"Avenir Next","Segoe UI",system-ui,sans-serif`; CJK as above. Chinese + English side by side on buttons (e.g. 碰 Pong).
* **Buttons**: lacquer black-red `#2a1410` with brass border for normal actions; the win button is brass/gold
  (`#d8b24c` → `#b58a2a`) with dark text and a gentle glow. Avoid purple gradients, flat generic dashboards, emoji.

## 3. Layout (design canvas 1440×900, scaled uniformly to fit the window, centred, letterboxed by the rail colour)
* **Table** (left ~1130px) and **sidebar** (right ~290px).
* **You (bottom)**: hand of 13/14 tiles at 50×68 px centred along the bottom; the drawn tile sits 14px apart at the
  right end; your exposed melds (40×55) and flowers (small) to the right/above the hand. Action bar floats just above the hand.
* **Right (player 1, next to play)**, **Top (player 2)**, **Left (player 3)**: concealed hands as rows/columns of tile
  backs (edge-on look is fine); their exposed melds face-up at ~34×47 next to the hidden tiles, facing the centre; flowers small.
  Name plate per player: name, seat wind character (東/南/西/北) in a circle, dealer marker (a small "莊" badge),
  score, and a "thinking…" shimmer while that AI is deciding.
* **Rivers** (discards): each player's discards in front of them toward the centre, rows of 6 at ~32×44, all faces
  upright for readability. The latest discard: brass outline + slight enlargement; while it can be claimed by you, it
  pulses softly.
* **Centre plate** (~190px square, dark wood with brass rim): round wind (e.g. "東風 East Round"), hand no., wall
  count ("Wall 83"), dealer-repeat count if > 0, three small dice, and the four seat winds printed on the plate's sides
  facing their players.
* **Sidebar**: scoreboard (name, seat wind, score, rank, dealer badge), buttons (Rules 牌例, Settings 設定, New Game),
  a "Your Fan so far" mini panel (optional), and a scrolling game log (latest at the bottom; claim/win lines highlighted).
* Callouts: when anyone chows/pongs/kongs/wins, a large calligraphic bubble (e.g. "碰 Pong!", "自摸!") appears near that
  player for ~1 s (CSS keyframes). A win gets a brief brass glow sweep across the table.

## 4. Interaction
* Hand tiles: hover lifts 6px; click selects (lifts 14px + brass glow); clicking the selected tile again, double-click,
  Enter/Space, or the "打 Discard" button discards it. ←/→ move the selection. The hand is always sorted
  (萬, 筒, 索, winds 東南西北, dragons 中發白); the drawn tile stays at the right end until you discard.
* Only allow input when `view.actions` has something for you; otherwise tiles are not clickable.
* Action bar (from `view.actions`): 食糊 Win (show Fan), 自摸 Self-Pick (show Fan), 花糊 Flower Win, 槓 Kong
  (if several Kong options, pick by clicking the tile set), 碰 Pong, 上 Chow (if several sequences, show a small picker
  with each 3-tile sequence rendered), 過 Pass. Keyboard: W win, P pong, K kong, C chow, Space/Esc pass (when claiming).
* Claims: when you can claim, the engine waits for you (no timer). Show the claimable tile highlighted in the centre
  area with the buttons. If you have no options, play continues automatically.
* `view.blockedWin` → small toast: "Winning shape, but only 2 Fan — this table needs 3."
* **Hints** (setting, default on): when your 13 tiles are ready, show "聽 Ready — waiting on" with each wait tile, tiles
  left, and its Fan (grey + "below minimum" if not valid) via `g.getHints(0)`. A "Hint 提示" button calls
  `HKMJ.AI.suggest(view, actions)` and highlights the suggested tile/action with the reason.
* AI pacing (setting "Speed"): relaxed / normal / fast ≈ AI turn 1100 / 650 / 250 ms, claim pause 700 / 450 / 150 ms.
  Give the human ~500 ms to see a discard before the next player draws.
* Sound (setting, default on, quiet): tiny synthesised WebAudio "clack" on discard, soft chime on claims, a brighter
  chord on a win. No audio files.

## 5. Screens / modals
* **Start**: title "Hong Kong Mahjong 香港麻雀" in the booklet's style (olive-gold + green Chinese title), short
  subtitle "Scored by the HK Mahjong Scoring Sheet v1.0", buttons New Game / Continue (if a save exists) / Rules / Settings.
* **Settings** (booklet: "agree these before the first deal"): Minimum Fan 0–5 (default 3); Payment — Discarder pays
  all 全銃 (default) / Shared (older tables); Unit — Payment Table points (default) / Chips (Fan count); Game length —
  Full game (4 rounds, default) / East round only; Computer level easy/normal/hard; Speed; Hints; Sound; Your name;
  **Table rules †** toggles with the booklet's note: Kong (default off), Seven Pairs, Luxury Seven Pairs, Knitted
  Tiles, Lesser Honours, Greater Honours (default on). Game-rule changes take effect in a new game (confirm dialog).
* **Hand result** (paper-card modal, booklet look): title ("Julie wins by Self-Pick 自摸" / "You win on Bel's discard" /
  "Robbing the Kong"); the winning hand grouped by `evaluation.groups` (sets, pair, knitted run, singles), declared melds
  marked, concealed Kong with face-down outer tiles, the winning tile with the booklet's red triangle, flowers; a Fan
  table — each `evaluation.items` row: English name, 中文, detail, Fan; each `evaluation.replaced` row greyed with
  strikethrough and its reason; total ("9 Fan", or "13 Fan — limit (raw 15)"); payment lines from `result.payments`
  ("Bel pays 96" …) and new scores; next deal ("East keeps the deal" / "The deal passes to …" / round change);
  a compact row with all four revealed hands; button "Next hand 下一局". Draws: "流局 Draw — the wall is exhausted".
* **Game over**: final standings with ranks and totals, "New game".
* **Rules 牌例** (tabbed, paper look, content from `HKMJ.RulesContent`, tile examples drawn with the tile art):
  Basics (sets, pairs, turn order & claims, minimum & limit), Win Actions, Hands by Set Type, Hands by Tile Type,
  Special Hands (mark † hands and show whether each is enabled), Bonus Tiles, Payment Table (the 0–13+ table and the
  payment rules), Fan Combinations (the booklet's combination tables). Paraphrase — do not paste long booklet passages.

## 6. Controller rules (app.js)
* `new HKMJ.Game({seed, settings, names:[name,'Julie','Bel','Pat'], humans:[0]})`, then `start()`.
* After every change: re-render from `g.getView(0)`. If the pending decision belongs to an AI: after the pacing
  delay call `HKMJ.AI.decide(g.getView(p), g.getActions(p), {level})` and `g.act(p, action)`. During claims, submit
  every waiting AI's answer (after the claim pause) — if you (player 0) are also waiting, wait for your click.
* Never let a thrown error freeze the table: wrap AI/act calls; on an AI error fall back to a safe legal action
  (pass, or discard the drawn/last tile) and `console.error` it.
* Persistence (try/catch everything; storage may be unavailable): settings in `localStorage['hkmj.settings.v1']`,
  game autosave `localStorage['hkmj.save.v1'] = g.serialize()` after every action and hand end; "Continue" restores.
* Re-rendering by `innerHTML` from pure render functions is fine; use event delegation with `data-action` attributes.
  Newly appeared elements (latest discard, new meld, callout) get CSS keyframe animations.
* Accessibility: every tile has `title`/`aria-label` (e.g. "5 Dots 五筒"); buttons have text; visible focus styles.

## 7. Verification you must do (no browser in the shell)
* `node tests/ui_render.test.js`: load core + UI modules in Node (render.js must not touch `document`), play complete
  games with the real engine (or the mock) and call every render function for every intermediate view, result,
  draw, game-over, settings and rules screen; assert no exceptions and that key markers appear (e.g. 14 hand tiles on
  your turn, action buttons present when `actions` exist, red-triangle marker on the winning tile).
* Keep app.js small and defensive; the orchestrator will do visual QA in a real browser and send fixes back.
