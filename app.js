/* CasaFino — app installable — version 1.1 (2026-10-22) — logo CasaFino
   Étape 1 : activation du téléphone, connexion PIN, catalogue hors ligne, calcul de vente (cartons entiers, reliquat par lot). */
"use strict";
var APP_VERSION = "1.1";
var API = "https://script.google.com/macros/s/AKfycbw2afPgs_lQHn9eN4gUd5zxdiLT_CpLNkNrRbOabBetxUs8Fsx__WRzXmfzkkHKtC9A/exec";

// ── Stockage local (protégé) ─────────────────────────────────
var S = {
  get: function (k, def) { try { var v = localStorage.getItem("cf_" + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set: function (k, v) { try { localStorage.setItem("cf_" + k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem("cf_" + k); } catch (e) {} }
};

var etat = { donnees: S.get("donnees", null), categorie: "Toutes", recherche: "", article: null };
var $ = function (id) { return document.getElementById(id); };

// ── Formatage ────────────────────────────────────────────────
function gnf(n) { return Math.round(n || 0).toLocaleString("fr-FR").replace(/ | /g, " ") + " GNF"; }
function nb(n, d) { return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d }).replace(/ | /g, " "); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

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
var VUES = ["vCle", "vLogin", "vCatalogue", "vFiche", "vMenu"];
function voir(id) {
  VUES.forEach(function (v) { $(v).classList.toggle("cache", v !== id); });
  var connecte = id === "vCatalogue" || id === "vFiche" || id === "vMenu";
  $("bActu").classList.toggle("cache", !connecte);
  $("bMenu").classList.toggle("cache", !connecte);
  window.scrollTo(0, 0);
}

function majReseau() {
  var en = navigator.onLine;
  $("etatReseau").textContent = en ? "En ligne" : "Hors ligne";
  $("etatReseau").classList.toggle("hors", !en);
}

function majEntete() {
  var s = S.get("session", null);
  $("hAgent").textContent = s ? s.agent + " · " + s.role : "";
  $("pied").textContent = "CasaFino app " + APP_VERSION + (etat.donnees ? " · API " + etat.donnees.version : "");
}

// ── Démarrage ────────────────────────────────────────────────
function demarrer() {
  majReseau(); majEntete();
  if (!S.get("cle", "")) return voir("vCle");
  if (!S.get("token", "")) return voir("vLogin");
  afficherCatalogue();
  if (navigator.onLine) actualiser(false);
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
    S.set("token", j.token); S.set("session", { agent: j.agent, role: j.role, appareil: j.appareil });
    S.set("dernierAgent", j.agent); $("iPin").value = "";
    majEntete();
    return actualiser(true);
  }).catch(function (e) {
    $("eLogin").textContent = e.message;
  }).then(function () { b.disabled = false; b.textContent = "Se connecter"; });
};
$("iPin").addEventListener("keydown", function (e) { if (e.key === "Enter") $("bLogin").click(); });

function deconnecter(message) {
  var t = S.get("token", "");
  if (t && navigator.onLine) api("logout").catch(function () {});
  S.del("token"); S.del("session"); majEntete();
  $("iAgent").value = S.get("dernierAgent", "");
  $("eLogin").textContent = message || "";
  voir("vLogin");
}

// ── Données ──────────────────────────────────────────────────
var enCours = false;
function actualiser(afficher) {
  if (enCours) return Promise.resolve();
  if (!navigator.onLine) { $("infoMaj").textContent = "Hors ligne : données du " + (etat.donnees ? dateMaj(etat.donnees.maj) : "—"); return Promise.resolve(); }
  enCours = true; $("bActu").style.opacity = ".5";
  return api("data").then(function (j) {
    etat.donnees = j; S.set("donnees", j);
    S.set("session", { agent: j.agent, role: j.role, appareil: (S.get("session", {}) || {}).appareil });
    majEntete();
    if (afficher || !$("vCatalogue").classList.contains("cache")) afficherCatalogue();
    else if (!$("vFiche").classList.contains("cache") && etat.article) afficherFiche(etat.article);
  }).catch(function (e) {
    if (e.reconnexion) return deconnecter(e.message);
    $("infoMaj").textContent = "Actualisation impossible : " + e.message;
    if (afficher) afficherCatalogue();
  }).then(function () { enCours = false; $("bActu").style.opacity = "1"; });
}

// ── Prix et calcul ───────────────────────────────────────────
/** Prix applicable au m² pour une quantité livrée (m²) : le plus bas entre détail, palier (si atteint) et promo. */
function prixApplicable(a, m2) {
  var p = a.prixDetail, src = "Détail";
  if (a.palierMini > 0 && a.palierPrix > 0 && m2 >= a.palierMini && a.palierPrix < p) { p = a.palierPrix; src = "Demi-gros (≥ " + nb(a.palierMini, 0) + " m²)"; }
  if (a.promoPrix > 0 && a.promoPrix < p) { p = a.promoPrix; src = "Promotion jusqu'au " + a.promoAu.split("-").reverse().join("/"); }
  return { prix: p, source: src };
}

/** Calcule cartons, m² livrés, prix, et le lot unique à proposer (règle du reliquat par lot). */
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
  valides.sort(function (x, y) { return x.reste - y.reste; });      // vide d'abord les lots les plus petits
  entiers.sort(function (x, y) { return x.cartons - y.cartons; });
  r.lot = valides[0] || null; r.lotEntier = entiers[0] || null; r.reliquatMini = mini;
  r.stockSuffisant = a.stockCartons >= cartons;
  return r;
}

function dateMaj(m) {
  var p = String(m || "").split(" ");
  return p.length === 2 ? p[0].split("-").reverse().join("/") + " à " + p[1] : String(m || "—");
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
  var q = etat.recherche.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  var arts = d.articles.filter(function (a) {
    if (etat.categorie !== "Toutes" && a.categorie !== etat.categorie) return false;
    if (!q) return true;
    return (a.designation + " " + a.code + " " + a.format).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(q) >= 0;
  });
  $("liste").innerHTML = arts.length ? arts.map(function (a) {
    var pa = prixApplicable(a, 0), badge = "";
    if (a.promoPrix > 0) badge = '<span class="badge promo">Promo</span> ';
    if (a.alerte === "Fin de palette") badge += '<span class="badge fin">Fin de palette</span>';
    else if (a.stockCartons > 0) badge += '<span class="badge ok">' + nb(a.stockM2, 0) + " m²</span>";
    else badge += '<span class="badge">Pas de stock</span>';
    return '<div class="carte art" data-code="' + esc(a.code) + '"><div class="g"><b>' + esc(a.designation) + "</b>" +
      '<span class="info">' + esc(a.format) + " · " + esc(a.code) + "</span><br>" + badge + "</div>" +
      '<div class="d"><span class="prix">' + gnf(pa.prix).replace(" GNF", "") + '</span><br><span class="info">GNF/m²</span></div></div>';
  }).join("") : '<div class="vide">Aucun article.</div>';
  $("infoMaj").textContent = "Données du " + dateMaj(d.maj) + " · " + d.articles.length + " articles";
}

$("chips").onclick = function (e) { var b = e.target.closest(".chip"); if (!b) return; etat.categorie = b.getAttribute("data-cat"); afficherCatalogue(); };
$("iRech").oninput = function () { etat.recherche = this.value; afficherCatalogue(); };
$("liste").onclick = function (e) { var c = e.target.closest(".art"); if (c) afficherFiche(c.getAttribute("data-code")); };

// ── Fiche article ────────────────────────────────────────────
function afficherFiche(code) {
  var a = (etat.donnees ? etat.donnees.articles : []).filter(function (x) { return x.code === code; })[0];
  if (!a) return afficherCatalogue();
  etat.article = code; voir("vFiche");
  var lots = Object.keys(a.lots || {});
  var h = '<div class="carte"><h2>' + esc(a.designation) + '</h2><div class="info">' + esc(a.code) + " · " + esc(a.categorie) + "</div>" +
    '<h3>Prix</h3><table><tr><td>Détail</td><td><b>' + gnf(a.prixDetail) + "/m²</b></td></tr>" +
    (a.palierMini > 0 ? "<tr><td>À partir de " + nb(a.palierMini, 0) + " m²</td><td>" + gnf(a.palierPrix) + "/m²</td></tr>" : "") +
    (a.promoPrix > 0 ? "<tr><td>Promotion (jusqu'au " + a.promoAu.split("-").reverse().join("/") + ")</td><td>" + gnf(a.promoPrix) + "/m²</td></tr>" : "") +
    (a.prixAchatEur != null ? '<tr><td>Prix d\'achat (direction)</td><td>' + nb(a.prixAchatEur) + " EUR/m²</td></tr>" : "") +
    '</table><h3>Conditionnement</h3><div class="grille">' +
    "<div><span>Format</span><b>" + esc(a.format) + " cm</b></div>" +
    "<div><span>m² par carton</span><b>" + nb(a.m2Carton, 3) + "</b></div>" +
    "<div><span>Pièces par carton</span><b>" + nb(a.piecesCarton, 0) + "</b></div>" +
    "<div><span>Cartons par palette</span><b>" + nb(a.cartonsPalette, 0) + "</b></div></div>" +
    '<h3>Stock</h3><div class="grille">' +
    "<div><span>Cartons</span><b>" + nb(a.stockCartons, 0) + "</b></div>" +
    "<div><span>m²</span><b>" + nb(a.stockM2) + "</b></div>" +
    "<div><span>Palettes</span><b>" + nb(a.palettes, 0) + "</b></div>" +
    "<div><span>Lots</span><b>" + (lots.length ? lots.length : 0) + "</b></div></div>" +
    (lots.length ? "<table style='margin-top:8px'>" + lots.map(function (l) {
      return "<tr><td>Lot " + esc(l) + "</td><td>" + nb(a.lots[l], 0) + " cartons · " + nb(a.lots[l] * a.m2Carton) + " m²</td></tr>";
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

$("bRetour").onclick = function () { etat.article = null; afficherCatalogue(); };

// ── Menu ─────────────────────────────────────────────────────
$("bMenu").onclick = function () {
  var s = S.get("session", {}) || {}, d = etat.donnees;
  $("menuInfo").innerHTML = "Agent : <b>" + esc(s.agent) + "</b> (" + esc(s.role) + ")<br>Appareil : " + esc(s.appareil || "") +
    " · clé " + esc(S.get("cle", "")) + "<br>Données du : " + (d ? esc(d.maj) : "—") + "<br>App " + APP_VERSION + (d ? " · API " + esc(d.version) : "");
  voir("vMenu");
};
$("bRetourMenu").onclick = function () { etat.article ? afficherFiche(etat.article) : afficherCatalogue(); };
$("bMenuActu").onclick = function () { actualiser(true); };
$("bActu").onclick = function () { actualiser(false); };
$("bDeco").onclick = function () { deconnecter(""); };

// ── Réseau, installation, service worker ─────────────────────
window.addEventListener("online", function () { majReseau(); if (S.get("token", "")) actualiser(false); });
window.addEventListener("offline", majReseau);

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

// Pour les tests
if (typeof module !== "undefined") module.exports = { calculer: calculer, prixApplicable: prixApplicable };
