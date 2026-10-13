#!/usr/bin/env node
/* HK Mahjong QA — app_harness.test.js
 * High-volume mechanical testing: exercises the browser controller src/ui/app.js in Node using a fake DOM.
 * Plays complete games as the human by "clicking" buttons, and finds controller bugs (stuck game, exceptions, wrong button wiring).
 *
 * Run: node tests/qa/app_harness.test.js [--verbose]
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '../..');
var CORE = path.join(ROOT, 'src/core');
var UI = path.join(ROOT, 'src/ui');
var VERBOSE = process.argv.indexOf('--verbose') >= 0;

// ================================================================ FAKE DOM & STORAGE

var timerQueue = [];
var timerCounter = 0;
var timersByHandle = {};
var consoleErrors = [];

function fakeSetTimeout(fn, delay) {
  var handle = ++timerCounter;
  timersByHandle[handle] = { fn: fn, delay: Math.max(0, delay || 0), scheduled: Date.now() };
  timerQueue.push(handle);
  return handle;
}
function fakeClearTimeout(handle) {
  if (timersByHandle[handle]) delete timersByHandle[handle];
}
function advanceTimers(maxSteps) {
  var count = 0;
  maxSteps = maxSteps || 50;
  while (timerQueue.length && count < maxSteps) {
    var handle = timerQueue.shift();
    var item = timersByHandle[handle];
    if (item) {
      try { item.fn(); } catch (e) { consoleErrors.push(String(e)); }
      delete timersByHandle[handle];
      count++;
    }
  }
  return count;
}
function clearAllTimers() {
  timerQueue = [];
  timersByHandle = {};
}

var localStorage = {};
var fakeStorage = {
  getItem: function (key) { return localStorage[key] || null; },
  setItem: function (key, val) { localStorage[key] = String(val); },
  removeItem: function (key) { delete localStorage[key]; },
  clear: function () { localStorage = {}; }
};

// Seeded LCG for reproducible randomness
var seed = 0;
function lcg(s) {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  return (s / 0x7fffffff);
}
function setSeed(s) { seed = s; }
function mathRandom() { return lcg(seed = (seed * 1103515245 + 12345) & 0x7fffffff); }

// Fake DOM element
function FakeDOMElement(tag) {
  this.tag = tag;
  this.attributes = {};
  this.innerHTML = '';
  this.children = [];
  this.parentNode = null;
  this.listeners = {};
  this.classList = { add: function () {}, remove: function () {}, contains: function () { return false; } };
  this.style = {};
  this.clientWidth = 1440;
  this.clientHeight = 900;
}
FakeDOMElement.prototype.getAttribute = function (name) {
  return this.attributes[name] || null;
};
FakeDOMElement.prototype.setAttribute = function (name, val) {
  this.attributes[name] = String(val);
};
FakeDOMElement.prototype.hasAttribute = function (name) {
  return name in this.attributes;
};
FakeDOMElement.prototype.addEventListener = function (type, listener) {
  if (!this.listeners[type]) this.listeners[type] = [];
  this.listeners[type].push(listener);
};
FakeDOMElement.prototype.querySelector = function () {
  return null;  // for applyCanvasScale to handle gracefully
};
FakeDOMElement.prototype.querySelectorAll = function () {
  return [];
};

var appElement = new FakeDOMElement('div');
var spriteElement = new FakeDOMElement('div');

var fakeDocument = {
  readyState: 'complete',
  getElementById: function (id) {
    if (id === 'app') return appElement;
    if (id === 'tile-sprite') return spriteElement;
    return null;
  },
  addEventListener: function () {},
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; }
};

var fakeWindow = {
  document: fakeDocument,
  localStorage: fakeStorage,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  addEventListener: function () {},
  HKMJ: null
};

// Override global console.error to catch exceptions
var origConsoleError = console.error;
console.error = function () {
  consoleErrors.push(Array.prototype.slice.call(arguments).join(' '));
  origConsoleError.apply(console, arguments);
};

// ================================================================ SETUP GLOBAL CONTEXT

global.globalThis = global;
global.window = fakeWindow;
global.document = fakeDocument;
global.localStorage = fakeStorage;
global.setTimeout = fakeSetTimeout;
global.clearTimeout = fakeClearTimeout;

// Save original Math.random before overriding
var origMathRandom = Math.random;
global.Math.random = mathRandom;

// ================================================================ LOAD SCRIPTS IN MANIFEST ORDER (using require)

// Clear require cache to ensure fresh loads
Object.keys(require.cache).forEach(function (key) {
  if (key.indexOf('/src/') >= 0 || key.indexOf('/dev/') >= 0) {
    delete require.cache[key];
  }
});

try {
  require(path.join(CORE, 'tiles.js'));
  require(path.join(CORE, 'rng.js'));
  require(path.join(CORE, 'hand.js'));
  require(path.join(CORE, 'scoring.js'));
  require(path.join(CORE, 'engine.js'));
  require(path.join(CORE, 'ai.js'));
  require(path.join(UI, 'tile-art.js'));
  require(path.join(UI, 'rules-content.js'));
  require(path.join(UI, 'render.js'));
  // app.js will auto-init if document.readyState !== 'loading', so we load it last
  require(path.join(UI, 'app.js'));
} catch (e) {
  console.log('FAIL: script loading threw: ' + (e && e.stack || e));
  process.exit(1);
}

var HKMJ = global.HKMJ;
fakeWindow.HKMJ = HKMJ;
if (!HKMJ || !HKMJ.Game || !HKMJ.UI || !HKMJ.App) {
  console.log('FAIL: scripts did not load HKMJ.Game, HKMJ.UI, or HKMJ.App');
  console.log('HKMJ:', !!HKMJ);
  console.log('HKMJ.Game:', !!HKMJ && !!HKMJ.Game);
  console.log('HKMJ.UI:', !!HKMJ && !!HKMJ.UI);
  console.log('HKMJ.App:', !!HKMJ && !!HKMJ.App);
  process.exit(1);
}

// ================================================================ HELPER FUNCTIONS

// Parse HTML for data-action buttons
function parseActions(html) {
  var actions = [];
  var tagRegex = /<[^>]+data-action="([^"]+)"[^>]*>/g;
  var match;
  while ((match = tagRegex.exec(html)) !== null) {
    var fullTag = html.substring(match.index, html.indexOf('>', match.index) + 1);
    var btn = { action: match[1], attrs: {} };

    // Extract all data-* attributes
    var attrRegex = /data-([a-z-]+)="([^"]*)"/g;
    var attrMatch;
    while ((attrMatch = attrRegex.exec(fullTag)) !== null) {
      var key = attrMatch[1];
      var val = attrMatch[2]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
      btn.attrs[key] = val;
    }
    actions.push(btn);
  }
  return actions;
}

// Create a fake target element with attributes for click dispatch
function createFakeTarget(btn) {
  var el = new FakeDOMElement('button');
  el.setAttribute('data-action', btn.action);
  Object.keys(btn.attrs).forEach(function (k) {
    el.setAttribute('data-' + k, btn.attrs[k]);
  });
  return el;
}

function runGame(settings, gameNum, seed) {
  setSeed(seed);
  clearAllTimers();
  consoleErrors = [];
  localStorage = {};
  appElement.innerHTML = '';
  appElement.listeners = {};
  timerCounter = 0;

  // Pre-seed settings
  fakeStorage.setItem('hkmj.settings.v1', JSON.stringify(settings));

  // Initialize app
  try {
    HKMJ.App.init();
  } catch (e) {
    return {
      gameNum: gameNum, seed: seed,
      completed: false, steps: 0,
      error: 'HKMJ.App.init() threw: ' + String(e)
    };
  }

  // Simulate the start sequence: click "request-new-game", then "settings-save"
  var step = 0;
  var maxSteps = 5000;
  var lastProgressStep = 0;
  var gameState = 'start';

  while (step < maxSteps && gameState !== 'complete') {
    step++;

    // Run any due timers
    advanceTimers(10);

    // Get current HTML
    var html = appElement.innerHTML || '';
    var actions = parseActions(html);

    // Detect screen state
    var hasGameOverModal = html.indexOf('gameover-modal') >= 0 || html.indexOf('Game Over') >= 0;

    if (gameState === 'start') {
      var newGameBtn = actions.find(function (a) { return a.action === 'request-new-game'; });
      if (newGameBtn) {
        var el = createFakeTarget(newGameBtn);
        var listener = appElement.listeners.click && appElement.listeners.click[0];
        if (listener) listener({ target: el });
        lastProgressStep = step;
        gameState = 'settings';
      }
    } else if (gameState === 'settings') {
      var saveBtn = actions.find(function (a) { return a.action === 'settings-save'; });
      if (saveBtn) {
        var el = createFakeTarget(saveBtn);
        var listener = appElement.listeners.click && appElement.listeners.click[0];
        if (listener) listener({ target: el });
        lastProgressStep = step;
        gameState = 'playing';
      }
    } else if (gameState === 'playing' && hasGameOverModal) {
      gameState = 'complete';
    } else if (gameState === 'playing') {
      // Look for actions
      var actButtons = actions.filter(function (a) { return a.action === 'act'; });
      var pickButtons = actions.filter(function (a) { return a.action === 'pick-option'; });
      var nextHandBtn = actions.find(function (a) { return a.action === 'next-hand'; });
      var tileButtons = actions.filter(function (a) { return a.action === 'tile-click'; });
      var hintBtn = actions.find(function (a) { return a.action === 'hint-button'; });
      var soundBtn = actions.find(function (a) { return a.action === 'toggle-sound'; });

      if (nextHandBtn && gameState === 'playing') {
        // Click next-hand
        var el = createFakeTarget(nextHandBtn);
        var listener = appElement.listeners.click && appElement.listeners.click[0];
        if (listener) listener({ target: el });
        lastProgressStep = step;
      } else if (pickButtons.length > 0) {
        // Pick a random option
        var idx = Math.floor(Math.random() * pickButtons.length);
        var btn = pickButtons[idx];
        var el = createFakeTarget(btn);
        var listener = appElement.listeners.click && appElement.listeners.click[0];
        if (listener) listener({ target: el });
        lastProgressStep = step;
      } else if (actButtons.length > 0) {
        // Look for a win action first
        var winBtn = actButtons.find(function (b) {
          var type = b.attrs.type;
          return type === 'selfWin' || type === 'win' || type === 'flowerWin';
        });
        if (winBtn) {
          var el = createFakeTarget(winBtn);
          var listener = appElement.listeners.click && appElement.listeners.click[0];
          if (listener) listener({ target: el });
          lastProgressStep = step;
        } else {
          // Pick a random act button
          var idx = Math.floor(Math.random() * actButtons.length);
          var btn = actButtons[idx];
          var el = createFakeTarget(btn);
          var listener = appElement.listeners.click && appElement.listeners.click[0];
          if (listener) listener({ target: el });
          lastProgressStep = step;
        }
      } else if (tileButtons.length > 0) {
        // Try to discard: click a tile twice (or try hint/sound buttons first occasionally)
        if (hintBtn && Math.random() < 0.1) {
          var el = createFakeTarget(hintBtn);
          var listener = appElement.listeners.click && appElement.listeners.click[0];
          if (listener) listener({ target: el });
          lastProgressStep = step;
        } else if (soundBtn && Math.random() < 0.05) {
          var el = createFakeTarget(soundBtn);
          var listener = appElement.listeners.click && appElement.listeners.click[0];
          if (listener) listener({ target: el });
          lastProgressStep = step;
        } else {
          var idx = Math.floor(Math.random() * tileButtons.length);
          var btn = tileButtons[idx];
          var el = createFakeTarget(btn);
          var listener = appElement.listeners.click && appElement.listeners.click[0];
          if (listener) {
            listener({ target: el }); // First click selects
            var newHtml = appElement.innerHTML || '';
            var newActions = parseActions(newHtml);
            var sameBtn = newActions.find(function (a) {
              return a.action === 'tile-click' && a.attrs.index === btn.attrs.index;
            });
            if (sameBtn) {
              var el2 = createFakeTarget(sameBtn);
              listener({ target: el2 }); // Second click discards
            }
          }
          lastProgressStep = step;
        }
      } else {
        // No valid actions but not game over yet: check for stuck
        if (step - lastProgressStep > 100) {
          return {
            gameNum: gameNum, seed: seed,
            completed: false, steps: step,
            error: 'stuck: no action buttons found, timer queue empty, not game over',
            html: html.substring(0, 500)
          };
        }
      }
    }

    // Check for exceptions
    if (consoleErrors.length > 0) {
      return {
        gameNum: gameNum, seed: seed,
        completed: false, steps: step,
        error: 'console.error called: ' + consoleErrors[consoleErrors.length - 1]
      };
    }
  }

  if (step >= maxSteps) {
    return {
      gameNum: gameNum, seed: seed,
      completed: false, steps: step,
      error: 'max steps exceeded without completing game'
    };
  }

  if (gameState !== 'complete') {
    return {
      gameNum: gameNum, seed: seed,
      completed: false, steps: step,
      error: 'gameState = ' + gameState + ' (expected "complete")'
    };
  }

  return {
    gameNum: gameNum, seed: seed,
    completed: true, steps: step,
    error: null
  };
}

// ================================================================ RUN TESTS

console.log('app_harness.test.js: Testing HK Mahjong browser controller');
console.log('');

var results = [];
var gameNum = 0;

// Run 30+ games with default settings and different seeds
var defaultSettings = {
  minFan: 3,
  payment: 'full',
  unit: 'points',
  rounds: 1,
  aiLevel: 'normal',
  startingScore: 0,
  optional: {
    kong: false,
    sevenPairs: true,
    luxurySevenPairs: true,
    knitted: true,
    lesserHonours: true,
    greaterHonours: true
  },
  name: 'You',
  speed: 'fast',
  hints: true,
  sound: false
};

for (var i = 0; i < 35; i++) {
  gameNum++;
  var result = runGame(defaultSettings, gameNum, i * 12347);
  results.push(result);
  if (VERBOSE) console.log('Game ' + gameNum + ': ' + (result.completed ? 'OK' : 'FAIL') + ' (' + result.steps + ' steps)');
}

// Run 5 games with relaxed speed and 4 rounds
var relaxedSettings = JSON.parse(JSON.stringify(defaultSettings));
relaxedSettings.speed = 'relaxed';
relaxedSettings.rounds = 4;

for (var i = 0; i < 5; i++) {
  gameNum++;
  var result = runGame(relaxedSettings, gameNum, (100 + i) * 12347);
  results.push(result);
  if (VERBOSE) console.log('Game ' + gameNum + ': ' + (result.completed ? 'OK' : 'FAIL') + ' (' + result.steps + ' steps)');
}

// Run 5 games with different AI levels
var aiLevels = ['easy', 'normal', 'hard'];
for (var i = 0; i < aiLevels.length; i++) {
  gameNum++;
  var aiSettings = JSON.parse(JSON.stringify(defaultSettings));
  aiSettings.aiLevel = aiLevels[i];
  aiSettings.rounds = 1;
  var result = runGame(aiSettings, gameNum, (200 + i) * 12347);
  results.push(result);
  if (VERBOSE) console.log('Game ' + gameNum + ' (ai=' + aiLevels[i] + '): ' + (result.completed ? 'OK' : 'FAIL') + ' (' + result.steps + ' steps)');
}

// Run 3 games with different minFan values
var minFanValues = [0, 3, 5];
for (var i = 0; i < minFanValues.length; i++) {
  gameNum++;
  var fanSettings = JSON.parse(JSON.stringify(defaultSettings));
  fanSettings.minFan = minFanValues[i];
  fanSettings.rounds = 1;
  var result = runGame(fanSettings, gameNum, (300 + i) * 12347);
  results.push(result);
  if (VERBOSE) console.log('Game ' + gameNum + ' (minFan=' + minFanValues[i] + '): ' + (result.completed ? 'OK' : 'FAIL') + ' (' + result.steps + ' steps)');
}

// Run 2 games with optional rules enabled
for (var i = 0; i < 2; i++) {
  gameNum++;
  var optSettings = JSON.parse(JSON.stringify(defaultSettings));
  optSettings.optional.kong = i === 0; // Enable kong in first variant
  optSettings.rounds = 1;
  var result = runGame(optSettings, gameNum, (400 + i) * 12347);
  results.push(result);
  if (VERBOSE) console.log('Game ' + gameNum + ' (kong=' + optSettings.optional.kong + '): ' + (result.completed ? 'OK' : 'FAIL') + ' (' + result.steps + ' steps)');
}

// ================================================================ REPORT

console.log('');
console.log('=== RESULTS ===');
var passed = results.filter(function (r) { return r.completed; }).length;
var failed = results.filter(function (r) { return !r.completed; }).length;

console.log('Completed: ' + passed + '/' + results.length);
console.log('Failed: ' + failed + '/' + results.length);

if (failed > 0) {
  console.log('');
  console.log('=== FAILURES ===');
  results.filter(function (r) { return !r.completed; }).forEach(function (r) {
    console.log('');
    console.log('Game ' + r.gameNum + ' (seed ' + r.seed + '): ' + r.error);
    console.log('  Steps: ' + r.steps);
    if (r.html) console.log('  HTML context: ' + r.html);
  });
}

// Summary stats
var totalSteps = results.reduce(function (sum, r) { return sum + r.steps; }, 0);
var avgSteps = Math.round(totalSteps / results.length);
console.log('');
console.log('Average steps per game: ' + avgSteps);
console.log('Total steps: ' + totalSteps);

process.exit(failed > 0 ? 1 : 0);
