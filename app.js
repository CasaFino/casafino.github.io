/* CasaFino — app installable — version 3.0 (2026-10-23)
   v3.0 : étape 3 — ventes (module vente.js) : devis, encaissements, reçu, bon de sortie, factures, caisse, validations.
   v2.3 : zones du dépôt 01 avec leur occupation (palettes / capacité) dans les listes.
   v2.2 : carnets de 150 étiquettes au format validé (marge d'agrafage, ordre droite puis gauche, souche recto verso).
   v2.1 : carnets de 100 étiquettes QR (6 par A4) en PDF pour l'imprimerie, sans connexion à un service externe.
   v2.0 : étape 2 — accueil par rôle, réception par arrivage, palettes QR, déplacement, casse, inventaire,
          à repositionner, étiquettes imprimables, file d'opérations hors ligne synchronisée.
   v1.1 : logo CasaFino. v1.0 : activation, connexion PIN, catalogue hors ligne, calcul de vente. */
"use strict";
var APP_VERSION = "3.0";
var API = "https://script.google.com/macros/s/AKfycbw2afPgs_lQHn9eN4gUd5zxdiLT_CpLNkNrRbOabBetxUs8Fsx__WRzXmfzkkHKtC9A/exec";
var LIB_QR_LECTURE = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
var ROLES_DEPOT = ["Magasinier", "Direction"];
var MOTIFS_CASSE = ["Manutention", "Transport", "Défaut de fabrication", "Autre"];

// ── Stockage local (protégé) ─────────────────────────────────
var S = {
  get: function (k, def) { try { var v = localStorage.getItem("cf_" + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set: function (k, v) { try { localStorage.setItem("cf_" + k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem("cf_" + k); } catch (e) {} }
};

var etat = {
  serveur: S.get("donnees", null),   // dernières données reçues du serveur
  donnees: null,                     // données serveur + opérations en attente appliquées localement
  categorie: "Toutes", recherche: "", article: null, reception: null, palette: null, vue: null
};
var $ = function (id) { return document.getElementById(id); };

// ── Formatage ────────────────────────────────────────────────
function nb(n, d) { return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d }).replace(/ | /g, " "); }
function gnf(n) { return nb(Math.round(n || 0), 0) + " GNF"; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function sansAccent(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function dateMaj(m) { var p = String(m || "").split(" "); return p.length === 2 ? p[0].split("-").reverse().join("/") + " à " + p[1] : String(m || "—"); }
function idPalette(s) { var m = String(s || "").toUpperCase().match(/P\d{5}/); return m ? m[0] : ""; }
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function session() { return S.get("session", {}) || {}; }
function estDepot() { return ROLES_DEPOT.indexOf(session().role) >= 0; }

var toastT = null;
function toast(msg, erreur) {
  var t = $("toast"); t.textContent = msg; t.className = erreur ? "erreur" : ""; clearTimeout(toastT);
  toastT = setTimeout(function () { t.className = "cache"; }, erreur ? 6000 : 3000);
}

function chargerScript(url) {
  return new Promise(function (ok, ko) {
    var deja = document.querySelector('script[src="' + url + '"]');
    if (deja && deja.dataset.ok) return ok();
    if (deja) deja.remove();
    var s = document.createElement("script"); s.src = url;
    s.onload = function () { s.dataset.ok = "1"; ok(); };
    s.onerror = function () { s.remove(); ko(new Error("Chargement impossible (réseau ?) : " + url)); };
    document.head.appendChild(s);
  });
}

// ── API ──────────────────────────────────────────────────────
function api(action, donnees) {
  var corps = Object.assign({ action: action, key: S.get("cle", ""), token: S.get("token", "") }, donnees || {});
  return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(corps), redirect: "follow" })
    .then(function (r) { if (!r.ok) throw new Error("Serveur indisponible (" + r.status + ")"); return r.json(); })
    .then(function (j) {
      if (!j.ok) { var e = new Error(j.erreur || "Erreur"); e.reconnexion = !!j.reconnexion; throw e; }
      return j;
    });
}

// ── Vues ─────────────────────────────────────────────────────
var VUES = ["vCle", "vLogin", "vAccueil", "vCatalogue", "vFiche", "vReceptions", "vReception", "vPalette", "vInventaire", "vRepos", "vEtiquettes", "vSync", "vMenu"];
function voir(id) {
  VUES.forEach(function (v) { $(v).classList.toggle("cache", v !== id); });
  etat.vue = id;
  var connecte = id !== "vCle" && id !== "vLogin";
  $("bActu").classList.toggle("cache", !connecte);
  $("bMenu").classList.toggle("cache", !connecte);
  window.scrollTo(0, 0);
}

var AFFICHAGES = {
  accueil: function () { afficherAccueil(); }, catalogue: function () { afficherCatalogue(); },
  receptions: function () { afficherReceptions(); }, palette: function () { afficherPaletteVue(); },
  inventaire: function () { afficherInventaire(); }, repos: function () { afficherRepos(); },
  etiquettes: function () { afficherEtiquettes(); }, sync: function () { afficherSync(); }
};
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-aller]"); if (!b) return;
  var f = AFFICHAGES[b.getAttribute("data-aller")]; if (f) f();
});

/** Réaffiche la vue courante après un changement de données. */
function rafraichirVue() {
  switch (etat.vue) {
    case "vAccueil": afficherAccueil(); break;
    case "vCatalogue": afficherCatalogue(); break;
    case "vFiche": if (etat.article) afficherFiche(etat.article); break;
    case "vReceptions": afficherReceptions(); break;
    case "vReception": if (etat.reception) afficherReception(etat.reception); break;
    case "vPalette": afficherPaletteVue(); break;
    case "vInventaire": afficherInventaire(); break;
    case "vRepos": afficherRepos(); break;
    case "vEtiquettes": afficherEtiquettes(); break;
    case "vSync": afficherSync(); break;
    default: if (typeof rafraichirVente === "function") rafraichirVente(etat.vue);
  }
}

function majEtat() {
  var en = navigator.onLine, n = file().length, err = erreurs().length, p = $("etatReseau");
  p.textContent = (en ? "En ligne" : "Hors ligne") + (n ? " · " + n + " en attente" : "") + (err ? " · " + err + " ⚠" : "");
  p.classList.toggle("hors", !en);
  p.classList.toggle("attente", en && (n > 0 || err > 0));
}

function majEntete() {
  var s = session();
  $("hAgent").textContent = s.agent ? s.agent + " · " + s.role : "";
  $("pied").textContent = "CasaFino app " + APP_VERSION + (etat.serveur ? " · API " + etat.serveur.version : "");
  majEtat();
}

// ── Démarrage, activation, connexion ─────────────────────────
function demarrer() {
  recomposer(); majEntete();
  if (!S.get("cle", "")) return voir("vCle");
  if (!S.get("token", "")) return voir("vLogin");
  afficherAccueil();
  if (navigator.onLine) synchroniser();
}

$("bCle").onclick = function () {
  var c = $("iCle").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(c)) { $("eCle").textContent = "Format attendu : ABCD-EFGH"; return; }
  if (c.indexOf("-") < 0) c = c.slice(0, 4) + "-" + c.slice(4);
  S.set("cle", c); $("eCle").textContent = ""; voir("vLogin");
};
$("bChangerCle").onclick = function () { S.del("cle"); S.del("token"); $("iCle").value = ""; voir("vCle"); };

$("bLogin").onclick = function () {
  var agent = $("iAgent").value.trim(), pin = $("iPin").value.trim();
  if (!agent || !pin) { $("eLogin").textContent = "Nom et PIN obligatoires."; return; }
  if (!navigator.onLine) { $("eLogin").textContent = "Pas de réseau : la connexion demande Internet."; return; }
  var b = $("bLogin"); b.disabled = true; b.textContent = "Connexion…"; $("eLogin").textContent = "";
  api("login", { agent: agent, pin: pin }).then(function (j) {
    var avant = session().agent;
    if (avant && avant !== j.agent && file().length) toast("Opérations de " + avant + " encore en attente : elles seront envoyées avec ce compte.", true);
    S.set("token", j.token); S.set("session", { agent: j.agent, role: j.role, appareil: j.appareil });
    S.set("dernierAgent", j.agent); $("iPin").value = "";
    majEntete(); afficherAccueil();
    return synchroniser();
  }).catch(function (e) {
    $("eLogin").textContent = e.message;
  }).then(function () { b.disabled = false; b.textContent = "Se connecter"; });
};
$("iPin").addEventListener("keydown", function (e) { if (e.key === "Enter") $("bLogin").click(); });

function deconnecter(message) {
  if (S.get("token", "") && navigator.onLine) api("logout").catch(function () {});
  S.del("token"); majEntete();
  $("iAgent").value = S.get("dernierAgent", "");
  $("eLogin").textContent = message || "";
  voir("vLogin");
}

// ── File d'opérations hors ligne ─────────────────────────────
function file() { return S.get("file", []) || []; }
function erreurs() { return S.get("erreurs", []) || []; }

/** Ajoute une opération : appliquée tout de suite sur le téléphone, envoyée dès qu'il y a du réseau. */
function ajouterOperation(type, data) {
  var op = { jeton: uuid(), type: type, date: new Date().toISOString(), data: data, agent: session().agent, role: session().role };
  var f = file(); f.push(op); S.set("file", f);
  recomposer(); majEtat();
  synchroniser();
  return op;
}

var syncEnCours = false;
function synchroniser() {
  if (syncEnCours || !navigator.onLine || !S.get("token", "")) return Promise.resolve();
  var f = file();
  if (!f.length) return actualiser();
  syncEnCours = true; majEtat();
  var lot = f.slice(0, 50);
  return api("sync", { ops: lot.map(function (o) { return { jeton: o.jeton, type: o.type, date: o.date, data: o.data }; }) })
    .then(function (j) {
      var parJeton = {}; j.resultats.forEach(function (r) { parJeton[r.jeton] = r; });
      var reste = file().filter(function (o) { return !parJeton[o.jeton]; });
      var err = erreurs(), nErr = 0;
      lot.forEach(function (o) {
        var r = parJeton[o.jeton];
        if (r && !r.ok) { err.push({ op: o, erreur: r.erreur, le: new Date().toISOString() }); nErr++; }
      });
      S.set("file", reste); S.set("erreurs", err);
      if (nErr) toast(nErr + " opération(s) refusée(s) par le serveur : voir Synchronisation.", true);
      syncEnCours = false;
      if (reste.length) return synchroniser();
      return actualiser();
    })
    .catch(function (e) {
      syncEnCours = false; majEtat();
      if (e.reconnexion) return deconnecter(e.message);
      toast("Synchronisation impossible : " + e.message, true);
    });
}

var actuEnCours = false;
function actualiser() {
  if (actuEnCours || !navigator.onLine) { majEtat(); return Promise.resolve(); }
  actuEnCours = true; $("bActu").style.opacity = ".5";
  return api("data").then(function (j) {
    etat.serveur = j; S.set("donnees", j);
    var s = session(); S.set("session", { agent: j.agent, role: j.role, appareil: s.appareil });
    recomposer(); majEntete(); rafraichirVue();
  }).catch(function (e) {
    if (e.reconnexion) return deconnecter(e.message);
    toast("Actualisation impossible : " + e.message, true);
  }).then(function () { actuEnCours = false; $("bActu").style.opacity = "1"; majEtat(); });
}

/** Données affichées = données serveur + opérations encore en attente. */
function recomposer() {
  if (!etat.serveur) { etat.donnees = null; return; }
  var d = JSON.parse(JSON.stringify(etat.serveur));
  ["palettes", "receptions", "etiquettesLibres", "alertes", "zones"].forEach(function (k) { if (!d[k]) d[k] = []; });
  file().forEach(function (op) { try { appliquer(d, op); } catch (e) {} });
  if (estDepot() || (d.palettes && d.palettes.length)) recalculerStock(d);
  etat.donnees = d;
}

function palette(d, id) { id = idPalette(id); return d.palettes.filter(function (p) { return p.id === id; })[0] || null; }
function article(d, code) { return d.articles.filter(function (a) { return a.code === code; })[0] || null; }
function zoneParCle(d, cle) { return d.zones.filter(function (z) { return z.cle === cle; })[0] || null; }

function appliquer(d, op) {
  var x = op.data, p;
  switch (op.type) {
    case "reception":
      d.palettes.push({ id: x.palette, code: x.code, lot: x.lot, depot: (zoneParCle(d, x.zone) || {}).depot || "", zone: (zoneParCle(d, x.zone) || {}).zone || x.zone,
        cartons: x.cartons, recus: x.cartons, reception: x.reception, local: true });
      d.etiquettesLibres = d.etiquettesLibres.filter(function (e) { return e !== x.palette; });
      var r = d.receptions.filter(function (r) { return r.numero === x.reception; })[0];
      if (r) {
        var l = r.lignes.filter(function (l) { return l.code === x.code; })[0];
        if (!l) { l = { code: x.code, attendus: 0, recus: 0 }; r.lignes.push(l); }
        l.recus += x.cartons;
      }
      break;
    case "transfert":
      p = palette(d, x.palette); if (p) { var z = zoneParCle(d, x.zone); if (z) { p.depot = z.depot; p.zone = z.zone; } }
      break;
    case "casse":
      p = palette(d, x.palette); if (p) p.cartons = Math.max(0, p.cartons - x.cartons);
      break;
    case "inventaire":
      p = palette(d, x.palette); if (p) p.cartons = x.cartons;
      break;
    case "repositionner":
      var zr = zoneParCle(d, x.zone);
      d.palettes.forEach(function (q) { if (q.code === x.code && q.cartons > 0 && zr) { q.depot = zr.depot; q.zone = zr.zone; } });
      d.alertes = d.alertes.filter(function (a) { return a.code !== x.code; });
      d.alertes.push({ code: x.code, statut: "Repositionnée", zone: x.zone });
      break;
    default:
      if (typeof appliquerVente === "function") appliquerVente(d, op);
  }
}

function recalculerStock(d) {
  var st = {};
  d.palettes.forEach(function (p) {
    if (!(p.cartons > 0)) return;
    var s = st[p.code] || (st[p.code] = { cartons: 0, palettes: 0, lots: {} });
    s.cartons += p.cartons; s.palettes++; s.lots[p.lot || "—"] = (s.lots[p.lot || "—"] || 0) + p.cartons;
  });
  d.articles.forEach(function (a) {
    var s = st[a.code] || { cartons: 0, palettes: 0, lots: {} };
    a.stockCartons = s.cartons; a.palettes = s.palettes; a.lots = s.lots;
    a.stockM2 = Math.round(s.cartons * a.m2Carton * 100) / 100;
    a.alerte = s.cartons <= 0 ? "Pas de stock" : (a.cartonsPalette > 0 && s.cartons <= a.cartonsPalette ? "Fin de palette" : "");
  });
}

// ── Accueil ──────────────────────────────────────────────────
function aRepositionner(d) {
  if (!d) return [];
  var faits = {}; d.alertes.forEach(function (a) { if (a.statut === "Repositionnée") faits[a.code] = 1; });
  return d.articles.filter(function (a) { return a.alerte === "Fin de palette" && !faits[a.code]; });
}

function afficherAccueil() {
  voir("vAccueil");
  var d = etat.donnees, depot = estDepot(), dir = session().role === "Direction";
  var t = [["catalogue", "🏷️", "Catalogue", 0]];
  if (depot) {
    t.push(["receptions", "📦", "Réception", d ? d.receptions.length : 0]);
    t.push(["palette", "🔍", "Palette", 0]);
    t.push(["inventaire", "📋", "Inventaire", S.get("inventaire", null) ? "en cours" : 0]);
    t.push(["repos", "↪️", "À repositionner", aRepositionner(d).length]);
  }
  if (dir) t.push(["etiquettes", "🖨️", "Étiquettes", 0]);
  if (typeof tuilesVente === "function") tuilesVente(t);
  t.push(["sync", "⇅", "Synchronisation", file().length + erreurs().length]);
  $("tuiles").innerHTML = t.map(function (x) {
    return '<div class="tuile" data-aller="' + x[0] + '"><span class="ic">' + x[1] + "</span><b>" + x[2] + "</b>" +
      (x[3] ? '<span class="nb">' + esc(x[3]) + "</span>" : "") + "</div>";
  }).join("");
  $("infoAccueil").textContent = d ? "Données du " + dateMaj(d.maj) : "Aucune donnée : connectez-vous au réseau puis ⟳.";
}
$("hTitre").onclick = function () { if (S.get("token", "")) afficherAccueil(); };

// ── Prix et calcul de vente ──────────────────────────────────
function prixApplicable(a, m2) {
  var p = a.prixDetail, src = "Détail";
  if (a.palierMini > 0 && a.palierPrix > 0 && m2 >= a.palierMini && a.palierPrix < p) { p = a.palierPrix; src = "Demi-gros (≥ " + nb(a.palierMini, 0) + " m²)"; }
  if (a.promoPrix > 0 && a.promoPrix < p) { p = a.promoPrix; src = "Promotion jusqu'au " + a.promoAu.split("-").reverse().join("/"); }
  return { prix: p, source: src };
}

function calculer(a, m2Demande) {
  var r = { ok: false };
  if (!(m2Demande > 0) || !(a.m2Carton > 0)) return r;
  var cartons = Math.ceil(m2Demande / a.m2Carton - 1e-9);
  r = { ok: true, cartons: cartons, m2: Math.round(cartons * a.m2Carton * 100) / 100 };
  var pa = prixApplicable(a, r.m2);
  r.prix = pa.prix; r.source = pa.source; r.total = Math.round(r.m2 * pa.prix);
  var mini = a.reliquatMini || 40, lots = a.lots || {}, valides = [], entiers = [];
  Object.keys(lots).forEach(function (lot) {
    var c = lots[lot]; if (c < cartons) return;
    var reste = Math.round((c - cartons) * a.m2Carton * 100) / 100;
    if (reste === 0 || reste >= mini) valides.push({ lot: lot, cartons: c, reste: reste });
    else entiers.push({ lot: lot, cartons: c, m2: Math.round(c * a.m2Carton * 100) / 100, reste: reste });
  });
  valides.sort(function (x, y) { return x.reste - y.reste; });
  entiers.sort(function (x, y) { return x.cartons - y.cartons; });
  r.lot = valides[0] || null; r.lotEntier = entiers[0] || null; r.reliquatMini = mini;
  return r;
}

// ── Catalogue ────────────────────────────────────────────────
function afficherCatalogue() {
  voir("vCatalogue");
  var d = etat.donnees;
  if (!d) { $("liste").innerHTML = '<div class="vide">Aucune donnée. Connectez-vous au réseau puis ⟳.</div>'; $("chips").innerHTML = ""; return; }
  var cats = ["Toutes"].concat(d.categories.map(function (c) { return c.categorie; }));
  if (cats.indexOf(etat.categorie) < 0) etat.categorie = "Toutes";
  $("chips").innerHTML = cats.map(function (c) {
    return '<button class="chip' + (c === etat.categorie ? " on" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
  }).join("");
  var q = sansAccent(etat.recherche);
  var arts = d.articles.filter(function (a) {
    if (etat.categorie !== "Toutes" && a.categorie !== etat.categorie) return false;
    return !q || sansAccent(a.designation + " " + a.code + " " + a.format).indexOf(q) >= 0;
  });
  $("liste").innerHTML = arts.length ? arts.map(function (a) {
    var pa = prixApplicable(a, 0), badge = "";
    if (a.promoPrix > 0) badge = '<span class="badge promo">Promo</span> ';
    if (a.alerte === "Fin de palette") badge += '<span class="badge fin">Fin de palette · ' + nb(a.stockM2, 0) + " m²</span>";
    else if (a.stockCartons > 0) badge += '<span class="badge ok">' + nb(a.stockM2, 0) + " m²</span>";
    else badge += '<span class="badge">Pas de stock</span>';
    return '<div class="carte art" data-code="' + esc(a.code) + '"><div class="g"><b>' + esc(a.designation) + "</b>" +
      '<span class="info">' + esc(a.format) + " · " + esc(a.code) + "</span><br>" + badge + "</div>" +
      '<div class="d"><span class="prix">' + nb(pa.prix, 0) + '</span><br><span class="info">GNF/m²</span></div></div>';
  }).join("") : '<div class="vide">Aucun article.</div>';
  $("infoMaj").textContent = "Données du " + dateMaj(d.maj) + " · " + d.articles.length + " articles";
}
$("chips").onclick = function (e) { var b = e.target.closest(".chip"); if (!b) return; etat.categorie = b.getAttribute("data-cat"); afficherCatalogue(); };
$("iRech").oninput = function () { etat.recherche = this.value; afficherCatalogue(); };
$("liste").onclick = function (e) { var c = e.target.closest(".art"); if (c) afficherFiche(c.getAttribute("data-code")); };

// ── Fiche article ────────────────────────────────────────────
function afficherFiche(code) {
  var d = etat.donnees, a = d && article(d, code);
  if (!a) return afficherCatalogue();
  etat.article = code; voir("vFiche");
  var lots = Object.keys(a.lots || {});
  var pals = (d.palettes || []).filter(function (p) { return p.code === code && p.cartons > 0; });
  var h = '<div class="carte"><h2>' + esc(a.designation) + '</h2><div class="info">' + esc(a.code) + " · " + esc(a.categorie) + "</div>" +
    '<h3>Prix</h3><table><tr><td>Détail</td><td><b>' + gnf(a.prixDetail) + "/m²</b></td></tr>" +
    (a.palierMini > 0 ? "<tr><td>À partir de " + nb(a.palierMini, 0) + " m²</td><td>" + gnf(a.palierPrix) + "/m²</td></tr>" : "") +
    (a.promoPrix > 0 ? "<tr><td>Promotion (jusqu'au " + a.promoAu.split("-").reverse().join("/") + ")</td><td>" + gnf(a.promoPrix) + "/m²</td></tr>" : "") +
    (a.prixAchatEur != null ? "<tr><td>Prix d'achat (direction)</td><td>" + nb(a.prixAchatEur) + " EUR/m²</td></tr>" : "") +
    '</table><h3>Conditionnement</h3><div class="grille">' +
    "<div><span>Format</span><b>" + esc(a.format) + " cm</b></div>" +
    "<div><span>m² par carton</span><b>" + nb(a.m2Carton, 3) + "</b></div>" +
    "<div><span>Pièces par carton</span><b>" + nb(a.piecesCarton, 0) + "</b></div>" +
    "<div><span>Cartons par palette</span><b>" + nb(a.cartonsPalette, 0) + "</b></div></div>" +
    '<h3>Stock</h3><div class="grille">' +
    "<div><span>Cartons</span><b>" + nb(a.stockCartons, 0) + "</b></div>" +
    "<div><span>m²</span><b>" + nb(a.stockM2) + "</b></div>" +
    "<div><span>Palettes</span><b>" + nb(a.palettes, 0) + "</b></div>" +
    "<div><span>Lots</span><b>" + lots.length + "</b></div></div>" +
    (lots.length ? "<table style='margin-top:8px'>" + lots.map(function (l) {
      return "<tr><td>Lot " + esc(l) + "</td><td>" + nb(a.lots[l], 0) + " cartons · " + nb(a.lots[l] * a.m2Carton) + " m²</td></tr>";
    }).join("") + "</table>" : "") +
    (pals.length ? "<h3>Palettes</h3><table>" + pals.map(function (p) {
      return "<tr><td>" + esc(p.id) + " · lot " + esc(p.lot) + "<br><span class='info'>" + esc(p.zone) + "</span></td><td>" + nb(p.cartons, 0) + " cartons</td></tr>";
    }).join("") + "</table>" : "") +
    (a.alerte === "Fin de palette" ? '<div class="alerte">Fin de palette : à repositionner (zone des restes ou mise en avant).</div>' : "") +
    "</div>" +
    '<div class="carte"><h3 style="margin-top:0">Calcul pour un client</h3>' +
    '<label for="iM2">Surface souhaitée (m²)</label><input id="iM2" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ex. 30">' +
    '<div id="resCalc"></div></div>';
  $("fiche").innerHTML = h;
  $("iM2").oninput = function () { afficherCalcul(a, parseFloat(String(this.value).replace(",", "."))); };
}

function afficherCalcul(a, m2) {
  var r = calculer(a, m2), z = $("resCalc");
  if (!r.ok) { z.innerHTML = ""; return; }
  var h = '<div class="res">' + nb(r.cartons, 0) + " cartons = <b>" + nb(r.m2) + " m²</b> livrés<br>" +
    "Prix : " + gnf(r.prix) + "/m² <span class='info'>(" + esc(r.source) + ")</span><br>" +
    '<span class="total">' + gnf(r.total) + "</span></div>";
  if (a.stockCartons <= 0) h += '<div class="alerte rouge">Pas de stock pour cet article.</div>';
  else if (r.lot) h += '<div class="alerte vert">Lot proposé : <b>' + esc(r.lot.lot) + "</b> (" + nb(r.lot.cartons, 0) + " cartons). " +
    (r.lot.reste === 0 ? "Le lot est vendu en entier." : "Reste du lot après vente : " + nb(r.lot.reste) + " m².") + "</div>";
  else if (r.lotEntier) h += '<div class="alerte rouge">Vente refusée : le reste du lot ' + esc(r.lotEntier.lot) + " serait de " + nb(r.lotEntier.reste) +
    " m² (moins de " + nb(r.reliquatMini, 0) + " m²).<br>Le client doit prendre le lot entier : <b>" + nb(r.lotEntier.cartons, 0) + " cartons = " + nb(r.lotEntier.m2) + " m²</b>." +
    '<br><button class="btn2" id="bLotEntier" style="margin-top:8px">Calculer le lot entier</button></div>';
  else h += '<div class="alerte rouge">Aucun lot unique ne couvre ' + nb(r.m2) + " m² (stock total : " + nb(a.stockM2) + " m²).</div>";
  z.innerHTML = h;
  var b = $("bLotEntier");
  if (b) b.onclick = function () { $("iM2").value = r.lotEntier.m2; afficherCalcul(a, r.lotEntier.m2); };
}
$("bRetourFiche").onclick = function () { etat.article = null; afficherCatalogue(); };

// ── Sélecteurs communs ───────────────────────────────────────
/** Liste des zones avec l'occupation : palettes présentes / capacité (4 niveaux). Zones pleines signalées. */
function optionsZones(d, choix) {
  var occ = {};
  d.palettes.forEach(function (p) { if (p.cartons > 0) { var k = p.depot + " › " + p.zone; occ[k] = (occ[k] || 0) + 1; } });
  return d.zones.map(function (z) {
    var n = occ[z.cle] || 0, cap = z.capacite || 0;
    var info = cap ? " · " + n + "/" + cap + (n >= cap ? " PLEINE" : "") : (z.type ? " (" + z.type + ")" : "");
    return '<option value="' + esc(z.cle) + '"' + (z.cle === choix ? " selected" : "") + ">" + esc(z.zone) + esc(info) + "</option>";
  }).join("");
}
function zoneRestes(d) { var z = d.zones.filter(function (z) { return z.type === "Restes"; })[0]; return z ? z.cle : (d.zones[0] || {}).cle; }

// ── Réception ────────────────────────────────────────────────
function afficherReceptions() {
  voir("vReceptions");
  var d = etat.donnees;
  if (!d || !d.receptions.length) {
    $("receptions").innerHTML = '<div class="carte"><h2>Réception</h2><p class="info">Aucun arrivage ouvert.</p>' +
      '<p class="info">La direction ouvre un arrivage dans le classeur (menu CasaFino › Nouvel arrivage), puis ⟳ ici.</p></div>';
    return;
  }
  $("receptions").innerHTML = '<h2 style="margin:0 0 10px">Arrivages ouverts</h2>' + d.receptions.map(function (r) {
    var att = 0, rec = 0; r.lignes.forEach(function (l) { att += l.attendus; rec += l.recus; });
    return '<div class="carte" style="cursor:pointer" data-rec="' + esc(r.numero) + '"><b>' + esc(r.numero) + '</b> <span class="info">du ' + esc(r.date) + "</span><br>" +
      '<span class="info">' + esc(r.commandes) + "</span><br>" + nb(rec, 0) + " / " + nb(att, 0) + " cartons reçus" +
      '<div class="progression"><i style="width:' + Math.min(100, att ? rec / att * 100 : 0) + '%"></i></div></div>';
  }).join("");
}
$("receptions").onclick = function (e) { var c = e.target.closest("[data-rec]"); if (c) afficherReception(c.getAttribute("data-rec")); };

function afficherReception(num) {
  var d = etat.donnees, r = d && d.receptions.filter(function (x) { return x.numero === num; })[0];
  if (!r) return afficherReceptions();
  etat.reception = num; voir("vReception");
  var dern = S.get("derniers", {}) || {};
  var attendus = r.lignes.map(function (l) { return l.code; });
  var opts = '<option value="">— Choisir l\'article —</option><optgroup label="Attendus dans cet arrivage">' +
    r.lignes.map(function (l) { var a = article(d, l.code); return '<option value="' + esc(l.code) + '">' + esc(a ? a.designation : l.code) + " (" + esc(l.code) + ")</option>"; }).join("") +
    '</optgroup><optgroup label="Autres articles (hors commande)">' +
    d.articles.filter(function (a) { return attendus.indexOf(a.code) < 0; }).map(function (a) {
      return '<option value="' + esc(a.code) + '">' + esc(a.designation) + " (" + esc(a.code) + ")</option>";
    }).join("") + "</optgroup>";
  var lignes = r.lignes.map(function (l) {
    var a = article(d, l.code), e = l.recus - l.attendus;
    return "<tr><td>" + esc(a ? a.designation : l.code) + "<br><span class='info'>" + esc(l.code) + "</span></td><td>" + nb(l.recus, 0) + " / " + nb(l.attendus, 0) +
      "<br><span class='" + (e === 0 ? "ok" : e > 0 ? "plus" : "ko") + "' style='font-size:13px'>" + (e === 0 ? "complet" : (e > 0 ? "+" : "") + nb(e, 0)) + "</span></td></tr>";
  }).join("");
  var pals = d.palettes.filter(function (p) { return p.reception === num; }).slice().reverse();
  $("reception").innerHTML =
    '<div class="carte"><h2>' + esc(num) + '</h2><div class="info">' + esc(r.commandes) + "</div>" +
    '<h3>Recevoir une palette</h3>' +
    '<label for="rId">Étiquette de la palette</label><div class="avecBtn"><input id="rId" autocapitalize="characters" placeholder="P00001"><button class="btn2" id="rScan">📷</button></div>' +
    '<label for="rArt">Article</label><select id="rArt">' + opts + "</select>" +
    '<label for="rLot">Lot (teinte / calibre, écrit sur les cartons)</label><input id="rLot" autocapitalize="characters" placeholder="Ex. T021 C5">' +
    '<label for="rCartons">Nombre de cartons sur la palette</label><input id="rCartons" type="number" inputmode="numeric" min="1">' +
    '<label for="rZone">Zone de rangement</label><select id="rZone">' + optionsZones(d, dern.zone) + "</select>" +
    '<div class="err" id="rErr"></div><button class="btn" id="rOk">Enregistrer la palette</button></div>' +
    '<div class="carte"><h3 style="margin-top:0">Avancement (cartons reçus / attendus)</h3><table>' + lignes + "</table></div>" +
    (pals.length ? '<div class="carte"><h3 style="margin-top:0">Palettes reçues (' + pals.length + ")</h3><table>" + pals.map(function (p) {
      var a = article(d, p.code);
      return "<tr><td>" + esc(p.id) + (p.local ? " <span class='badge fin'>à envoyer</span>" : "") + "<br><span class='info'>" + esc(a ? a.designation : p.code) + " · lot " + esc(p.lot) + "</span></td><td>" + nb(p.recus, 0) + " cartons</td></tr>";
    }).join("") + "</table></div>" : "");
  var sel = $("rArt");
  sel.onchange = function () {
    var a = article(d, sel.value); if (!a) return;
    $("rCartons").value = a.cartonsPalette || "";
    $("rLot").value = (dern.lots || {})[a.code] || "";
  };
  if (dern.article && attendus.concat(d.articles.map(function (a) { return a.code; })).indexOf(dern.article) >= 0) { sel.value = dern.article; sel.onchange(); }
  $("rScan").onclick = function () { scanner(function (id) { $("rId").value = id; }); };
  $("rOk").onclick = function () { enregistrerReception(num); };
}

function enregistrerReception(num) {
  var d = etat.donnees, id = idPalette($("rId").value), code = $("rArt").value, lot = $("rLot").value.trim().toUpperCase();
  var cartons = Number($("rCartons").value), zone = $("rZone").value, err = $("rErr");
  err.textContent = "";
  if (!id) return (err.textContent = "Scannez ou tapez le n° d'étiquette (P + 5 chiffres).");
  if (palette(d, id)) return (err.textContent = "L'étiquette " + id + " est déjà utilisée par une autre palette.");
  if (d.etiquettesLibres.length && d.etiquettesLibres.indexOf(id) < 0) return (err.textContent = "Étiquette " + id + " inconnue ou déjà utilisée.");
  if (!code) return (err.textContent = "Choisissez l'article.");
  if (!lot) return (err.textContent = "Le lot (teinte / calibre) est obligatoire.");
  if (!(cartons > 0 && cartons === Math.floor(cartons))) return (err.textContent = "Nombre de cartons invalide.");
  if (!zone) return (err.textContent = "Choisissez la zone.");
  var zz = zoneParCle(d, zone), occ = d.palettes.filter(function (p) { return p.cartons > 0 && p.depot + " › " + p.zone === zone; }).length;
  if (zz && zz.capacite && occ >= zz.capacite && !$("rOk").dataset.pleine) {
    $("rOk").dataset.pleine = "1"; err.textContent = "La zone " + zz.zone + " est pleine (" + occ + "/" + zz.capacite + "). Appuyez encore pour enregistrer quand même.";
    return;
  }
  var a = article(d, code);
  if (a && a.cartonsPalette > 0 && cartons > a.cartonsPalette * 1.5 && !$("rOk").dataset.confirme) {
    $("rOk").dataset.confirme = "1"; $("rOk").textContent = "Confirmer " + cartons + " cartons (palette type : " + a.cartonsPalette + ")";
    return;
  }
  ajouterOperation("reception", { reception: num, palette: id, code: code, lot: lot, cartons: cartons, zone: zone });
  var dern = S.get("derniers", {}) || {}; dern.article = code; dern.zone = zone; dern.lots = dern.lots || {}; dern.lots[code] = lot; S.set("derniers", dern);
  toast("Palette " + id + " enregistrée : " + cartons + " cartons" + (navigator.onLine ? "" : " (envoi au retour du réseau)"));
  afficherReception(num);
}

// ── Palette : déplacement et casse ───────────────────────────
function afficherPaletteVue() {
  voir("vPalette");
  var d = etat.donnees, p = d && etat.palette ? palette(d, etat.palette) : null;
  if (!etat.palette) { $("palette").innerHTML = ""; return; }
  if (!p) { $("palette").innerHTML = '<div class="alerte rouge">Palette ' + esc(etat.palette) + " introuvable (non réceptionnée, ou vide).</div>"; return; }
  var a = article(d, p.code);
  $("palette").innerHTML = '<div class="carte"><h2>' + esc(p.id) + "</h2><div class='info'>" + esc(a ? a.designation : p.code) + " · " + esc(p.code) + "</div>" +
    '<div class="grille" style="margin-top:10px"><div><span>Lot</span><b>' + esc(p.lot) + "</b></div><div><span>Zone</span><b>" + esc(p.zone) + "</b></div>" +
    "<div><span>Cartons restants</span><b>" + nb(p.cartons, 0) + " / " + nb(p.recus, 0) + "</b></div><div><span>m²</span><b>" + nb(a ? p.cartons * a.m2Carton : 0) + "</b></div></div>" +
    '<div class="info" style="margin-top:6px">Arrivage ' + esc(p.reception) + "</div></div>" +
    '<div class="carte"><h3 style="margin-top:0">Déplacer</h3><select id="pZone">' + optionsZones(d, p.depot + " › " + p.zone) + '</select>' +
    '<button class="btn" id="pDeplacer" style="margin-top:10px">Déplacer la palette</button></div>' +
    '<div class="carte"><h3 style="margin-top:0">Casse</h3><label for="pCasse">Cartons cassés</label><input id="pCasse" type="number" inputmode="numeric" min="1" max="' + p.cartons + '">' +
    '<label for="pMotif">Motif</label><select id="pMotif">' + MOTIFS_CASSE.map(function (m) { return "<option>" + esc(m) + "</option>"; }).join("") + "</select>" +
    '<div class="err" id="pErr"></div><button class="btn danger" id="pCasseOk">Déclarer la casse</button>' +
    '<p class="info">La casse est une perte au prix de revient ; les cartons cassés ne sont pas revendus.</p></div>';
  $("pDeplacer").onclick = function () {
    var z = $("pZone").value;
    if (z === p.depot + " › " + p.zone) return toast("La palette est déjà dans cette zone.");
    ajouterOperation("transfert", { palette: p.id, zone: z }); toast(p.id + " déplacée vers " + z); afficherPaletteVue();
  };
  $("pCasseOk").onclick = function () {
    var n = Number($("pCasse").value), b = this;
    if (!(n > 0 && n === Math.floor(n))) return ($("pErr").textContent = "Nombre de cartons invalide.");
    if (n > p.cartons) return ($("pErr").textContent = "Il ne reste que " + p.cartons + " cartons sur la palette.");
    if (!b.dataset.confirme) { b.dataset.confirme = "1"; b.textContent = "Confirmer la casse de " + n + " carton(s) ?"; return; }
    ajouterOperation("casse", { palette: p.id, cartons: n, motif: $("pMotif").value });
    toast(n + " carton(s) en casse sur " + p.id); afficherPaletteVue();
  };
}
function ouvrirPalette(id) { id = idPalette(id); if (!id) return toast("N° d'étiquette invalide (P + 5 chiffres).", true); etat.palette = id; $("iPalette").value = id; afficherPaletteVue(); }
$("bOuvrirPalette").onclick = function () { ouvrirPalette($("iPalette").value); };
$("bScanPalette").onclick = function () { scanner(ouvrirPalette); };

// ── Inventaire ───────────────────────────────────────────────
function afficherInventaire() {
  voir("vInventaire");
  var d = etat.donnees, inv = S.get("inventaire", null);
  if (!inv) {
    $("inventaire").innerHTML = '<div class="carte"><h2>Inventaire</h2><p class="info">Scannez chaque palette et saisissez les cartons comptés. Les écarts corrigent le stock. À la fin, les palettes non scannées sont signalées dans la feuille Inventaires.</p>' +
      '<button class="btn" id="iDemarrer">Démarrer un inventaire</button></div>';
    $("iDemarrer").onclick = function () {
      var n = new Date(), p = function (x) { return ("0" + x).slice(-2); };
      S.set("inventaire", { numero: "INV-" + n.getFullYear() + p(n.getMonth() + 1) + p(n.getDate()) + "-" + p(n.getHours()) + p(n.getMinutes()) + "-" + (session().agent || ""), scannes: {} });
      afficherInventaire();
    };
    return;
  }
  var enStock = d ? d.palettes.filter(function (p) { return p.cartons > 0 || inv.scannes[p.id] != null; }) : [];
  var restants = enStock.filter(function (p) { return inv.scannes[p.id] == null; });
  var cible = etat.invPalette ? palette(d, etat.invPalette) : null;
  var h = '<div class="carte"><h2>Inventaire en cours</h2><div class="info">' + esc(inv.numero) + "</div>" +
    "<p>" + nb(Object.keys(inv.scannes).length, 0) + " palette(s) comptée(s) · " + nb(restants.length, 0) + " restante(s)</p>" +
    '<div class="progression"><i style="width:' + (enStock.length ? (enStock.length - restants.length) / enStock.length * 100 : 0) + '%"></i></div>' +
    '<div class="avecBtn" style="margin-top:12px"><input id="invId" autocapitalize="characters" placeholder="P00001"><button class="btn2" id="invOk">OK</button></div>' +
    '<button class="btn" id="invScan" style="margin-top:8px">📷 Scanner la palette suivante</button></div>';
  if (etat.invPalette) {
    if (!cible) h += '<div class="alerte rouge">Palette ' + esc(etat.invPalette) + " inconnue : notez-la et signalez-la à la direction.</div>";
    else {
      var a = article(d, cible.code);
      h += '<div class="carte"><h3 style="margin-top:0">' + esc(cible.id) + " · " + esc(a ? a.designation : cible.code) + "</h3>" +
        '<div class="info">Lot ' + esc(cible.lot) + " · " + esc(cible.zone) + (inv.scannes[cible.id] != null ? " · déjà comptée (" + inv.scannes[cible.id] + ")" : "") + "</div>" +
        '<label for="invCompte">Cartons comptés</label><input id="invCompte" type="number" inputmode="numeric" min="0">' +
        '<button class="btn" id="invEnr" style="margin-top:10px">Enregistrer le comptage</button></div>';
    }
  }
  h += '<div class="carte"><h3 style="margin-top:0">Palettes pas encore comptées</h3>' +
    (restants.length ? "<table>" + restants.map(function (p) {
      var a = article(d, p.code); return "<tr><td>" + esc(p.id) + "<br><span class='info'>" + esc(a ? a.designation : p.code) + " · " + esc(p.zone) + "</span></td><td>" + nb(p.cartons, 0) + " cartons</td></tr>";
    }).join("") + "</table>" : "<p class='info'>Toutes les palettes en stock ont été comptées.</p>") +
    '<button class="btn2" id="invFin" style="width:100%;margin-top:12px">Terminer l\'inventaire</button></div>';
  $("inventaire").innerHTML = h;
  var choisir = function (id) { id = idPalette(id); if (!id) return toast("N° d'étiquette invalide.", true); etat.invPalette = id; afficherInventaire(); var c = $("invCompte"); if (c) c.focus(); };
  $("invOk").onclick = function () { choisir($("invId").value); };
  $("invScan").onclick = function () { scanner(choisir); };
  if ($("invEnr")) $("invEnr").onclick = function () {
    var n = Number($("invCompte").value);
    if ($("invCompte").value === "" || !(n >= 0 && n === Math.floor(n))) return toast("Saisissez le nombre de cartons comptés.", true);
    var ecart = n - cible.cartons;
    ajouterOperation("inventaire", { inventaire: inv.numero, palette: cible.id, cartons: n });
    inv.scannes[cible.id] = n; S.set("inventaire", inv); etat.invPalette = null;
    toast(cible.id + " : " + (ecart === 0 ? "conforme" : "écart " + (ecart > 0 ? "+" : "") + ecart + " carton(s)"));
    afficherInventaire();
  };
  $("invFin").onclick = function () {
    if (!this.dataset.confirme) { this.dataset.confirme = "1"; this.textContent = restants.length ? "Terminer malgré " + restants.length + " palette(s) non comptée(s) ?" : "Confirmer la fin de l'inventaire"; return; }
    ajouterOperation("clotureInventaire", { inventaire: inv.numero });
    S.del("inventaire"); etat.invPalette = null; toast("Inventaire terminé."); afficherInventaire();
  };
}

// ── À repositionner ──────────────────────────────────────────
function afficherRepos() {
  voir("vRepos");
  var d = etat.donnees, liste = aRepositionner(d);
  if (!liste.length) { $("repos").innerHTML = '<div class="carte"><h2>À repositionner</h2><p class="info">Aucun article en fin de palette à repositionner.</p></div>'; return; }
  var zr = zoneRestes(d);
  $("repos").innerHTML = '<h2 style="margin:0 0 4px">À repositionner</h2><p class="info" style="margin:0 0 10px">Stock d\'une palette ou moins : regroupez en zone des restes ou mettez en avant.</p>' +
    liste.map(function (a) {
      var pals = d.palettes.filter(function (p) { return p.code === a.code && p.cartons > 0; });
      return '<div class="carte"><b>' + esc(a.designation) + '</b> <span class="info">' + esc(a.code) + "</span><br>" +
        nb(a.stockCartons, 0) + " cartons · " + nb(a.stockM2) + " m² (palette type : " + nb(a.cartonsPalette, 0) + " cartons)" +
        '<div class="info">' + pals.map(function (p) { return esc(p.id) + " (" + esc(p.zone) + ", " + p.cartons + ")"; }).join(" · ") + "</div>" +
        '<select data-zone="' + esc(a.code) + '" style="margin-top:8px">' + optionsZones(d, zr) + "</select>" +
        '<button class="btn" data-repos="' + esc(a.code) + '" style="margin-top:8px">Repositionné</button></div>';
    }).join("");
}
$("repos").onclick = function (e) {
  var b = e.target.closest("[data-repos]"); if (!b) return;
  var code = b.getAttribute("data-repos"), z = document.querySelector('[data-zone="' + code + '"]').value;
  ajouterOperation("repositionner", { code: code, zone: z }); toast(code + " repositionné vers " + z); afficherRepos();
};

// ── Carnets d'étiquettes (direction) : PDF pour l'imprimerie ─
function afficherEtiquettes() {
  voir("vEtiquettes");
  var d = etat.donnees, cs = (d && d.carnets) || [];
  $("planches").innerHTML = cs.length ? '<div class="carte"><h3 style="margin-top:0">Carnets créés</h3><table>' + cs.map(function (c, i) {
    return "<tr><td><b>" + esc(c.nom) + "</b> · " + esc(c.ids[0]) + " à " + esc(c.ids[c.ids.length - 1]) + "<br><span class='info'>Créé le " + esc(c.date) +
      (c.par ? " par " + esc(c.par) : "") + " · " + c.utilisees + " / " + c.ids.length + " utilisées</span></td>" +
      '<td><button class="btn2" data-carnet="' + i + '">PDF</button></td></tr>';
  }).join("") + "</table></div>" : "";
}
$("planches").onclick = function (e) {
  var b = e.target.closest("[data-carnet]"); if (!b) return;
  var c = etat.donnees.carnets[Number(b.getAttribute("data-carnet"))];
  b.disabled = true; pdfCarnet(c).catch(function (x) { toast(x.message, true); }).then(function () { b.disabled = false; });
};
$("bEtiq").onclick = function () {
  var n = Math.floor(Number($("iNbEtiq").value)), b = this;
  $("eEtiq").textContent = "";
  if (!(n >= 1 && n <= 5)) return ($("eEtiq").textContent = "Entre 1 et 5 carnets à la fois.");
  if (!navigator.onLine) return ($("eEtiq").textContent = "La création de carnets demande du réseau (réservation des numéros).");
  if (!b.dataset.confirme) { b.dataset.confirme = "1"; b.textContent = "Confirmer : réserver " + (n * 150) + " numéros (" + n + " carnet" + (n > 1 ? "s" : "") + ")"; return; }
  b.disabled = true; delete b.dataset.confirme; b.textContent = "Création…";
  api("carnets", { nombre: n }).then(function (j) {
    var suite = Promise.resolve();
    j.carnets.forEach(function (c) { suite = suite.then(function () { return pdfCarnet(c); }); });
    return suite.then(function () { toast(j.carnets.length + " carnet(s) créé(s) : PDF téléchargé(s)."); actualiser(); });
  }).catch(function (x) { $("eEtiq").textContent = x.message; })
    .then(function () { b.disabled = false; b.textContent = "Créer et télécharger le PDF"; });
};

/** PDF d'un carnet (format validé par la direction) :
    page 1 = garde (recto) + souche, page 2 = suite de la souche (verso de la garde),
    pages 3 et suivantes = 25 feuilles A4 de 6 étiquettes, marge d'agrafage de 15 mm à gauche,
    ordre : colonne de droite de haut en bas (1-2-3), puis colonne de gauche (4-5-6). QR vectoriel. */
function pdfCarnet(c) {
  return Promise.all([chargerScript("pdf-lib.min.js"), chargerScript("qr.js")]).then(function () {
    var P = PDFLib, MM = 72 / 25.4, W = 210 * MM, H = 297 * MM, AGR = 15 * MM, LW = (210 - 15) / 2 * MM, LH = 99 * MM;
    var BLEU = P.rgb(11 / 255, 34 / 255, 135 / 255), OR = P.rgb(184 / 255, 134 / 255, 11 / 255), NOIR = P.rgb(0, 0, 0),
      GRIS = P.rgb(0.7, 0.7, 0.7), GRIS2 = P.rgb(0.4, 0.4, 0.4), FOND = P.rgb(0.93, 0.94, 0.98);
    var doc, f, fb, logo;
    return P.PDFDocument.create().then(function (d) {
      doc = d; doc.setTitle("CasaFino - " + c.nom); doc.setAuthor("CasaFino"); doc.setCreator("CasaFino app " + APP_VERSION);
      return Promise.all([doc.embedFont(P.StandardFonts.Helvetica), doc.embedFont(P.StandardFonts.HelveticaBold),
        fetch("logo.png").then(function (r) { return r.arrayBuffer(); }).then(function (o) { return doc.embedPng(o); }).catch(function () { return null; })]);
    }).then(function (r) {
      f = r[0]; fb = r[1]; logo = r[2];
      var texte = function (pg, txt, x, y, taille, police, couleur) { pg.drawText(txt, { x: x, y: y, size: taille, font: police, color: couleur || NOIR }); };
      var centre = function (pg, txt, cx, y, taille, police, couleur) { texte(pg, txt, cx - police.widthOfTextAtSize(txt, taille) / 2, y, taille, police, couleur); };
      var trait = function (pg, x1, y1, x2, y2, ep, coul) { pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: ep || 0.5, color: coul || GRIS }); };

      // ── Souche : tableau en 2 blocs (QR code | Désignation article | Date + visa) ──
      var LIGNE = 6 * MM, ENTETE = 7 * MM, COLS = [21, 45, 25], ESP = 5 * MM;
      var tableau = function (pg, xg, xd, yHaut, yBas, ids, titre) {
        texte(pg, titre, xg, yHaut - 4.5 * MM, 11, fb, BLEU);
        yHaut -= 7 * MM;
        var lignes = Math.floor((yHaut - ENTETE - yBas) / LIGNE), largeurBloc = (xd - xg - ESP) / 2, k = 0;
        for (var b = 0; b < 2; b++) {
          var x0 = xg + b * (largeurBloc + ESP), ech = largeurBloc / (91 * MM), xs = [x0];
          COLS.forEach(function (w) { xs.push(xs[xs.length - 1] + w * MM * ech); });
          pg.drawRectangle({ x: x0, y: yHaut - ENTETE, width: largeurBloc, height: ENTETE, color: FOND });
          ["QR code", "Désignation article", "Date + visa"].forEach(function (t, i) { centre(pg, t, (xs[i] + xs[i + 1]) / 2, yHaut - ENTETE + 2.3 * MM, 8, fb, BLEU); });
          var yFin = yHaut - ENTETE - lignes * LIGNE;
          for (var l = 0; l < lignes; l++) {
            var y = yHaut - ENTETE - (l + 1) * LIGNE;
            trait(pg, x0, y, x0 + largeurBloc, y, 0.4);
            if (k < ids.length) { texte(pg, ids[k], xs[0] + 1.8 * MM, y + 1.8 * MM, 9, fb); k++; }
          }
          trait(pg, x0, yHaut, x0 + largeurBloc, yHaut, 0.8, NOIR);
          trait(pg, x0, yHaut - ENTETE, x0 + largeurBloc, yHaut - ENTETE, 0.8, NOIR);
          xs.forEach(function (x, i) { trait(pg, x, yHaut, x, yFin, i === 0 || i === xs.length - 1 ? 0.8 : 0.4, i === 0 || i === xs.length - 1 ? NOIR : GRIS); });
        }
        return k;   // nombre de numéros placés
      };

      // Page 1 : garde (recto)
      var g = doc.addPage([W, H]), xg = AGR, xd = W - 8 * MM, y = H - 10 * MM;
      if (logo) { var lw = 48 * MM, lh = lw * logo.height / logo.width; g.drawImage(logo, { x: xg, y: y - lh, width: lw, height: lh }); }
      var tx = xg + 54 * MM;
      texte(g, "Carnet d'étiquettes palettes", tx, y - 7 * MM, 15, fb, BLEU);
      texte(g, c.nom, tx, y - 18 * MM, 26, fb, OR);
      texte(g, c.ids[0] + "  à  " + c.ids[c.ids.length - 1] + "   ·   " + c.ids.length + " étiquettes", tx, y - 27 * MM, 13, fb);
      texte(g, "Créé le " + c.date + (c.par ? " par " + c.par : "") + " · À conserver par la direction.", tx, y - 34 * MM, 9, f, GRIS2);
      texte(g, "Une étiquette = une seule palette, jamais réutilisée. Scanner l'étiquette dans l'app CasaFino (Réception).", xg, y - 42 * MM, 8.5, f, GRIS2);
      texte(g, "Impression : page 1-2 recto verso sur papier ; pages 3 à " + (2 + Math.ceil(c.ids.length / 6)) + " recto seul sur adhésif A4, à 100 %.", xg, y - 46.5 * MM, 8.5, f, GRIS2);
      trait(g, xg, y - 49.5 * MM, xd, y - 49.5 * MM, 1.2, OR);
      var faits = tableau(g, xg, xd, y - 51 * MM, 10 * MM, c.ids, "Souche — à remplir par le responsable du magasin (1/2)");
      // Page 2 : verso de la garde (marge d'agrafage à droite)
      var v = doc.addPage([W, H]);
      var reste = c.ids.slice(faits);
      var faits2 = tableau(v, 8 * MM, W - AGR, H - 10 * MM, 10 * MM, reste, "Souche — " + c.nom + " (2/2)");
      if (faits2 < reste.length) throw new Error("Souche trop longue pour la page de garde.");

      // Pages d'étiquettes
      for (var i = 0; i < c.ids.length; i += 6) {
        var pg = doc.addPage([W, H]);
        trait(pg, AGR, 0, AGR, H, 0.6, GRIS);
        pg.drawText("Agrafage", { x: 9 * MM, y: H / 2 - 12 * MM, size: 9, font: f, color: GRIS2, rotate: P.degrees(90) });
        trait(pg, AGR + LW, 0, AGR + LW, H, 0.4);
        [1, 2].forEach(function (k) { trait(pg, AGR, H - k * LH, W, H - k * LH, 0.4); });
        c.ids.slice(i, i + 6).forEach(function (id, j) {
          var col = j < 3 ? 1 : 0, lig = j % 3;                       // 1-2-3 à droite, 4-5-6 à gauche
          var x0 = AGR + col * LW, y0 = H - (lig + 1) * LH, cx = x0 + LW / 2;
          centre(pg, "CasaFino", cx, y0 + LH - 11 * MM, 13, fb, BLEU);
          trait(pg, cx - 18 * MM, y0 + LH - 13.5 * MM, cx + 18 * MM, y0 + LH - 13.5 * MM, 1.2, OR);
          var m = CF_QR.matrice(id), n = m.length, cote = 58 * MM, mod = cote / n, qx = cx - cote / 2, qy = y0 + 23 * MM;
          for (var yy = 0; yy < n; yy++) {
            for (var xx = 0; xx < n; xx++) {
              if (!m[yy][xx]) continue;
              var deb = xx; while (xx + 1 < n && m[yy][xx + 1]) xx++;
              pg.drawRectangle({ x: qx + deb * mod, y: qy + (n - 1 - yy) * mod, width: (xx - deb + 1) * mod + 0.15, height: mod + 0.15, color: NOIR });
            }
          }
          centre(pg, id, cx, y0 + 10 * MM, 30, fb, NOIR);
          centre(pg, c.nom + " · palette", cx, y0 + 4.5 * MM, 8, f, GRIS2);
        });
      }
      return doc.save();
    }).then(function (octets) {
      var nom = "CasaFino_Carnet_" + ("00" + c.carnet).slice(-3) + "_" + c.ids[0] + "-" + c.ids[c.ids.length - 1] + ".pdf";
      var url = URL.createObjectURL(new Blob([octets], { type: "application/pdf" }));
      var a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return nom;
    });
  });
}

// ── Synchronisation (opérations en attente / refusées) ───────
var LIBELLES = { reception: "Réception", transfert: "Déplacement", casse: "Casse", inventaire: "Comptage", clotureInventaire: "Fin d'inventaire", repositionner: "Repositionnement" };
function resumeOp(o) {
  var x = o.data || {};
  return (LIBELLES[o.type] || o.type) + " · " + [x.palette, x.code, x.cartons != null ? x.cartons + " cartons" : "", x.zone, x.reception, x.inventaire].filter(Boolean).join(" · ");
}
function afficherSync() {
  voir("vSync");
  var f = file(), er = erreurs();
  $("sync").innerHTML = '<div class="carte"><h2>Synchronisation</h2><p>' + (navigator.onLine ? "En ligne" : "Hors ligne : les opérations partiront au retour du réseau.") + "</p>" +
    "<p>" + f.length + " opération(s) en attente d'envoi.</p>" + (f.length ? "<table>" + f.map(function (o) {
      return "<tr><td>" + esc(resumeOp(o)) + "<br><span class='info'>" + esc(new Date(o.date).toLocaleString("fr-FR")) + "</span></td><td></td></tr>";
    }).join("") + "</table>" : "") +
    '<button class="btn" id="sEnvoyer" style="margin-top:12px">Envoyer maintenant</button></div>' +
    (er.length ? '<div class="carte"><h3 style="margin-top:0">Refusées par le serveur (' + er.length + ")</h3><p class='info'>Corrigez puis refaites l'opération ; supprimez la ligne une fois traitée.</p><table>" + er.map(function (x, i) {
      return "<tr><td>" + esc(resumeOp(x.op)) + "<br><span class='ko' style='font-size:13px'>" + esc(x.erreur) + "</span></td><td><button class='btn2' data-suppr='" + i + "'>✕</button></td></tr>";
    }).join("") + "</table></div>" : "");
  $("sEnvoyer").onclick = function () { if (!navigator.onLine) return toast("Pas de réseau.", true); synchroniser().then(afficherSync); };
}
$("sync").onclick = function (e) {
  var b = e.target.closest("[data-suppr]"); if (!b) return;
  var er = erreurs(); er.splice(Number(b.getAttribute("data-suppr")), 1); S.set("erreurs", er); majEtat(); afficherSync();
};
$("etatReseau").onclick = function () { if (S.get("token", "")) afficherSync(); };

// ── Scanner QR (caméra) ──────────────────────────────────────
var scanEtat = { flux: null, actif: false, rappel: null, detecteur: null };
function scanner(rappel) {
  scanEtat.rappel = rappel; scanEtat.actif = true;
  $("scan").classList.remove("cache"); $("iScanManuel").value = ""; $("scanInfo").textContent = "Visez l'étiquette QR de la palette.";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("scanInfo").textContent = "Caméra indisponible : tapez le numéro."; return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (flux) {
    if (!scanEtat.actif) { flux.getTracks().forEach(function (t) { t.stop(); }); return; }
    scanEtat.flux = flux; var v = $("video"); v.srcObject = flux; var lec = v.play(); if (lec && lec.catch) lec.catch(function () {});
    if ("BarcodeDetector" in window) {
      try { scanEtat.detecteur = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { scanEtat.detecteur = null; }
    }
    if (scanEtat.detecteur) return boucleScan();
    chargerScript(LIB_QR_LECTURE).then(boucleScan).catch(function () { $("scanInfo").textContent = "Lecture QR indisponible hors ligne sur ce téléphone : tapez le numéro."; });
  }).catch(function () { $("scanInfo").textContent = "Accès à la caméra refusé : autorisez-le, ou tapez le numéro."; });
}
function boucleScan() {
  if (!scanEtat.actif) return;
  var v = $("video");
  var suite = function () { setTimeout(function () { requestAnimationFrame(boucleScan); }, 150); };
  if (v.readyState < 2) return suite();
  if (scanEtat.detecteur) {
    scanEtat.detecteur.detect(v).then(function (codes) {
      var id = codes.map(function (c) { return idPalette(c.rawValue); }).filter(Boolean)[0];
      if (id) finScan(id); else suite();
    }).catch(suite);
    return;
  }
  if (typeof jsQR === "function") {
    var c = boucleScan.canvas || (boucleScan.canvas = document.createElement("canvas"));
    var w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    c.width = w; c.height = h; var ctx = c.getContext("2d"); ctx.drawImage(v, 0, 0, w, h);
    var r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
    var id = r && idPalette(r.data);
    if (id) return finScan(id);
  }
  suite();
}
function arreterScan() {
  scanEtat.actif = false;
  if (scanEtat.flux) scanEtat.flux.getTracks().forEach(function (t) { t.stop(); });
  scanEtat.flux = null; $("video").srcObject = null; $("scan").classList.add("cache");
}
function finScan(id) {
  var r = scanEtat.rappel; arreterScan();
  if (navigator.vibrate) navigator.vibrate(80);
  if (r) r(id);
}
$("bScanFermer").onclick = arreterScan;
$("bScanOk").onclick = function () { var id = idPalette($("iScanManuel").value); if (!id) return ($("scanInfo").textContent = "Format : P + 5 chiffres (ex. P00012)."); finScan(id); };

// ── Menu ─────────────────────────────────────────────────────
$("bMenu").onclick = function () {
  var s = session(), d = etat.serveur;
  $("menuInfo").innerHTML = "Agent : <b>" + esc(s.agent) + "</b> (" + esc(s.role) + ")<br>Appareil : " + esc(s.appareil || "") +
    " · clé " + esc(S.get("cle", "")) + "<br>Données du : " + (d ? esc(dateMaj(d.maj)) : "—") + "<br>App " + APP_VERSION + (d ? " · API " + esc(d.version) : "");
  voir("vMenu");
};
$("bMenuActu").onclick = function () { synchroniser().then(afficherAccueil); };
$("bActu").onclick = function () { synchroniser(); };
$("bDeco").onclick = function () {
  if (file().length && !this.dataset.confirme) { this.dataset.confirme = "1"; this.textContent = file().length + " opération(s) en attente : se déconnecter quand même ?"; return; }
  deconnecter("");
};

// ── Réseau, installation, service worker ─────────────────────
window.addEventListener("online", function () { majEtat(); synchroniser(); });
window.addEventListener("offline", majEtat);
setInterval(function () { if (navigator.onLine && file().length) synchroniser(); }, 60000);

var invite = null;
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invite = e; $("barreInstall").classList.remove("cache"); });
$("bInstall").onclick = function () {
  if (!invite) return; invite.prompt();
  invite.userChoice.then(function () { invite = null; $("barreInstall").classList.add("cache"); });
};
window.addEventListener("appinstalled", function () { $("barreInstall").classList.add("cache"); });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}

$("iAgent").value = S.get("dernierAgent", "");
demarrer();
