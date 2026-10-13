/* HK Mahjong — src/ui/rules-content.js
 * HKMJ.RulesContent: static reference data for the Rules 牌例 screen, paraphrased from the booklet (see
 * UI_SPEC.md §5). Feature `id`s match SPEC.md §3.3 exactly (and, for optional † hands, double as the
 * corresponding HKMJ.DEFAULT_SETTINGS.optional key) so the UI can show each hand's current on/off state.
 * Plain data — no logic, no DOM. `example` strings are core/tiles.js notation, parsed by render.js.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});

  function card(id, fanText, name, zh, desc, opts) {
    opts = opts || {};
    return { id: id, fanText: fanText, name: name, zh: zh, desc: desc, optional: !!opts.optional, example: opts.example || null, winTile: opts.winTile || null, note: opts.note || null };
  }

  var TABS = [
    {
      id: 'basics', label: 'Basics', zh: '基本',
      sections: [
        { heading: 'The shape of a hand', zh: '牌型',
          body: 'A winning hand is four sets plus one pair. A set is a chow (three tiles in a row, one suit), a pong (three identical tiles) or a kong (four identical tiles). Kongs and pongs score the same everywhere unless a rule says otherwise.' },
        { heading: 'Seats and the deal', zh: '座位與開牌',
          body: 'The dealer is always East; the other seats follow counter-clockwise — South, West, North — and the winds move on whenever the deal passes. Your own seat is assigned at random each game and can change as the deal rotates. East deals four tiles to each player, three times round, then one more each, then takes a 14th tile.' },
        { heading: 'Turn order and claims', zh: '出牌與截糊',
          body: 'After a discard, the turn passes to the player on the discarder’s right. Anyone may Pong or Kong a discard; only the player to the discarder’s left may Chow it. If several players want the same discard, a win outranks a Kong/Pong, which outranks a Chow, and among competing wins the player closest to the discarder (going the play direction) takes it.' },
        { heading: 'Minimum and limit', zh: '最低與頂糊',
          body: 'This table plays with a minimum of ' + '3' + ' Fan (adjustable in Settings) — a complete hand worth less cannot be declared a win. Scoring stops adding at 13 Fan: anything above that still pays the 13-Fan limit.' },
        { heading: 'The deal moving on', zh: '轉莊',
          body: 'East keeps dealing after winning or after a drawn hand; otherwise the deal passes to the player on East’s right. A full game runs four rounds — East, South, West, North — advancing each time the deal cycles all the way back to the very first dealer.' }
        ]
    },
    {
      id: 'winActions', label: 'Win Actions', zh: '食糊動作', color: 'green',
      cards: [
        card('selfPick', '1', 'Self-Pick', '自摸', 'You complete your hand by drawing your own winning tile rather than taking a discard.'),
        card('kongReplacement', '2', 'Win by Kong Replacement', '槓上開花', 'Your winning tile is the replacement you draw immediately after declaring a Kong. Replaces Self-Pick — you score this instead, not both.', { example: '345s678s99s 發發發', winTile: '9s' }),
        card('doubleKong', '9', 'Double Kong Replacement', '槓上槓', 'You Kong, then Kong again on that replacement tile, then win on the second replacement. Replaces both Self-Pick and Win by Kong Replacement.'),
        card('concealed', '1', 'Concealed Hand', '門前清', 'You reach the win without ever Chow-ing or Pong-ing (concealed Kongs are still allowed). Winning on someone’s discard is fine — you just cannot have exposed any set.'),
        card('robKong', '1', 'Robbing the Kong', '搶槓', 'Another player upgrades an exposed Pong to a Kong, and the tile they add happens to complete your hand — you win on it before the Kong takes effect.', { example: '發發發中中中 234678m 55m', winTile: '7m' }),
        card('moon', '1', 'Moon Under The Sea', '海底撈月', 'Your winning tile is either the very last tile of the wall, or the very last discard of the hand.')
      ]
    },
    {
      id: 'setType', label: 'Hands by Set Type', zh: '牌型', color: 'terracotta',
      cards: [
        card('allSequences', '1', 'All Sequences', '平糊', 'All four sets are chows; the pair can be anything, including an honour tile.', { example: '234m567m345p678s 東東', winTile: '5p' }),
        card('allTriplets', '3', 'All Triplets', '對對糊', 'All four sets are Pongs or Kongs, plus a pair.', { example: '111m東東東 33m', winTile: '3m' }),
        card('allConcealedTriplets', '8', 'All Concealed Triplets', '四暗刻', 'All four sets are triplets and none were exposed by Pong — concealed Kongs are fine. A discard that completes your final triplet still lets you win, but that one set counts as exposed, so the hand downgrades to All Triplets. Replaces All Triplets, and Concealed Hand is automatically included.'),
        card('allQuadruplets', '13', 'All Quadruplets', '四槓子', 'All four sets are Kongs, plus a pair — an automatic limit hand. Replaces All Triplets (and the † Kong bonus).')
      ]
    },
    {
      id: 'tileType', label: 'Hands by Tile Type', zh: '花色', color: 'blue',
      cards: [
        card('dragon', '1 each', 'Dragon', '三元牌', 'A Pong or Kong of any one dragon (中 Red, 發 Green, 白 White) scores 1 Fan; holding more than one dragon triplet stacks.'),
        card('smallThreeDragons', '5', 'Small Three Dragons', '小三元', 'Two dragon triplets plus a pair of the third dragon. Replaces the per-triplet Dragon score.'),
        card('bigThreeDragons', '8', 'Big Three Dragons', '大三元', 'All three dragons as triplets. Replaces Dragon and Small Three Dragons.'),
        card('roundWind', '1', 'Round Wind', '圈風', 'A Pong/Kong of the current round’s wind.'),
        card('seatWind', '1', 'Seat Wind', '門風', 'A Pong/Kong of your own seat wind. One triplet that is both your seat wind and the round wind scores both, for 2 Fan.'),
        card('smallFourWinds', '6', 'Small Four Winds', '小四喜', 'Three wind triplets plus a pair of the fourth wind. Replaces Round Wind and Seat Wind.'),
        card('bigFourWinds', '13', 'Big Four Winds', '大四喜', 'All four winds as triplets — an automatic limit hand on its own.'),
        card('mixedFlush', '3', 'Mixed Flush', '混一色', 'Every tile is from one suit, plus any honours.', { example: '123m456m789m中中中 東東', winTile: '9m' }),
        card('fullFlush', '7', 'Full Flush', '清一色', 'Every tile is from one suit — no honours at all. Replaces Mixed Flush.'),
        card('mixedTerminals', '4', 'Mixed Terminals', '混么九', 'Only 1s, 9s and honours, with at least one of each kind. All Triplets is already folded into this value.'),
        card('allTerminals', '13', 'All Terminals', '清么九', 'Only 1s and 9s — an automatic limit hand. Replaces Mixed Terminals and All Triplets.'),
        card('allHonours', '10', 'All Honours', '字一色', 'Every tile is a wind or dragon. All Triplets is already folded into this value; a flush bonus never applies since there are no suit tiles.'),
        card('kong', '1 open / 2 concealed', 'Kong', '槓', 'Table option (off by default): each Kong you hold scores on top of everything else — more if it was concealed, since nobody fed it to you. Superseded by All Quadruplets.', { optional: true })
      ]
    },
    {
      id: 'special', label: 'Special Hands', zh: '特殊牌型', color: 'olive',
      cards: [
        card('sevenPairs', '4', 'Seven Pairs', '七對子', 'Seven different pairs, no sets at all. Stacks only with a flush or All Honours — no dragon, wind, triplet, Kong or Mixed Terminals bonus applies. Concealed Hand is automatically included since you can never Chow or Pong here.', { optional: true }),
        card('luxurySevenPairs', '2 each', 'Luxury Seven Pairs', '豪華七對', 'A Seven Pairs hand where one pair is actually all four copies of a tile, counted as two of the seven pairs. Scores per such set; a declared Kong would break the shape entirely.', { optional: true }),
        card('knitted', '5', 'Knitted Tiles', '組合龍', 'Nine tiles that "knit" the three suits together — 1-4-7 of one suit, 2-5-8 of a second, 3-6-9 of the third — plus one ordinary set and a pair. The ordinary set can still be Chowed or Ponged and still scores its own bonuses; a flush never applies since three suits are in play.', { optional: true }),
        card('lesserHonours', '8', 'Lesser Honours', '全不靠', 'Fourteen single tiles, no sets or pair: a mix of honours plus one knitted run per suit (9 knitted + 5 honours, or 8 knitted + 6 honours). Concealed Hand is automatically included; Self-Pick and bonus tiles still add on top.', { optional: true }),
        card('greaterHonours', '10', 'Greater Honours', '七星不靠', 'All seven honour tiles as singles, plus any seven knitted tiles — fourteen singles, no sets or pair. Concealed by definition; Self-Pick and bonus tiles still add on top.', { optional: true }),
        card('chicken', '0', 'Chicken Hand', '雞糊', 'A complete hand that scores nothing of its own — any Fan it has comes only from flowers, seasons or No Flowers. The booklet treats it like any other hand: it can only win if it reaches the Minimum Fan (so only at a 0 Fan table). House rule in Settings → Table rules: “Can always win” lets a chicken hand win even below the Minimum Fan (it pays what it is worth); “Can never win” bars it even at a 0 Fan table. Blessings are never chicken hands.', { optional: true }),
        card('thirteenOrphans', '13', 'Thirteen Orphans', '十三么', 'One each of the 1 and 9 of every suit plus all seven honours, and a duplicate of any one of them. An automatic limit hand; concealed by definition.'),
        card('nineGates', '13', 'Nine Gates', '九蓮寶燈', '1112345678999 of one suit, plus any one more tile of that suit as the winner — nine different tiles could complete it. Must be fully concealed; an automatic limit hand (the Full Flush inside it is not added separately).'),
        card('heaven', '13', 'Blessing of Heaven', '天糊', 'The dealer’s opening 14 tiles are already a complete hand. An automatic limit win — the shape alone is enough, however little it would otherwise score.'),
        card('earth', '13', 'Blessing of Earth', '地糊', 'A non-dealer completes their hand on the dealer’s very first discard of the game. An automatic limit win.'),
        card('man', '13', 'Blessing of Man', '人糊', 'A non-dealer self-picks a winning tile on their own very first draw, before anyone has Chowed, Ponged or Konged. An automatic limit win.')
      ]
    },
    {
      id: 'bonus', label: 'Bonus Tiles', zh: '花牌', color: 'magenta',
      cards: [
        card('noFlowers', '1', 'No Flowers', '無花', 'You drew none of the eight bonus tiles all hand — a small reward for their absence.'),
        card('seatFlower', '1 each', 'Seat Flower or Season', '正花', 'Each flower or season you hold that matches your seat number (East 1, South 2, West 3, North 4) scores 1 Fan.'),
        card('allFlowers', '2', 'All Flowers', '一檯花', 'You hold all four flowers 梅蘭菊竹. A four-tile mix drawn from both the flower and season groups does not count.'),
        card('allSeasons', '2', 'All Seasons', '一檯花', 'You hold all four seasons 春夏秋冬.'),
        card('sevenFlowers', '3', 'Seven Flowers', '花糊', 'Collect seven of the eight bonus tiles and you may declare an instant win, whatever your hand looks like.'),
        card('eightFlowers', '8', 'Eight Flowers', '大花糊', 'Collect all eight bonus tiles for an instant win, whatever your hand looks like.')
      ]
    },
    {
      id: 'payment', label: 'Payment Table', zh: '賠付表', color: 'gold',
      points: [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384],
      notes: [
        'Self-Pick: every other player pays the full points for your Fan total.',
        'Discard (“discarder pays all” 全銃制, the default here): only the discarder pays, at double the points — this raises the cost of feeding someone a big hand.',
        'Older tables (“Shared” in Settings) spread that cost instead: the discarder pays twice what each of the other two pays — the full points for the discarder, half the points each for the others — so the winner still collects the same total (2× the points).',
        'Playing with chips instead of points is quicker — pay the Fan count itself, 5 Fan = 5 chips — but it flattens the reward for a big hand: a limit hand only pays 13 chips instead of 384 points.'
      ]
    },
    {
      id: 'fanCombos', label: 'Fan Combinations', zh: '番組合',
      intro: 'The booklet’s combination tables. Each figure is the resulting TOTAL Fan for the whole hand, not the amount added; ↑ marks a total held at the 13 Fan limit. Notes in italics say when a feature replaces, rather than adds to, one it already contains.',
      combos: [
        { title: 'Mixed Flush', zh: '混一色', fan: 3, sub: 'one suit plus honours (winds & dragons)', rows: [
          ['All Sequences', '', '4'], ['All Triplets', '', '6'], ['All Concealed Triplets', 'replaces All Triplets', '11'],
          ['All Quadruplets', 'replaces All Triplets', '13↑'], ['Seven Pairs', '', '7'], ['Luxury Seven Pairs', '2 per four-of-a-kind', '9'],
          ['Mixed Terminals', 'All Triplets 3 is inside', '7'], ['Full Flush', 'replaces, does not add', '7'],
          ['Dragon', '1 per dragon triplet', '4'], ['Round Wind / Seat Wind', '1 each, 2 if both', '4'],
          ['Small Three Dragons', 'replaces per-triplet Dragon', '8'], ['Big Three Dragons', 'replaces the Dragon scores', '11'],
          ['Small Four Winds', 'replaces Round / Seat Wind', '9'], ['Big Four Winds', 'the limit on its own', '13↑'],
          ['Self-Pick', '', '4'], ['Concealed Hand', '', '4'], ['Win by Kong Replacement', 'replaces Self-Pick', '5'],
          ['Double Kong Replacement', 'replaces both Kong wins', '12'], ['Robbing the Kong', 'the robbed tile joins a sequence', '4'],
          ['Moon Under The Sea', '', '4'] ] },
        { title: 'Full Flush', zh: '清一色', fan: 7, sub: 'one suit only, no honours', rows: [
          ['All Sequences', '', '8'], ['All Triplets', '', '10'], ['All Concealed Triplets', 'replaces All Triplets', '13↑'],
          ['All Quadruplets', 'replaces All Triplets', '13↑'], ['Seven Pairs', '', '11'], ['Luxury Seven Pairs', '2 per four-of-a-kind', '13'],
          ['Self-Pick', '', '8'], ['Concealed Hand', '', '8'], ['Win by Kong Replacement', 'replaces Self-Pick', '9'],
          ['Double Kong Replacement', 'replaces both Kong wins', '13↑'], ['Robbing the Kong', 'the robbed tile joins a sequence', '8'],
          ['Moon Under The Sea', '', '8'] ] },
        { title: 'All Triplets', zh: '對對糊', fan: 3, sub: 'four triplets or quadruplets, plus a pair', rows: [
          ['All Concealed Triplets', 'replaces All Triplets', '8'], ['All Quadruplets', 'replaces All Triplets', '13'],
          ['Dragon', '1 per dragon triplet', '4'], ['Round Wind / Seat Wind', '1 each, 2 if both', '4'],
          ['Small Three Dragons', 'replaces per-triplet Dragon', '8'], ['Big Three Dragons', 'replaces the Dragon scores', '11'],
          ['Small Four Winds', 'replaces Round / Seat Wind', '9'], ['Big Four Winds', 'the limit on its own', '13↑'],
          ['Self-Pick', '', '4'], ['Concealed Hand', '', '4'], ['Win by Kong Replacement', 'replaces Self-Pick', '5'],
          ['Double Kong Replacement', 'replaces both Kong wins', '12'], ['Moon Under The Sea', '', '4'] ] },
        { title: 'Mixed Terminals', zh: '混么九', fan: 4, sub: 'no tile outside 1s, 9s and honours', rows: [
          ['All Concealed Triplets', 'replaces All Triplets', '9'], ['All Quadruplets', 'replaces All Triplets', '13↑'],
          ['Dragon', '1 per dragon triplet', '5'], ['Round Wind / Seat Wind', '1 each, 2 if both', '5'],
          ['Small Three Dragons', 'replaces per-triplet Dragon', '9'], ['Big Three Dragons', 'replaces the Dragon scores', '12'],
          ['Small Four Winds', 'replaces Round / Seat Wind', '10'], ['Big Four Winds', 'the pair carries the 1 or 9', '13↑'],
          ['Self-Pick', '', '5'], ['Concealed Hand', '', '5'], ['Win by Kong Replacement', 'replaces Self-Pick', '6'],
          ['Double Kong Replacement', 'replaces both Kong wins', '13'], ['Moon Under The Sea', '', '5'] ] },
        { title: 'Seven Pairs', zh: '七對子', fan: 4, sub: 'seven different pairs — no sets, so no triplet or Kong bonuses', rows: [
          ['Luxury Seven Pairs', '2 per four-of-a-kind', '6'], ['Mixed Flush', '', '7'], ['Full Flush', '', '11'], ['All Honours', '', '13↑'],
          ['Self-Pick', '', '5'], ['Concealed Hand', 'built in — you never Pong or Chow', '4'], ['Moon Under The Sea', '', '5'] ] },
        { title: 'All Honours', zh: '字一色', fan: 10, sub: 'honour tiles only (winds & dragons)', rows: [
          ['All Concealed Triplets', 'replaces All Triplets', '13↑'], ['All Quadruplets', 'replaces All Triplets', '13↑'],
          ['Seven Pairs', '', '13↑'], ['Luxury Seven Pairs', '2 per four-of-a-kind', '13↑'], ['Dragon', '1 per dragon triplet', '11'],
          ['Round Wind / Seat Wind', '1 each, 2 if both', '11'], ['Small Three Dragons', 'replaces per-triplet Dragon', '13↑'],
          ['Big Three Dragons', 'replaces the Dragon scores', '13↑'], ['Small Four Winds', 'replaces Round / Seat Wind', '13↑'],
          ['Big Four Winds', 'the limit on its own', '13↑'], ['Self-Pick', '', '11'], ['Concealed Hand', '', '11'],
          ['Win by Kong Replacement', 'replaces Self-Pick', '12'], ['Double Kong Replacement', 'replaces both Kong wins', '13↑'],
          ['Moon Under The Sea', '', '11'] ] }
      ]
    }
  ];

  HKMJ.RulesContent = { tabs: TABS };
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.RulesContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
