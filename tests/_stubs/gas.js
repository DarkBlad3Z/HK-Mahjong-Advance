/* HK Mahjong — tests/_stubs/gas.js
 * Small fakes of the Google Apps Script services used by server/scoreboard.gs (SpreadsheetApp, PropertiesService,
 * LockService, ContentService, Utilities), and makeServer() which loads the script into a fresh VM context.
 *   makeServer({ file, book, props, noActive })
 *     file      script to load (default server/scoreboard.gs), e.g. an older version to test upgrades
 *     book/props reuse the spreadsheet and Script Properties of another server (same sheet, new script version)
 *     noActive  behave like a web app, where getActiveSpreadsheet() gives nothing
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
  function colNum(L) { var c = 0; for (var i = 0; i < L.length; i++) c = c * 26 + (L.charCodeAt(i) - 64); return c; }
  function a1(ref) {   // 'B2' -> [2, 2]; 'B:C' / 'A:A' -> whole columns [0, firstCol, lastCol] (formatting only)
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (m) return [+m[2], colNum(m[1])];
    var c = /^([A-Z]+):([A-Z]+)$/.exec(ref);
    return c ? [0, colNum(c[1]), colNum(c[2])] : null;
  }
  // Like a real tab: 1000 rows x 26 columns until the script adds more; ranges outside that throw.
  function Sheet(name) { this.name = name; this.cells = {}; this.maxR = 0; this.maxC = 0; this.frozen = 0; this.rowsN = 1000; this.colsN = 26; }
  function outside() { throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.'); }
  Sheet.prototype.getMaxRows = function () { return this.rowsN; };
  Sheet.prototype.getMaxColumns = function () { return this.colsN; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { if (after < 1 || after > this.colsN || n < 1) outside(); this.colsN += n; return this; };
  Sheet.prototype.insertRowsAfter = function (after, n) { if (after < 1 || after > this.rowsN || n < 1) outside(); this.rowsN += n; return this; };
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
    if (typeof r === 'string') {
      var p = a1(r);
      if (!p) throw new Error('Range not found: ' + r);
      if (p[0] === 0) { if (p[2] > this.colsN) outside(); return new Range(this, 1, 1, 0, 0); }
      if (p[0] > this.rowsN || p[1] > this.colsN) outside();
      return new Range(this, p[0], p[1], 1, 1);
    }
    if (nr === undefined) nr = 1;
    if (nc === undefined) nc = 1;
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > this.rowsN || c + nc - 1 > this.colsN) outside();
    return new Range(this, r, c, nr, nc);
  };
  Sheet.prototype.appendRow = function (vals) {
    var r = this.maxR + 1;
    if (r > this.rowsN) this.rowsN = r;               // appendRow grows the sheet
    if (vals.length > this.colsN) this.colsN = vals.length;
    for (var j = 0; j < vals.length; j++) this.set(r, j + 1, vals[j]);
  };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  Sheet.prototype.setFrozenColumns = function () {};
  Sheet.prototype.setColumnWidth = function () {};
  Sheet.prototype.setColumnWidths = function () {};
  Sheet.prototype.clear = function () { this.cells = {}; this.recompute(); return this; };

  // A reused book keeps the methods (and Sheet class) of the server that made it; they are the same code.
  var book = opts.book;
  if (!book) {
    book = { sheets: [new Sheet('Sheet1')] };
    book.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
    book.insertSheet = function (n) { var s = new Sheet(n); this.sheets.push(s); return s; };
    book.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
    book.getSheets = function () { return this.sheets.slice(); };
    book.getId = function () { return '1TestSheetId'; };
  }

  var propsStore = opts.props || {};
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
  var file = opts.file || path.join(ROOT, 'server', 'scoreboard.gs');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });


  return {
    sandbox: sandbox, book: book, props: propsStore, opts: opts,
    doPost: function (body) { return JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text); },
    doGet: function (params) { return JSON.parse(sandbox.doGet({ parameter: params || {} }).text); }
  };
}
module.exports = { makeServer: makeServer };
