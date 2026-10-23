/* CasaFino — encodeur QR minimal — version 2.1 (2026-10-22)
   QR code version 1 (21 × 21), correction H (30 %), mode alphanumérique, jusqu'à 10 caractères
   (suffisant pour les n° de palette « P00001 »). Sans dépendance, utilisable hors ligne.
   Usage : CF_QR.matrice("P00001") → tableau 21 × 21 de booléens (true = module noir). */
var CF_QR = (function () {
  "use strict";
  var TAILLE = 21, DATA_CW = 9, EC_CW = 17, FORMAT_H = 2;
  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function mul(x, y) {                       // multiplication dans GF(2^8), polynôme 0x11D
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  }
  function diviseurRS(degre) {
    var r = []; for (var i = 0; i < degre; i++) r.push(0); r[degre - 1] = 1;
    var racine = 1;
    for (i = 0; i < degre; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = mul(r[j], racine); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      racine = mul(racine, 2);
    }
    return r;
  }
  function resteRS(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function octets(texte) {
    texte = String(texte).toUpperCase();
    if (texte.length < 1 || texte.length > 10) throw new Error("QR : 1 à 10 caractères");
    var bits = [];
    var ajout = function (v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    ajout(2, 4); ajout(texte.length, 9);
    for (var i = 0; i < texte.length; i += 2) {
      var a = ALNUM.indexOf(texte[i]); if (a < 0) throw new Error("QR : caractère non permis « " + texte[i] + " »");
      if (i + 1 < texte.length) {
        var b = ALNUM.indexOf(texte[i + 1]); if (b < 0) throw new Error("QR : caractère non permis « " + texte[i + 1] + " »");
        ajout(a * 45 + b, 11);
      } else ajout(a, 6);
    }
    var cap = DATA_CW * 8;
    ajout(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    var res = [];
    for (i = 0; i < bits.length; i += 8) { var o = 0; for (var j = 0; j < 8; j++) o = (o << 1) | bits[i + j]; res.push(o); }
    for (var p = 0xec; res.length < DATA_CW; p ^= 0xec ^ 0x11) res.push(p);
    return res.concat(resteRS(res, diviseurRS(EC_CW)));
  }

  function base() {
    var m = [], f = [];
    for (var y = 0; y < TAILLE; y++) { m.push([]); f.push([]); for (var x = 0; x < TAILLE; x++) { m[y].push(false); f[y].push(false); } }
    var set = function (x, y, v) { m[y][x] = v; f[y][x] = true; };
    for (var i = 0; i < TAILLE; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [TAILLE - 4, 3], [3, TAILLE - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < TAILLE && yy >= 0 && yy < TAILLE) set(xx, yy, d !== 2 && d !== 4);
      }
    });
    format(m, f, 0);
    return { m: m, f: f };
  }

  function format(m, f, masque) {
    var data = (FORMAT_H << 3) | masque, r = data;
    for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    var bits = ((data << 10) | r) ^ 0x5412;
    var bit = function (i) { return ((bits >>> i) & 1) === 1; };
    var set = function (x, y, v) { m[y][x] = v; f[y][x] = true; };
    for (i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) set(TAILLE - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, TAILLE - 15 + i, bit(i));
    set(8, TAILLE - 8, true);
  }

  function placer(m, f, cw) {
    var i = 0, n = cw.length * 8;
    for (var droite = TAILLE - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (var v = 0; v < TAILLE; v++) for (var j = 0; j < 2; j++) {
        var x = droite - j, haut = ((droite + 1) & 2) === 0, y = haut ? TAILLE - 1 - v : v;
        if (!f[y][x] && i < n) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
  }

  var MASQUES = [
    function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function penalite(m) {
    var p = 0, noirs = 0, x, y;
    for (y = 0; y < TAILLE; y++) for (x = 0; x < TAILLE; x++) if (m[y][x]) noirs++;
    for (var sens = 0; sens < 2; sens++) for (var a = 0; a < TAILLE; a++) {
      var run = 1;
      for (var b = 1; b < TAILLE; b++) {
        var c = sens ? m[b][a] : m[a][b], pc = sens ? m[b - 1][a] : m[a][b - 1];
        if (c === pc) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
    for (y = 0; y < TAILLE - 1; y++) for (x = 0; x < TAILLE - 1; x++)
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    var M1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], M2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (sens = 0; sens < 2; sens++) for (a = 0; a < TAILLE; a++) for (b = 0; b + 11 <= TAILLE; b++) {
      var e1 = true, e2 = true;
      for (var k = 0; k < 11; k++) {
        var v = (sens ? m[b + k][a] : m[a][b + k]) ? 1 : 0;
        if (v !== M1[k]) e1 = false; if (v !== M2[k]) e2 = false;
      }
      if (e1) p += 40; if (e2) p += 40;
    }
    p += Math.floor(Math.abs(noirs * 20 - TAILLE * TAILLE * 10) / (TAILLE * TAILLE)) * 10;
    return p;
  }

  function matrice(texte, masqueForce) {
    var cw = octets(texte), meilleur = null, score = Infinity;
    for (var k = 0; k < 8; k++) {
      if (masqueForce != null && k !== masqueForce) continue;
      var b = base(); placer(b.m, b.f, cw);
      for (var y = 0; y < TAILLE; y++) for (var x = 0; x < TAILLE; x++) if (!b.f[y][x] && MASQUES[k](x, y)) b.m[y][x] = !b.m[y][x];
      format(b.m, b.f, k);
      var s = penalite(b.m);
      if (s < score) { score = s; meilleur = b.m; }
    }
    return meilleur;
  }

  return { matrice: matrice, taille: TAILLE };
})();
if (typeof module !== "undefined") module.exports = CF_QR;
