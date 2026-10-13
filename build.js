#!/usr/bin/env node
/* HK Mahjong — build.js (Owner: orchestrator)
 * Inlines CSS + JS listed in build.manifest.json into the HTML template -> one self-contained file.
 *   node build.js            -> writes manifest.output (default index.html)
 *   node build.js --out X    -> writes X instead
 *   node build.js --min      -> also strips whole-line block comments and blank lines (smaller file for browser injection tests)
 *   node build.js --manifest dev/build.dev.manifest.json   -> use another manifest (e.g. with dev/mock-engine.js)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = __dirname;
var args = process.argv.slice(2);
var mIdx = args.indexOf('--manifest');   // e.g. --manifest dev/build.dev.manifest.json (paths inside stay relative to ROOT)
var manifest = JSON.parse(fs.readFileSync(path.join(ROOT, mIdx >= 0 ? args[mIdx + 1] : 'build.manifest.json'), 'utf8'));
var outIdx = args.indexOf('--out');
var out = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(ROOT, manifest.output);
var MIN = args.indexOf('--min') >= 0;

function read(rel) {
  var p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('build: missing ' + rel);
  return fs.readFileSync(p, 'utf8');
}
function strip(src) {
  if (!MIN) return src;
  // conservative: drop /* ... */ blocks that start at line beginnings and blank lines
  return src.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '').replace(/\n\s*\n+/g, '\n');
}

var tpl = read(manifest.template);
var css = manifest.css.map(function (f) { return '/* ---- ' + f + ' ---- */\n' + strip(read(f)); }).join('\n');
var js = manifest.js.map(function (f) {
  var src = strip(read(f));
  if (src.indexOf('</script') >= 0) throw new Error('build: ' + f + ' contains "</script" — escape it');
  return '/* ---- ' + f + ' ---- */\n' + src;
}).join('\n;\n');

if (tpl.indexOf('/*__CSS__*/') < 0 || tpl.indexOf('/*__JS__*/') < 0) throw new Error('build: template needs /*__CSS__*/ and /*__JS__*/ placeholders');
var html = tpl.replace('/*__CSS__*/', function () { return css; }).replace('/*__JS__*/', function () { return js; });
fs.writeFileSync(out, html);
console.log('build: wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB, ' + manifest.js.length + ' js files)');
