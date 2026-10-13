#!/usr/bin/env node
/* HK Mahjong — tests/run_all.js  (Owner: back end)
 * Runs tests/run_vectors.js and every tests/*.test.js (each in its own Node process) and prints one summary.
 * Exit code 1 if any suite fails.
 *   node tests/run_all.js             -> everything (full simulation)
 *   node tests/run_all.js --quick     -> passes --quick to suites that support it (shorter simulation / fuzz)
 *   node tests/run_all.js --verbose   -> print each suite's full output, not only its tail
 */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');
var DIR = __dirname;
var args = process.argv.slice(2);
var QUICK = args.indexOf('--quick') >= 0, VERBOSE = args.indexOf('--verbose') >= 0;

var suites = ['run_vectors.js'].concat(fs.readdirSync(DIR).filter(function (f) { return /\.test\.js$/.test(f); }).sort());
var rows = [], failed = 0, t0 = Date.now();

suites.forEach(function (f) {
  var start = Date.now();
  var r = cp.spawnSync(process.execPath, [path.join(DIR, f)].concat(QUICK ? ['--quick'] : []),
    { cwd: path.join(DIR, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  var out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  var lines = out.split('\n').filter(function (l) { return l.trim() !== ''; });
  var ok = r.status === 0 && !r.error;
  if (!ok) failed++;
  // the suite's own summary: its last line that mentions passed/failed
  var summary = lines.filter(function (l) { return /passed|failed|FAIL/i.test(l); }).pop() || lines[lines.length - 1] || '';
  rows.push({ name: f, ok: ok, secs: (Date.now() - start) / 1000, summary: summary.trim(), status: r.status, signal: r.signal });
  console.log('\n=== ' + f + ' ' + (ok ? 'PASS' : 'FAIL') + ' (' + ((Date.now() - start) / 1000).toFixed(1) + ' s)');
  var show = VERBOSE || !ok ? lines : lines.slice(-12);
  if (!VERBOSE && ok && lines.length > show.length) console.log('  ... (' + (lines.length - show.length) + ' more lines)');
  show.forEach(function (l) { console.log('  ' + l); });
});

console.log('\n================================ SUMMARY ================================');
rows.forEach(function (r) {
  var name = (r.name + '                         ').slice(0, 24);
  console.log((r.ok ? 'PASS ' : 'FAIL ') + name + ('     ' + r.secs.toFixed(1)).slice(-6) + ' s   ' + r.summary +
    (r.ok ? '' : '  [exit ' + r.status + (r.signal ? ', ' + r.signal : '') + ']'));
});
console.log('-------------------------------------------------------------------------');
console.log((failed ? 'FAILED: ' + failed + ' of ' : 'ALL PASSED: ') + rows.length + ' suites in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(failed ? 1 : 0);
