/* HK Mahjong — tests/_stubs/gas.js
 * Small fakes of the Google Apps Script services used by server/scoreboard.gs (SpreadsheetApp, PropertiesService,
 * LockService, ContentService, Utilities), and makeServer() which loads the script into a fresh VM context.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var ROOT = path.join(__dirname, '..', '..');

function makeServer(opts) {
  opts = opts || {};
  function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor', 'setWrap', 'setFontSize'].forEach(function (m) {
    Range.prototype[m] = function () { return this; };
  });
  Range.prototype.setValues = function (vals) {
    if (vals.length !== this.nr || vals.some(function (row) { return row.length !== this.nc; }, this)) throw new Error('setValues size mismatch on ' + this.s.name);
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s.set(this.r + i, this.c + j, vals[i][j]);
    return this;
  };
  Range.prototype.setFormulas = function (f) { return this.setValues(f); };
  Range.prototype.setValue = function (v) { this.s.set(this.r, this.c, v); return this; };
  Range.prototype.setFormula = function (v) { this.s.set(this.r, this.c, v); return this; };
  Range.prototype.getValue = function () { return this.s.get(this.r, this.c); };
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.nr; i++) { var row = []; for (var j = 0; j < this.nc; j++) row.push(this.s.get(this.r + i, this.c + j)); out.push(row); }
    return out;
  };
  function a1(ref) {   // 'B2' -> [2, 2]; 'B:C' / 'A:A' -> whole columns (formatting only)
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    var col = 0; for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return [+m[2], col];
  }
  function Sheet(name) { this.name = name; this.cells = {}; this.maxR = 0; this.maxC = 0; this.frozen = 0; }
  Sheet.prototype.set = function (r, c, v) {
    if (v === '' || v === null || v === undefined) delete this.cells[r + ',' + c]; else this.cells[r + ',' + c] = v;
    this.recompute();
  };
  Sheet.prototype.recompute = function () {
    var R = 0, C = 0;
    Object.keys(this.cells).forEach(function (k) { var p = k.split(','); R = Math.max(R, +p[0]); C = Math.max(C, +p[1]); });
    this.maxR = R; this.maxC = C;
  };
  Sheet.prototype.get = function (r, c) { var v = this.cells[r + ',' + c]; return v === undefined ? '' : v; };
  Sheet.prototype.getLastRow = function () { return this.maxR; };
  Sheet.prototype.getLastColumn = function () { return this.maxC; };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    if (typeof r === 'string') { var p = a1(r); return p ? new Range(this, p[0], p[1], 1, 1) : new Range(this, 1, 1, 0, 0); }
    return new Range(this, r, c, nr || 1, nc || 1);
  };
  Sheet.prototype.appendRow = function (vals) { var r = this.maxR + 1; for (var j = 0; j < vals.length; j++) this.set(r, j + 1, vals[j]); };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  Sheet.prototype.setFrozenColumns = function () {};
  Sheet.prototype.setColumnWidth = function () {};
  Sheet.prototype.setColumnWidths = function () {};

  var book = { sheets: [new Sheet('Sheet1')] };
  book.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  book.insertSheet = function (n) { var s = new Sheet(n); this.sheets.push(s); return s; };
  book.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
  book.getSheets = function () { return this.sheets.slice(); };
  book.getId = function () { return '1TestSheetId'; };

  var propsStore = {};
  var sandbox = {
    console: console, Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object,
    isFinite: isFinite, Error: Error, RegExp: RegExp,
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return opts.noActive ? null : book; },
      openById: function (id) { if (id !== book.getId()) throw new Error('no spreadsheet ' + id); return book; },
      getUi: function () { throw new Error('no UI in tests'); }
    },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(propsStore, k) ? propsStore[k] : null; },
      setProperty: function (k, v) { propsStore[k] = String(v); },
      deleteProperty: function (k) { delete propsStore[k]; } }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { text: s, setMimeType: function () { return this; } }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function (alg, s) { return Array.prototype.map.call(crypto.createHash('sha256').update(s, 'utf8').digest(), function (b) { return b > 127 ? b - 256 : b; }); },
      getUuid: function () { return crypto.randomUUID(); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server', 'scoreboard.gs'), 'utf8'), sandbox, { filename: 'scoreboard.gs' });


  return {
    sandbox: sandbox, book: book, props: propsStore, opts: opts,
    doPost: function (body) { return JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text); },
    doGet: function (params) { return JSON.parse(sandbox.doGet({ parameter: params || {} }).text); }
  };
}
module.exports = { makeServer: makeServer };
