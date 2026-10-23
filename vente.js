/* CasaFino — module Ventes — version 3.0 (2026-10-23)
   Devis, encaissements (espèces, Orange Money, chèque), reçu de caisse, bon de sortie, facture (validée par la direction),
   caisse et clôture du soir, validations de la direction. Fonctionne hors ligne : les opérations partent dans la file. */
"use strict";
var ROLES_VENTE = ["Vendeur", "Direction"];
var ROLES_SORTIE = ["Magasinier", "Vendeur", "Direction"];
var MODES = ["Espèces", "Orange Money", "Chèque"];
var TYPES_CLIENT = ["Particulier", "Revendeur", "Entreprise"];
var ve = { brouillon: null, numero: null, filtre: "" };

function V() { return (etat.donnees && etat.donnees.vente) || null; }
function estVendeur() { return ROLES_VENTE.indexOf(session().role) >= 0; }
function estDirection() { return session().role === "Direction"; }
function peutSortir() { return ROLES_SORTIE.indexOf(session().role) >= 0; }
function fmtDate(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleDateString("fr-FR"); }
function fmtHeure(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); }
function vente(numero) { var v = V(); return v ? v.ventes.filter(function (x) { return x.numero === numero; })[0] || null : null; }
function clientParCode(code) { var v = V(); return v ? v.clients.filter(function (c) { return c.code === code; })[0] || null : null; }
function rond(x) { return Math.round(x * 100) / 100; }

// ── Numérotation par téléphone (D, R, BS, C) ─────────────────
function prochainNumero(type) {
  var v = V(); if (!v || !v.lettre) throw new Error("Téléphone sans lettre : actualisez avec du réseau.");
  var an = new Date().getFullYear(), cle = "cpt_" + an + "_" + v.lettre, c = S.get(cle, {}) || {};
  var n = Math.max(c[type] || 0, (String(v.annee) === String(an) && v.compteurs[type]) || 0) + 1;
  c[type] = n; S.set(cle, c);
  var num = ("000" + n).slice(-4);
  return type === "C" ? "C-" + v.lettre + "-" + num : type + "-" + an + "-" + v.lettre + "-" + num;
}

// ── Application locale des opérations en attente ─────────────
function appliquerVente(d, op) {
  var v = d.vente; if (!v) return;
  var x = op.data, vt;
  var vente = function (n) { return v.ventes.filter(function (y) { return y.numero === n; })[0] || null; };
  var palette = function (dd, id) { return (d.palettes || []).filter(function (p) { return p.id === id; })[0] || null; };
  switch (op.type) {
    case "client":
      var cl = v.clients.filter(function (c) { return c.code === x.code; })[0];
      if (cl) Object.assign(cl, x); else v.clients.push(Object.assign({ local: true }, x));
      break;
    case "vente":
      var brut = 0, tm2 = 0;
      var lignes = x.lignes.map(function (l) { var m = rond(l.cartons * l.m2c); tm2 += m; var mt = Math.round(m * l.prix); brut += mt; return Object.assign({}, l, { m2: m, montant: mt }); });
      var dir = op.role === "Direction", rem = (x.remise && x.remise.montant) || 0;
      vt = vente(x.numero) || null;
      var o = { numero: x.numero, date: vt ? vt.date : op.date, statut: rem && !dir ? "Remise à valider" : "Devis", client: x.client,
        totalM2: rond(tm2), brut: brut, remise: dir ? rem : 0, remiseDemandee: rem, remiseStatut: rem ? (dir ? "Validée" : "Demandée") : "",
        remiseMotif: (x.remise && x.remise.motif) || "", montant: brut - (dir ? rem : 0), paye: 0, recu: "", bs: "", facture: "", numFacture: "",
        vendeur: op.agent, controle: "", lignes: lignes, encaissements: [], local: true };
      if (vt) Object.assign(vt, o); else v.ventes.unshift(o);
      break;
    case "annulerDevis": vt = vente(x.numero); if (vt) vt.statut = "Annulée"; break;
    case "encaissement":
      vt = vente(x.numero); if (!vt) break;
      vt.encaissements.push({ date: op.date, mode: x.mode, montant: x.montant, reference: x.reference || "", statut: x.mode === "Chèque" ? "À valider" : "Encaissé", recu: x.recu || "", local: true });
      majPaiementLocal(vt, x.recu);
      if (x.mode === "Espèces") { v.caisse.solde += x.montant; v.caisse.mouvements.push({ date: op.date, libelle: "Vente " + vt.numero + " · " + vt.client.nom, entree: x.montant, sortie: 0, reference: x.recu || vt.numero, agent: op.agent, local: true }); }
      break;
    case "validerRemise":
      vt = vente(x.numero); if (!vt) break;
      vt.remise = x.accord ? (x.montant || vt.remiseDemandee) : 0; vt.montant = vt.brut - vt.remise; vt.remiseStatut = x.accord ? "Validée" : "Refusée"; vt.statut = "Devis";
      break;
    case "validerCheque":
      vt = vente(x.numero); if (!vt) break;
      vt.encaissements.forEach(function (e) { if (e.mode === "Chèque" && e.statut === "À valider") e.statut = x.refus ? "Refusé" : "Encaissé"; });
      if (vt.statut === "Chèque à valider") vt.statut = "Devis"; majPaiementLocal(vt);
      break;
    case "sortie": vt = vente(x.numero); if (vt) { vt.bs = x.bs; vt.dateSortie = op.date; vt.statut = "Sortie"; vt.prelevements = x.prelevements; }
      (x.prelevements || []).forEach(function (p) { var q = palette(d, p.palette); if (q) q.cartons = Math.max(0, q.cartons - p.cartons); });
      break;
    case "factureDemande": vt = vente(x.numero); if (vt && vt.facture !== "Validée") { vt.facture = "Demandée"; vt.factureNom = x.nom; vt.factureAdresse = x.adresse; } break;
    case "validerFacture": vt = vente(x.numero); if (vt) vt.facture = "Validation en cours"; break;
    case "reglerVente": vt = vente(x.numero); if (vt) { vt.statut = vt.bs ? "Sortie" : "Payée"; vt.controle += " | Réglé"; } break;
    case "clotureCaisse":
      v.caisse.mouvements = []; v.caisse.solde = x.compte - x.remis;
      v.caisse.derniereCloture = { date: op.date, agent: op.agent, fond: x.compte - x.remis, ecart: x.compte - x.theorique };
      break;
  }
}

function majPaiementLocal(vt, recu) {
  var paye = 0, cheques = 0;
  vt.encaissements.forEach(function (e) { if (e.statut === "Encaissé") paye += e.montant; if (e.statut === "À valider") cheques += e.montant; });
  vt.paye = paye;
  if (["Sortie", "Annulée", "À régler"].indexOf(vt.statut) >= 0) return;
  if (!vt.recu && recu && paye + cheques >= vt.montant) { vt.recu = recu; vt.datePaiement = new Date().toISOString(); }
  if (paye >= vt.montant) vt.statut = "Payée";
  else if (cheques > 0) vt.statut = "Chèque à valider";
  else if (paye > 0) vt.statut = "Acompte";
}

function resteAPayer(vt) {
  var r = vt.montant; vt.encaissements.forEach(function (e) { if (e.statut === "Encaissé" || e.statut === "À valider") r -= e.montant; });
  return Math.max(0, r);
}

// ── Tuiles d'accueil ─────────────────────────────────────────
function tuilesVente(t) {
  var v = V(); if (!v) return;
  if (estVendeur()) {
    var aEnc = v.ventes.filter(function (x) { return ["Devis", "Acompte", "Remise à valider"].indexOf(x.statut) >= 0; }).length;
    t.splice(1, 0, ["ventes", "🧾", "Ventes", aEnc]);
    t.push(["caisse", "💰", "Caisse", 0]);
  }
  if (peutSortir()) {
    var aSortir = v.ventes.filter(function (x) { return x.statut === "Payée" && !x.bs; }).length;
    t.splice(estVendeur() ? 2 : 1, 0, ["sorties", "🚚", "Sorties", aSortir]);
  }
  if (estDirection()) t.push(["valider", "✅", "À valider", aValider().total]);
}

// ── Liste des ventes ─────────────────────────────────────────
var CLS_STATUT = { "Devis": "", "Acompte": "fin", "Remise à valider": "fin", "Chèque à valider": "fin", "Payée": "ok", "Sortie": "ok", "À régler": "rouge", "Annulée": "" };
function badgeStatut(s) { return '<span class="badge ' + (CLS_STATUT[s] || "") + '">' + esc(s) + "</span>"; }

function afficherVentes() {
  voir("vVentes");
  var v = V(), q = sansAccent(ve.filtre);
  if (!v) { $("ventes").innerHTML = '<div class="vide">Aucune donnée : actualisez avec du réseau.</div>'; return; }
  var liste = v.ventes.filter(function (x) { return !q || sansAccent(x.numero + " " + x.client.nom + " " + (x.client.telephone || "")).indexOf(q) >= 0; });
  var groupe = function (titre, f) {
    var l = liste.filter(f); if (!l.length) return "";
    return "<h3>" + titre + " (" + l.length + ")</h3>" + l.map(function (x) {
      return '<div class="carte art" data-vente="' + esc(x.numero) + '"><div class="g"><b>' + esc(x.client.nom || "Client comptant") + "</b>" +
        '<span class="info">' + esc(x.numero) + " · " + fmtDate(x.date) + " · " + nb(x.totalM2) + " m²</span><br>" + badgeStatut(x.statut) +
        (x.local ? ' <span class="badge fin">à envoyer</span>' : "") + "</div>" +
        '<div class="d"><span class="prix">' + nb(x.montant, 0) + '</span><br><span class="info">GNF</span></div></div>';
    }).join("");
  };
  $("ventes").innerHTML =
    '<div class="avecBtn" style="margin-bottom:10px"><input id="vRech" placeholder="Client, n°, téléphone…" value="' + esc(ve.filtre) + '">' +
    '<button class="btn" id="bNouvelle" style="width:auto">+ Vente</button></div>' +
    groupe("À encaisser", function (x) { return ["Devis", "Acompte", "Remise à valider"].indexOf(x.statut) >= 0; }) +
    groupe("Payées, à sortir", function (x) { return ["Payée", "Chèque à valider"].indexOf(x.statut) >= 0; }) +
    groupe("À régler", function (x) { return x.statut === "À régler"; }) +
    groupe("Terminées", function (x) { return ["Sortie", "Annulée"].indexOf(x.statut) >= 0; }) ||
    '<div class="vide">Aucune vente.</div>';
  if (!liste.length) $("ventes").innerHTML += '<div class="vide">Aucune vente.</div>';
  $("vRech").oninput = function () { ve.filtre = this.value; var pos = this.selectionStart; afficherVentes(); var i = $("vRech"); i.focus(); i.setSelectionRange(pos, pos); };
  $("bNouvelle").onclick = function () { nouvelleVente(); };
}
$("ventes").addEventListener("click", function (e) { var c = e.target.closest("[data-vente]"); if (c) afficherDetail(c.getAttribute("data-vente")); });

// ── Éditeur de vente (devis) ─────────────────────────────────
function nouvelleVente() {
  ve.brouillon = { numero: null, client: { code: "", nom: "", type: "Particulier", telephone: "" }, comptant: true, lignes: [], remise: { montant: 0, motif: "" } };
  afficherEditeur();
}
function modifierVente(numero) {
  var x = vente(numero); if (!x) return;
  ve.brouillon = { numero: numero, client: Object.assign({}, x.client), comptant: !x.client.code,
    lignes: x.lignes.map(function (l) { var a = article(etat.donnees, l.code); return { code: l.code, lot: l.lot, cartons: l.cartons, m2c: a ? a.m2Carton : l.m2 / l.cartons }; }),
    remise: { montant: x.remiseDemandee || 0, motif: x.remiseMotif || "" } };
  afficherEditeur();
}

/** Prix d'une ligne selon la règle : demi-gros pour un revendeur si le TOTAL de la commande atteint le seuil ; promo si plus basse. */
function prixLigne(a, typeClient, totalM2) {
  var v = V(), seuil = (v && v.parametres.seuilPalier) || 1000, p = a.prixDetail, src = "Détail";
  if (typeClient === "Revendeur" && totalM2 >= seuil && a.palierPrix > 0 && a.palierPrix < p) { p = a.palierPrix; src = "Demi-gros"; }
  if (a.promoPrix > 0 && a.promoPrix < p) { p = a.promoPrix; src = "Promotion"; }
  return { prix: p, source: src };
}

/** Cartons disponibles par lot pour un article : stock − réservé (ventes payées non sorties) − déjà pris dans ce brouillon. */
function lotsDisponibles(a, sauf) {
  var v = V(), res = (v && v.reserve) || {}, b = ve.brouillon, out = {};
  Object.keys(a.lots || {}).forEach(function (lot) {
    var n = a.lots[lot] - (res[a.code + "|" + lot] || 0);
    b.lignes.forEach(function (l, i) { if (i !== sauf && l.code === a.code && l.lot === lot) n -= l.cartons; });
    if (n > 0) out[lot] = n;
  });
  return out;
}

function calculBrouillon() {
  var b = ve.brouillon, tm2 = 0, brut = 0, d = etat.donnees;
  b.lignes.forEach(function (l) { l.m2 = rond(l.cartons * l.m2c); tm2 += l.m2; });
  tm2 = rond(tm2);
  b.lignes.forEach(function (l) { var a = article(d, l.code), p = prixLigne(a, b.client.type, tm2); l.prix = p.prix; l.source = p.source; l.montant = Math.round(l.m2 * l.prix); brut += l.montant; });
  b.totalM2 = tm2; b.brut = brut;
  return b;
}

function afficherEditeur() {
  voir("vVente");
  var b = calculBrouillon(), v = V(), d = etat.donnees;
  var clients = v ? v.clients.slice().sort(function (x, y) { return x.nom.localeCompare(y.nom); }) : [];
  var h = '<div class="carte"><h2>' + (b.numero ? "Modifier " + esc(b.numero) : "Nouvelle vente") + "</h2>" +
    '<h3>Client</h3><div class="seg2"><label><input type="radio" name="tc" value="comptant"' + (b.comptant ? " checked" : "") + "> Client comptant</label>" +
    '<label><input type="radio" name="tc" value="fiche"' + (!b.comptant ? " checked" : "") + "> Client enregistré</label></div>";
  if (b.comptant) {
    h += '<label for="eNomLibre">Nom (facultatif)</label><input id="eNomLibre" value="' + esc(b.client.nom === "Client comptant" ? "" : b.client.nom) + '" placeholder="Ex. M. Diallo">' +
      '<p class="info">Client comptant = particulier, prix détail.</p>';
  } else {
    h += '<label for="eClient">Client</label><select id="eClient"><option value="">— Choisir —</option>' + clients.map(function (c) {
      return '<option value="' + esc(c.code) + '"' + (c.code === b.client.code ? " selected" : "") + ">" + esc(c.nom) + " · " + esc(c.type) + (c.telephone ? " · " + esc(c.telephone) : "") + "</option>";
    }).join("") + '</select><button class="btn2" id="eNouveauClient" style="width:100%;margin-top:8px">+ Nouveau client</button>' +
      '<div id="eFormClient" class="cache"><label for="cNom">Nom</label><input id="cNom"><label for="cType">Type</label><select id="cType">' +
      TYPES_CLIENT.map(function (t) { return "<option>" + t + "</option>"; }).join("") + '</select><label for="cTel">Téléphone</label><input id="cTel" inputmode="tel">' +
      '<label for="cAdr">Adresse</label><input id="cAdr"><button class="btn" id="cOk" style="margin-top:10px">Enregistrer le client</button></div>';
  }
  h += "</div>";
  // lignes
  h += '<div class="carte"><h3 style="margin-top:0">Articles</h3>' + (b.lignes.length ? "<table>" + b.lignes.map(function (l, i) {
    var a = article(d, l.code);
    return "<tr><td><b>" + esc(a ? a.designation : l.code) + "</b><br><span class='info'>Lot " + esc(l.lot) + " · " + l.cartons + " cartons = " + nb(l.m2) + " m² · " +
      nb(l.prix, 0) + " GNF/m² (" + esc(l.source) + ")</span></td><td>" + nb(l.montant, 0) + "<br><button class='btn2' data-suppr-ligne='" + i + "' style='padding:4px 10px;margin-top:4px'>✕</button></td></tr>";
  }).join("") + "</table>" : '<p class="info">Aucun article.</p>') +
    '<label for="eArt">Ajouter un article</label><select id="eArt"><option value="">— Choisir —</option>' + d.articles.filter(function (a) { return a.stockCartons > 0; }).map(function (a) {
      return '<option value="' + esc(a.code) + '">' + esc(a.designation) + " · " + esc(a.format) + " · " + nb(a.stockM2, 0) + " m²</option>";
    }).join("") + '</select><div id="eAjout"></div></div>';
  // totaux et remise
  var seuil = (v && v.parametres.seuilPalier) || 1000;
  h += '<div class="carte"><table><tr><td>Total</td><td><b>' + nb(b.totalM2) + " m²</b></td></tr><tr><td>Montant</td><td><b>" + gnf(b.brut) + "</b></td></tr></table>" +
    (b.client.type === "Revendeur" ? '<p class="info">Revendeur : prix demi-gros dès ' + nb(seuil, 0) + " m² au total" + (b.totalM2 >= seuil ? " (appliqué)." : " (encore " + nb(seuil - b.totalM2) + " m²).") + "</p>" : "") +
    '<label for="eRemise">Remise (GNF)' + (estDirection() ? "" : " — à valider par la direction") + '</label><input id="eRemise" type="number" inputmode="numeric" min="0" value="' + (b.remise.montant || "") + '">' +
    '<label for="eMotif">Motif de la remise</label><input id="eMotif" value="' + esc(b.remise.motif) + '">' +
    '<div class="err" id="eErr"></div><button class="btn" id="eEnr" style="margin-top:6px">Enregistrer le devis</button></div>';
  $("venteEd").innerHTML = h;

  document.querySelectorAll('input[name="tc"]').forEach(function (r) {
    r.onchange = function () { b.comptant = this.value === "comptant"; b.client = b.comptant ? { code: "", nom: "", type: "Particulier", telephone: "" } : { code: "", nom: "", type: "Particulier", telephone: "" }; afficherEditeur(); };
  });
  if ($("eNomLibre")) $("eNomLibre").oninput = function () { b.client.nom = this.value; };
  if ($("eClient")) $("eClient").onchange = function () { var c = clientParCode(this.value); b.client = c ? { code: c.code, nom: c.nom, type: c.type, telephone: c.telephone } : { code: "", nom: "", type: "Particulier", telephone: "" }; afficherEditeur(); };
  if ($("eNouveauClient")) $("eNouveauClient").onclick = function () { $("eFormClient").classList.toggle("cache"); };
  if ($("cOk")) $("cOk").onclick = function () {
    var nom = $("cNom").value.trim(); if (!nom) return ($("eErr").textContent = "Nom du client obligatoire.");
    var code = prochainNumero("C"), c = { code: code, nom: nom, type: $("cType").value, telephone: $("cTel").value.trim(), adresse: $("cAdr").value.trim() };
    ajouterOperation("client", c); b.client = { code: c.code, nom: c.nom, type: c.type, telephone: c.telephone }; toast("Client " + nom + " enregistré"); afficherEditeur();
  };
  $("eArt").onchange = function () { afficherAjout(this.value); };
  document.querySelectorAll("[data-suppr-ligne]").forEach(function (x) { x.onclick = function () { b.lignes.splice(Number(this.getAttribute("data-suppr-ligne")), 1); afficherEditeur(); }; });
  $("eRemise").oninput = function () { b.remise.montant = Math.max(0, Math.round(Number(this.value) || 0)); };
  $("eMotif").oninput = function () { b.remise.motif = this.value; };
  $("eEnr").onclick = enregistrerDevis;
}

function afficherAjout(code) {
  var z = $("eAjout"), a = article(etat.donnees, code); if (!a) { z.innerHTML = ""; return; }
  var lots = lotsDisponibles(a);
  z.innerHTML = '<label for="aM2">Surface (m²)</label><input id="aM2" type="number" inputmode="decimal" min="0" step="0.01">' +
    '<label for="aLot">Lot</label><select id="aLot">' + Object.keys(lots).map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + " · " + lots[l] + " cartons · " + nb(lots[l] * a.m2Carton) + " m²</option>"; }).join("") + "</select>" +
    '<div id="aRes"></div><button class="btn2" id="aOk" style="width:100%;margin-top:8px" disabled>Ajouter à la vente</button>';
  var calc = function (forcerLot) {
    var m2 = parseFloat(String($("aM2").value).replace(",", ".")), r = $("aRes"); $("aOk").disabled = true;
    if (!(m2 > 0)) { r.innerHTML = ""; return; }
    var cartons = Math.ceil(m2 / a.m2Carton - 1e-9), mini = a.reliquatMini || 40, best = null, entier = null;
    Object.keys(lots).forEach(function (l) {
      var c = lots[l]; if (c < cartons) return;
      var reste = rond((c - cartons) * a.m2Carton);
      if (reste === 0 || reste >= mini) { if (!best || reste < best.reste) best = { lot: l, reste: reste }; }
      else if (!entier || c < entier.cartons) entier = { lot: l, cartons: c, m2: rond(c * a.m2Carton), reste: reste };
    });
    if (!forcerLot && best) $("aLot").value = best.lot;
    var lot = $("aLot").value, dispo = lots[lot] || 0, reste = rond((dispo - cartons) * a.m2Carton);
    var h = '<div class="res">' + cartons + " cartons = <b>" + nb(rond(cartons * a.m2Carton)) + " m²</b> · lot " + esc(lot) + "</div>";
    if (dispo < cartons) h += '<div class="alerte rouge">Le lot ' + esc(lot) + " n'a que " + dispo + " cartons." + (best ? " Lot conseillé : " + esc(best.lot) + "." : "") + "</div>";
    else if (reste > 0 && reste < mini) h += '<div class="alerte rouge">Refusé : il resterait ' + nb(reste) + " m² dans le lot (moins de " + mini + " m²). Le client doit prendre le lot entier : " + dispo + " cartons = " + nb(rond(dispo * a.m2Carton)) + ' m². <button class="btn2" id="aEntier" style="margin-top:6px">Prendre le lot entier</button></div>';
    else { h += '<div class="alerte vert">' + (reste === 0 ? "Le lot est vendu en entier." : "Reste du lot : " + nb(reste) + " m².") + "</div>"; $("aOk").disabled = false; }
    r.innerHTML = h;
    if ($("aEntier")) $("aEntier").onclick = function () { $("aM2").value = rond(dispo * a.m2Carton); calc(true); };
    $("aOk").onclick = function () {
      ve.brouillon.lignes.push({ code: a.code, lot: lot, cartons: cartons, m2c: a.m2Carton });
      toast(a.designation + " ajouté"); afficherEditeur();
    };
  };
  $("aM2").oninput = function () { calc(false); };
  $("aLot").onchange = function () { calc(true); };
}

function enregistrerDevis() {
  var b = calculBrouillon(), err = $("eErr"), dir = estDirection();
  if (!b.comptant && !b.client.code) return (err.textContent = "Choisissez ou créez le client.");
  if (b.comptant) b.client = { code: "", nom: (b.client.nom || "").trim() || "Client comptant", type: "Particulier", telephone: "" };
  if (!b.lignes.length) return (err.textContent = "Ajoutez au moins un article.");
  if (b.remise.montant >= b.brut) return (err.textContent = "La remise dépasse le montant.");
  if (b.remise.montant > 0 && !b.remise.motif.trim()) return (err.textContent = "Indiquez le motif de la remise.");
  var numero = b.numero || prochainNumero("D");
  ajouterOperation("vente", { numero: numero, client: b.client, remise: b.remise,
    lignes: b.lignes.map(function (l) { return { code: l.code, lot: l.lot, cartons: l.cartons, prix: l.prix, source: l.source, m2c: l.m2c }; }) });
  toast(numero + " enregistré" + (b.remise.montant && !dir ? " · remise envoyée à la direction" : ""));
  ve.brouillon = null; afficherDetail(numero);
}

// ── Détail d'une vente ───────────────────────────────────────
function afficherDetail(numero) {
  var x = vente(numero); if (!x) return afficherVentes();
  ve.numero = numero; voir("vDetail");
  var reste = resteAPayer(x), modifiable = ["Devis", "Remise à valider"].indexOf(x.statut) >= 0 && x.paye === 0 && !x.encaissements.length;
  var h = '<div class="carte"><h2>' + esc(x.client.nom || "Client comptant") + '</h2><div class="info">' + esc(x.numero) + " · " + fmtDate(x.date) + " · " + esc(x.vendeur || "") +
    (x.client.type ? " · " + esc(x.client.type) : "") + "</div><p>" + badgeStatut(x.statut) + (x.local ? ' <span class="badge fin">à envoyer</span>' : "") + "</p>" +
    (x.controle ? '<div class="alerte rouge">' + esc(x.controle) + "</div>" : "") +
    "<table>" + x.lignes.map(function (l) {
      return "<tr><td>" + esc(l.designation || (article(etat.donnees, l.code) || {}).designation || l.code) + "<br><span class='info'>Lot " + esc(l.lot) + " · " + l.cartons + " cartons · " + nb(l.m2) + " m² × " + nb(l.prix, 0) + "</span></td><td>" + nb(l.montant, 0) + "</td></tr>";
    }).join("") +
    "<tr><td>Total " + nb(x.totalM2) + " m²</td><td>" + nb(x.brut, 0) + "</td></tr>" +
    (x.remise ? "<tr><td>Remise</td><td>− " + nb(x.remise, 0) + "</td></tr>" : "") +
    (x.remiseStatut === "Demandée" ? "<tr><td colspan='2' class='info'>Remise demandée : " + nb(x.remiseDemandee, 0) + " GNF (" + esc(x.remiseMotif) + ") — en attente de la direction</td></tr>" : "") +
    (x.remiseStatut === "Refusée" ? "<tr><td colspan='2' class='info'>Remise refusée par la direction</td></tr>" : "") +
    "<tr><td><b>À payer</b></td><td><b>" + gnf(x.montant) + "</b></td></tr></table></div>";
  if (x.encaissements.length) h += '<div class="carte"><h3 style="margin-top:0">Paiements</h3><table>' + x.encaissements.map(function (e) {
    return "<tr><td>" + esc(e.mode) + (e.reference ? " · " + esc(e.reference) : "") + "<br><span class='info'>" + fmtHeure(e.date) + " · " + esc(e.statut) + "</span></td><td>" + nb(e.montant, 0) + "</td></tr>";
  }).join("") + "<tr><td>Reste à payer</td><td><b>" + gnf(reste) + "</b></td></tr></table></div>";
  // documents
  h += '<div class="carte"><h3 style="margin-top:0">Documents</h3><div class="ligneBtn" style="flex-wrap:wrap">' +
    '<button class="btn2" data-pdf="devis">Devis</button>' +
    (x.recu ? '<button class="btn2" data-pdf="recu">Reçu</button>' : "") +
    (x.bs ? '<button class="btn2" data-pdf="bs">Bon de sortie</button>' : "") +
    (x.numFacture ? '<button class="btn2" data-pdf="facture">Facture</button>' : "") + "</div>" +
    (x.facture === "Demandée" ? '<p class="info">Facture demandée : en attente de validation par la direction.</p>' : "") +
    '<p class="info">' + [x.recu ? "Reçu " + esc(x.recu) : "", x.bs ? "Bon de sortie " + esc(x.bs) : "", x.numFacture ? "Facture " + esc(x.numFacture) : ""].filter(Boolean).join(" · ") + "</p></div>";
  // actions
  h += '<div class="carte" id="actions">';
  if (estVendeur() && modifiable) h += '<button class="btn2" id="dModif" style="width:100%">Modifier le devis</button>';
  if (estVendeur() && x.statut !== "Remise à valider" && ["Sortie", "Annulée"].indexOf(x.statut) < 0 && reste > 0) h += '<button class="btn" id="dEnc" style="margin-top:8px">Encaisser · reste ' + gnf(reste) + "</button>";
  if (x.statut === "Remise à valider") h += '<p class="info">Encaissement possible après la décision de la direction sur la remise.</p>';
  if (peutSortir() && x.statut === "Payée" && !x.bs) h += '<button class="btn" id="dSortie" style="margin-top:8px">Préparer la sortie</button>';
  if (x.statut === "Chèque à valider") h += '<p class="info">Sortie possible après validation du chèque par la direction.</p>';
  if (estVendeur() && x.recu && !x.facture) h += '<button class="btn2" id="dFact" style="width:100%;margin-top:8px">Demander une facture</button><div id="dFactForm"></div>';
  if (estVendeur() && modifiable) h += '<button class="btn2" id="dAnnul" style="width:100%;margin-top:8px">Annuler le devis</button>';
  h += "</div>";
  $("venteDet").innerHTML = h;
  document.querySelectorAll("[data-pdf]").forEach(function (b) { b.onclick = function () { b.disabled = true; pdfVente(this.getAttribute("data-pdf"), x).catch(function (e) { toast(e.message, true); }).then(function () { b.disabled = false; }); }; });
  if ($("dModif")) $("dModif").onclick = function () { modifierVente(numero); };
  if ($("dEnc")) $("dEnc").onclick = function () { afficherEncaisser(numero); };
  if ($("dSortie")) $("dSortie").onclick = function () { afficherPicking(numero); };
  if ($("dAnnul")) $("dAnnul").onclick = function () {
    if (!this.dataset.c) { this.dataset.c = 1; this.textContent = "Confirmer l'annulation du devis"; return; }
    ajouterOperation("annulerDevis", { numero: numero }); toast("Devis annulé"); afficherDetail(numero);
  };
  if ($("dFact")) $("dFact").onclick = function () {
    $("dFactForm").innerHTML = '<label for="fNom">Nom sur la facture</label><input id="fNom" value="' + esc(x.client.nom) + '"><label for="fAdr">Adresse</label><input id="fAdr" value="' + esc((clientParCode(x.client.code) || {}).adresse || "") + '">' +
      '<button class="btn" id="fOk" style="margin-top:8px">Envoyer la demande</button>';
    $("fOk").onclick = function () { ajouterOperation("factureDemande", { numero: numero, nom: $("fNom").value.trim(), adresse: $("fAdr").value.trim() }); toast("Facture demandée à la direction"); afficherDetail(numero); };
  };
}

// ── Encaissement ─────────────────────────────────────────────
function afficherEncaisser(numero) {
  var x = vente(numero); if (!x) return;
  voir("vEncaisser");
  var reste = resteAPayer(x);
  $("encaisser").innerHTML = '<div class="carte"><h2>Encaisser</h2><div class="info">' + esc(x.numero) + " · " + esc(x.client.nom) + "</div>" +
    "<p>Reste à payer : <b>" + gnf(reste) + "</b></p>" +
    '<label for="pMode">Mode de paiement</label><select id="pMode">' + MODES.map(function (m) { return "<option>" + m + "</option>"; }).join("") + "</select>" +
    '<label for="pMontant">Montant (GNF)</label><input id="pMontant" type="number" inputmode="numeric" min="1" value="' + reste + '">' +
    '<div id="pRefBloc" class="cache"><label for="pRef" id="pRefLbl">Référence</label><input id="pRef"></div>' +
    '<div class="err" id="pErr"></div><button class="btn" id="pOk">Valider le paiement</button>' +
    '<p class="info">Pas de vente à crédit : la marchandise sort quand tout est payé. Chèque : sortie après validation par la direction.</p></div>';
  var maj = function () { var m = $("pMode").value; $("pRefBloc").classList.toggle("cache", m === "Espèces"); $("pRefLbl").textContent = m === "Orange Money" ? "Référence de la transaction Orange Money" : "N° du chèque et banque"; };
  $("pMode").onchange = maj; maj();
  $("pOk").onclick = function () {
    var mode = $("pMode").value, mt = Math.round(Number($("pMontant").value)), ref = $("pRef").value.trim(), err = $("pErr");
    if (!(mt > 0)) return (err.textContent = "Montant invalide.");
    if (mt > reste) return (err.textContent = "Le montant dépasse le reste à payer (" + gnf(reste) + ").");
    if (mode !== "Espèces" && !ref) return (err.textContent = mode === "Orange Money" ? "La référence Orange Money est obligatoire." : "Le n° de chèque est obligatoire.");
    var recu = mt === reste && !x.recu ? prochainNumero("R") : "";
    ajouterOperation("encaissement", { numero: numero, mode: mode, montant: mt, reference: ref, recu: recu });
    toast(mode + " " + gnf(mt) + " enregistré" + (recu ? " · reçu " + recu : ""));
    var y = vente(numero);
    if (recu && y) pdfVente("recu", y).catch(function () {});
    afficherDetail(numero);
  };
}

// ── Sortie (prélèvement sur les palettes) ────────────────────
function afficherSorties() {
  voir("vSorties");
  var v = V(), l = v ? v.ventes.filter(function (x) { return x.statut === "Payée" && !x.bs; }) : [];
  $("sorties").innerHTML = "<h2 style='margin:0 0 10px'>Ventes payées à sortir</h2>" + (l.length ? l.map(function (x) {
    return '<div class="carte art" data-sortie="' + esc(x.numero) + '"><div class="g"><b>' + esc(x.client.nom) + '</b><span class="info">' + esc(x.numero) + " · " +
      x.lignes.map(function (y) { return y.cartons + " × " + esc(y.code) + " (" + esc(y.lot) + ")"; }).join(", ") + "</span></div><div class='d'>" + nb(x.totalM2) + " m²</div></div>";
  }).join("") : '<div class="vide">Aucune vente à sortir.</div>');
}
$("sorties").addEventListener("click", function (e) { var c = e.target.closest("[data-sortie]"); if (c) afficherPicking(c.getAttribute("data-sortie")); });

function afficherPicking(numero) {
  var x = vente(numero), d = etat.donnees; if (!x) return;
  voir("vPicking");
  // propose les palettes du lot, en vidant d'abord les plus petites
  var plan = x.lignes.map(function (l, i) {
    var pals = (d.palettes || []).filter(function (p) { return p.code === l.code && p.lot === l.lot && p.cartons > 0; }).sort(function (a, b) { return a.cartons - b.cartons; });
    var reste = l.cartons;
    return { i: i, ligne: l, pals: pals.map(function (p) { var n = Math.min(p.cartons, reste); reste -= n; return { id: p.id, zone: p.zone, dispo: p.cartons, n: n }; }) };
  });
  $("picking").innerHTML = '<div class="carte"><h2>Bon de sortie</h2><div class="info">' + esc(x.numero) + " · " + esc(x.client.nom) + "</div>" +
    '<p class="info">Quantités proposées en vidant d\'abord les palettes les plus entamées. Corrigez si besoin.</p></div>' +
    plan.map(function (g) {
      return '<div class="carte"><b>' + esc(g.ligne.designation || g.ligne.code) + "</b><div class='info'>Lot " + esc(g.ligne.lot) + " · à sortir : " + g.ligne.cartons + " cartons</div>" +
        (g.pals.length ? "<table>" + g.pals.map(function (p) {
          return "<tr><td>" + esc(p.id) + "<br><span class='info'>" + esc(p.zone) + " · " + p.dispo + " cartons</span></td><td><input type='number' inputmode='numeric' min='0' max='" + p.dispo +
            "' data-pal='" + esc(p.id) + "' data-l='" + g.i + "' value='" + p.n + "' style='width:90px'></td></tr>";
        }).join("") + "</table>" : '<div class="alerte rouge">Aucune palette de ce lot dans le dépôt.</div>') + "</div>";
    }).join("") + '<div class="carte"><div class="err" id="kErr"></div><button class="btn" id="kOk">Valider la sortie</button></div>';
  $("kOk").onclick = function () {
    var pris = {}, prel = [];
    document.querySelectorAll("[data-pal]").forEach(function (inp) {
      var n = Math.floor(Number(inp.value) || 0), max = Number(inp.max);
      if (n > max) n = max;
      if (n > 0) { prel.push({ palette: inp.getAttribute("data-pal"), cartons: n }); pris[inp.getAttribute("data-l")] = (pris[inp.getAttribute("data-l")] || 0) + n; }
    });
    var ecarts = x.lignes.filter(function (l, i) { return (pris[i] || 0) !== l.cartons; });
    if (ecarts.length && !this.dataset.c) { this.dataset.c = 1; $("kErr").textContent = "Les quantités ne correspondent pas à la vente : la sortie passera « à régler ». Appuyez encore pour confirmer."; return; }
    if (!prel.length) return ($("kErr").textContent = "Aucune palette prélevée.");
    var bs = prochainNumero("BS");
    ajouterOperation("sortie", { numero: numero, bs: bs, prelevements: prel });
    toast("Sortie " + bs + " enregistrée");
    var y = vente(numero); if (y) pdfVente("bs", y).catch(function () {});
    afficherDetail(numero);
  };
}

// ── Caisse ───────────────────────────────────────────────────
function afficherCaisse() {
  voir("vCaisse");
  var v = V(); if (!v) return;
  var c = v.caisse, dc = c.derniereCloture;
  $("caisse").innerHTML = '<div class="carte"><h2>Caisse</h2><p>Solde théorique : <b>' + gnf(c.solde) + "</b></p>" +
    '<div class="info">' + (dc ? "Dernière clôture : " + fmtHeure(dc.date) + " par " + esc(dc.agent) + " · fond laissé " + gnf(dc.fond) + (dc.ecart ? " · écart " + gnf(dc.ecart) : "") : "Aucune clôture.") + "</div></div>" +
    '<div class="carte"><h3 style="margin-top:0">Mouvements depuis la dernière clôture</h3>' + (c.mouvements.length ? "<table>" + c.mouvements.map(function (m) {
      return "<tr><td>" + esc(m.libelle) + "<br><span class='info'>" + fmtHeure(m.date) + " · " + esc(m.agent || "") + "</span></td><td>" + (m.entree ? "+ " + nb(m.entree, 0) : "− " + nb(m.sortie, 0)) + "</td></tr>";
    }).join("") + "</table>" : '<p class="info">Aucun mouvement.</p>') + "</div>" +
    '<div class="carte"><h3 style="margin-top:0">Clôture du soir</h3><label for="kCompte">Espèces comptées (GNF)</label><input id="kCompte" type="number" inputmode="numeric" min="0">' +
    '<div id="kEcart" class="info"></div><label for="kRemis">Remis à la direction (GNF)</label><input id="kRemis" type="number" inputmode="numeric" min="0">' +
    '<label for="kNote">Remarque</label><input id="kNote"><div class="err" id="cErr"></div><button class="btn" id="kClot">Clôturer la caisse</button></div>';
  $("kCompte").oninput = function () { var e = Math.round(Number(this.value) || 0) - c.solde; $("kEcart").textContent = this.value === "" ? "" : (e === 0 ? "Aucun écart." : "Écart : " + (e > 0 ? "+" : "") + gnf(e)); };
  $("kClot").onclick = function () {
    var compte = $("kCompte").value === "" ? NaN : Math.round(Number($("kCompte").value)), remis = Math.round(Number($("kRemis").value) || 0), err = $("cErr");
    if (!(compte >= 0)) return (err.textContent = "Saisissez les espèces comptées.");
    if (remis > compte) return (err.textContent = "La remise dépasse l'argent compté.");
    var e = compte - c.solde;
    if (e !== 0 && !$("kNote").value.trim()) return (err.textContent = "Écart de " + gnf(e) + " : expliquez-le dans la remarque.");
    if (!this.dataset.c) { this.dataset.c = 1; this.textContent = "Confirmer la clôture"; return; }
    ajouterOperation("clotureCaisse", { compte: compte, remis: remis, note: $("kNote").value.trim(), theorique: c.solde });
    toast("Caisse clôturée"); afficherCaisse();
  };
}

// ── À valider (direction) ────────────────────────────────────
function aValider() {
  var v = V(), r = { remises: [], cheques: [], factures: [], regler: [], total: 0 }; if (!v) return r;
  v.ventes.forEach(function (x) {
    if (x.statut === "Remise à valider") r.remises.push(x);
    if (x.encaissements.some(function (e) { return e.mode === "Chèque" && e.statut === "À valider"; })) r.cheques.push(x);
    if (x.facture === "Demandée") r.factures.push(x);
    if (x.statut === "À régler") r.regler.push(x);
  });
  r.total = r.remises.length + r.cheques.length + r.factures.length + r.regler.length;
  return r;
}

function afficherValider() {
  voir("vValider");
  var r = aValider(), carte = function (x, corps) {
    return '<div class="carte"><b>' + esc(x.client.nom) + '</b> <span class="info">' + esc(x.numero) + " · " + gnf(x.montant) + " · " + esc(x.vendeur || "") + "</span>" + corps + "</div>";
  };
  var h = "";
  if (!navigator.onLine) h += '<div class="alerte">Hors ligne : vos décisions partiront au retour du réseau. Les factures ne reçoivent leur numéro qu\'en ligne.</div>';
  h += "<h3>Remises (" + r.remises.length + ")</h3>" + r.remises.map(function (x) {
    return carte(x, "<div class='info'>Demandée : " + gnf(x.remiseDemandee) + " sur " + gnf(x.brut) + " · " + esc(x.remiseMotif) + "</div>" +
      "<input type='number' data-rm='" + esc(x.numero) + "' value='" + x.remiseDemandee + "' style='margin-top:6px'><div class='ligneBtn' style='margin-top:6px'>" +
      "<button class='btn' data-ok-remise='" + esc(x.numero) + "'>Accorder</button><button class='btn2' data-ko-remise='" + esc(x.numero) + "'>Refuser</button></div>");
  }).join("");
  h += "<h3>Chèques (" + r.cheques.length + ")</h3>" + r.cheques.map(function (x) {
    var ch = x.encaissements.filter(function (e) { return e.mode === "Chèque" && e.statut === "À valider"; });
    return carte(x, "<div class='info'>" + ch.map(function (e) { return esc(e.reference) + " · " + gnf(e.montant); }).join("<br>") + "</div><div class='ligneBtn' style='margin-top:6px'>" +
      "<button class='btn' data-ok-cheque='" + esc(x.numero) + "'>Chèque encaissé</button><button class='btn2' data-ko-cheque='" + esc(x.numero) + "'>Refusé</button></div>");
  }).join("");
  h += "<h3>Factures (" + r.factures.length + ")</h3>" + r.factures.map(function (x) {
    return carte(x, "<div class='info'>Reçu " + esc(x.recu) + " · facture au nom de " + esc(x.factureNom || x.client.nom) + "</div><button class='btn' data-ok-facture='" + esc(x.numero) + "' style='margin-top:6px'>Valider la facture</button>");
  }).join("");
  h += "<h3>Ventes à régler (" + r.regler.length + ")</h3>" + r.regler.map(function (x) {
    return carte(x, "<div class='alerte rouge'>" + esc(x.controle) + "</div><input data-note='" + esc(x.numero) + "' placeholder='Décision / explication' style='margin-top:6px'>" +
      "<button class='btn' data-ok-regler='" + esc(x.numero) + "' style='margin-top:6px'>Marquer réglée</button>");
  }).join("");
  $("valider").innerHTML = h;
}
$("valider").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  var n;
  if ((n = b.getAttribute("data-ok-remise"))) { ajouterOperation("validerRemise", { numero: n, accord: true, montant: Math.round(Number(document.querySelector('[data-rm="' + n + '"]').value) || 0) }); toast("Remise accordée"); }
  else if ((n = b.getAttribute("data-ko-remise"))) { ajouterOperation("validerRemise", { numero: n, accord: false }); toast("Remise refusée"); }
  else if ((n = b.getAttribute("data-ok-cheque"))) { ajouterOperation("validerCheque", { numero: n }); toast("Chèque validé"); }
  else if ((n = b.getAttribute("data-ko-cheque"))) { ajouterOperation("validerCheque", { numero: n, refus: true }); toast("Chèque refusé"); }
  else if ((n = b.getAttribute("data-ok-facture"))) {
    if (!navigator.onLine) return toast("La validation d'une facture demande du réseau.", true);
    ajouterOperation("validerFacture", { numero: n }); toast("Facture en cours de validation…");
  }
  else if ((n = b.getAttribute("data-ok-regler"))) { ajouterOperation("reglerVente", { numero: n, note: document.querySelector('[data-note="' + n + '"]').value.trim() }); toast("Vente réglée"); }
  else return;
  afficherValider();
});

// ── Documents PDF (A4) ───────────────────────────────────────
var TITRES = { devis: "DEVIS", recu: "REÇU DE CAISSE", bs: "BON DE SORTIE", facture: "FACTURE" };
function pdfVente(type, x) {
  var v = V(), soc = (v && v.parametres.societe) || { raison: "CasaFino" }, mention = (v && v.parametres.mention) || "", validite = (v && v.parametres.validiteDevis) || 7;
  return chargerScript("pdf-lib.min.js").then(function () {
    var P = PDFLib, MM = 72 / 25.4, W = 210 * MM, H = 297 * MM, M = 15 * MM;
    var BLEU = P.rgb(11 / 255, 34 / 255, 135 / 255), OR = P.rgb(184 / 255, 134 / 255, 11 / 255), NOIR = P.rgb(0.1, 0.1, 0.1), GRIS = P.rgb(0.42, 0.42, 0.42), FOND = P.rgb(0.94, 0.95, 0.99);
    var doc, f, fb, logo;
    // Helvetica standard : on remplace les caractères hors WinAnsi
    var t = function (s) { return String(s == null ? "" : s).replace(/[  ]/g, " ").replace(/[’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E -ÿ€]/g, ""); };
    return P.PDFDocument.create().then(function (d) {
      doc = d; doc.setTitle(TITRES[type] + " " + x.numero); doc.setAuthor(soc.raison || "CasaFino");
      return Promise.all([doc.embedFont(P.StandardFonts.Helvetica), doc.embedFont(P.StandardFonts.HelveticaBold),
        fetch("logo.png").then(function (r) { return r.arrayBuffer(); }).then(function (o) { return doc.embedPng(o); }).catch(function () { return null; })]);
    }).then(function (r) {
      f = r[0]; fb = r[1]; logo = r[2];
      var pg = doc.addPage([W, H]), y = H - M;
      var txt = function (s, x0, y0, taille, police, couleur) { pg.drawText(t(s), { x: x0, y: y0, size: taille, font: police || f, color: couleur || NOIR }); };
      var droite = function (s, x1, y0, taille, police, couleur) { var w = (police || f).widthOfTextAtSize(t(s), taille); txt(s, x1 - w, y0, taille, police, couleur); };
      var nbp = function (n) { return t(nb(n, 0)); };
      // En-tête
      if (logo) { var lw = 52 * MM, lh = lw * logo.height / logo.width; pg.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh }); }
      var hy = y - 4 * MM;
      [soc.raison, soc.adresse, soc.telephone, soc.email].filter(Boolean).forEach(function (s, i) { droite(s, W - M, hy - i * 5 * MM, i === 0 ? 11 : 9, i === 0 ? fb : f, i === 0 ? BLEU : GRIS); });
      y -= 34 * MM;
      pg.drawRectangle({ x: M, y: y - 2 * MM, width: W - 2 * M, height: 1.2, color: OR });
      y -= 12 * MM;
      var num = type === "devis" ? x.numero : type === "recu" ? x.recu : type === "bs" ? x.bs : x.numFacture;
      var dateDoc = type === "devis" ? x.date : type === "recu" ? (x.datePaiement || x.date) : type === "bs" ? (x.dateSortie || new Date().toISOString()) : (x.dateFacture || new Date().toISOString());
      txt(TITRES[type], M, y, 20, fb, BLEU);
      droite("N° " + num, W - M, y + 2, 12, fb);
      droite("Date : " + fmtDate(dateDoc), W - M, y - 5 * MM, 10, f, GRIS);
      if (type !== "devis") droite("Vente " + x.numero, W - M, y - 10 * MM, 9, f, GRIS);
      y -= 16 * MM;
      // Client
      pg.drawRectangle({ x: M, y: y - 16 * MM, width: 95 * MM, height: 20 * MM, color: FOND });
      txt(type === "facture" ? "Facturé à" : "Client", M + 3 * MM, y, 8, fb, GRIS);
      var cl = clientParCode(x.client.code) || {};
      txt(type === "facture" ? (x.factureNom || x.client.nom) : (x.client.nom || "Client comptant"), M + 3 * MM, y - 6 * MM, 12, fb);
      var det = [type === "facture" ? (x.factureAdresse || cl.adresse) : cl.adresse, x.client.telephone || cl.telephone].filter(Boolean).join(" · ");
      if (det) txt(det, M + 3 * MM, y - 11 * MM, 9, f, GRIS);
      if (x.client.code) txt("Code " + x.client.code + (x.client.type ? " · " + x.client.type : ""), M + 3 * MM, y - 15 * MM, 8, f, GRIS);
      if (type === "devis") { droite("Valable " + validite + " jours, jusqu'au " + fmtDate(new Date(new Date(x.date).getTime() + validite * 864e5).toISOString()), W - M, y - 6 * MM, 9, f, GRIS); droite("Prix garantis, lot non réservé", W - M, y - 11 * MM, 9, f, GRIS); }
      y -= 26 * MM;
      // Tableau
      var cols = type === "bs" ? [[M, "Article"], [M + 66 * MM, "Lot"], [M + 86 * MM, "Palette(s)"], [W - M - 20 * MM, "Cartons"], [W - M, "m²"]]
        : [[M, "Article"], [M + 72 * MM, "Lot"], [M + 100 * MM, "Cartons"], [M + 122 * MM, "m²"], [W - M - 28 * MM, "Prix /m²"], [W - M, "Montant"]];
      pg.drawRectangle({ x: M, y: y - 2.5 * MM, width: W - 2 * M, height: 8 * MM, color: BLEU });
      cols.forEach(function (c, i) { var col = P.rgb(1, 1, 1); if (i < (type === "bs" ? 3 : 2)) txt(c[1], c[0] + 2 * MM, y, 9, fb, col); else droite(c[1], c[0] - (i === cols.length - 1 ? 2 * MM : 0), y, 9, fb, col); });
      y -= 9 * MM;
      x.lignes.forEach(function (l) {
        var nom = l.designation || (article(etat.donnees, l.code) || {}).designation || l.code;
        txt(nom, M + 2 * MM, y, 9.5, fb); txt(l.code, M + 2 * MM, y - 4 * MM, 7.5, f, GRIS);
        if (type === "bs") {
          var pals = (x.prelevements || []).filter(function (p) { return (p.code || (palette(etat.donnees, p.palette) || {}).code) === l.code; }).map(function (p) { return p.palette + " (" + p.cartons + ")"; }).join(", ");
          txt(l.lot, cols[1][0] + 2 * MM, y, 9.5);
          droite(String(l.cartons), cols[3][0], y, 9.5); droite(t(nb(l.m2)), cols[4][0] - 2 * MM, y, 9.5);
          // palettes : sur plusieurs lignes si besoin, dans la colonne prévue
          var mots = (pals || "-").split(", "), ligneP = "", yp = y, largeur = cols[3][0] - 16 * MM - cols[2][0];
          mots.forEach(function (m, k) {
            var essai = ligneP ? ligneP + ", " + m : m;
            if (f.widthOfTextAtSize(t(essai), 8.5) > largeur && ligneP) { txt(ligneP + ",", cols[2][0] + 2 * MM, yp, 8.5, f, GRIS); yp -= 4 * MM; ligneP = m; }
            else ligneP = essai;
          });
          txt(ligneP, cols[2][0] + 2 * MM, yp, 8.5, f, GRIS);
          y = Math.min(y, yp + 4 * MM) - 0;
        } else {
          txt(l.lot, cols[1][0] + 2 * MM, y, 9.5);
          droite(String(l.cartons), cols[2][0], y, 9.5); droite(t(nb(l.m2)), cols[3][0], y, 9.5);
          droite(nbp(l.prix), cols[4][0], y, 9.5); droite(nbp(l.montant), cols[5][0] - 2 * MM, y, 9.5, fb);
        }
        y -= 9 * MM;
        pg.drawLine({ start: { x: M, y: y + 4 * MM }, end: { x: W - M, y: y + 4 * MM }, thickness: 0.4, color: P.rgb(0.85, 0.86, 0.9) });
        if (y < 60 * MM) { pg = doc.addPage([W, H]); y = H - M - 10 * MM; }
      });
      // Totaux
      y -= 2 * MM;
      var ligneTot = function (lib, val, gras) { txt(lib, W - M - 85 * MM, y, gras ? 11 : 10, gras ? fb : f); droite(val, W - M - 2 * MM, y, gras ? 11 : 10, gras ? fb : f); y -= 6.5 * MM; };
      ligneTot("Total surface", t(nb(x.totalM2)) + " m²");
      if (type !== "bs") {
        if (x.remise) { ligneTot("Montant", nbp(x.brut) + " GNF"); ligneTot("Remise", "- " + nbp(x.remise) + " GNF"); }
        pg.drawRectangle({ x: W - M - 87 * MM, y: y - 2.5 * MM, width: 87 * MM, height: 9 * MM, color: FOND });
        ligneTot(type === "devis" ? "Total à payer" : "Total", nbp(x.montant) + " GNF", true);
        txt("Montant net, sans TVA.", W - M - 85 * MM, y, 8, f, GRIS); y -= 6 * MM;
      }
      // Paiements
      if (type === "recu" || type === "facture") {
        y -= 4 * MM; txt("Paiements", M, y, 10, fb, BLEU); y -= 6 * MM;
        x.encaissements.forEach(function (e) {
          txt(fmtDate(e.date) + " · " + e.mode + (e.reference ? " · " + e.reference : "") + (e.statut === "À valider" ? " (sous réserve d'encaissement)" : ""), M, y, 9); droite(nbp(e.montant) + " GNF", W - M - 2 * MM, y, 9); y -= 5.5 * MM;
        });
        var r = resteAPayer(x), enAttente = x.encaissements.some(function (e) { return e.statut === "À valider"; });
        txt(r > 0 ? "Reste à payer" : (enAttente ? "Payé en totalité, chèque sous réserve d'encaissement" : "Payé en totalité"), M, y, 10, fb); if (r > 0) droite(nbp(r) + " GNF", W - M - 2 * MM, y, 10, fb); y -= 8 * MM;
      }
      if (type === "bs") {
        y -= 6 * MM; txt("Reçu " + (x.recu || "") + " · marchandise payée en totalité, enlevée au dépôt par le client.", M, y, 9, f, GRIS); y -= 16 * MM;
        txt("Le magasinier", M, y, 10, fb); txt("Le client (nom et signature)", W / 2 + 5 * MM, y, 10, fb); y -= 22 * MM;
        pg.drawLine({ start: { x: M, y: y }, end: { x: M + 70 * MM, y: y }, thickness: 0.5, color: GRIS });
        pg.drawLine({ start: { x: W / 2 + 5 * MM, y: y }, end: { x: W - M, y: y }, thickness: 0.5, color: GRIS }); y -= 6 * MM;
      }
      // Mentions
      if ((type === "devis" || type === "bs") && mention) { y -= 4 * MM; txt(mention, M, y, 10, fb, OR); }
      txt(t(soc.raison || "CasaFino") + " · document édité le " + fmtHeure(new Date().toISOString()) + " par " + (session().agent || ""), M, 10 * MM, 7.5, f, GRIS);
      return doc.save();
    }).then(function (octets) {
      var nom = (type === "devis" ? "Devis_" : type === "recu" ? "Recu_" : type === "bs" ? "BonDeSortie_" : "Facture_") +
        String((type === "devis" ? x.numero : type === "recu" ? x.recu : type === "bs" ? x.bs : x.numFacture) || x.numero).replace(/[^A-Za-z0-9-]/g, "") + ".pdf";
      var blob = new Blob([octets], { type: "application/pdf" }), fichier = null;
      try { fichier = new File([blob], nom, { type: "application/pdf" }); } catch (e) {}
      if (fichier && navigator.canShare && navigator.canShare({ files: [fichier] })) {
        return navigator.share({ files: [fichier], title: nom }).catch(function () { telecharger(blob, nom); });
      }
      telecharger(blob, nom);
    });
  });
}
function telecharger(blob, nom) {
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

// ── Branchement sur l'app ────────────────────────────────────
function rafraichirVente(vue) {
  switch (vue) {
    case "vVentes": afficherVentes(); break;
    case "vDetail": if (ve.numero) afficherDetail(ve.numero); break;
    case "vSorties": afficherSorties(); break;
    case "vCaisse": afficherCaisse(); break;
    case "vValider": afficherValider(); break;
  }
}
Object.assign(AFFICHAGES, { ventes: afficherVentes, sorties: afficherSorties, caisse: afficherCaisse, valider: afficherValider });
Object.assign(LIBELLES, { client: "Client", vente: "Devis", annulerDevis: "Annulation", encaissement: "Paiement", sortie: "Sortie", factureDemande: "Demande de facture",
  clotureCaisse: "Clôture de caisse", validerRemise: "Remise", validerCheque: "Chèque", validerFacture: "Facture", reglerVente: "Vente réglée" });
VUES.push("vVentes", "vVente", "vDetail", "vEncaisser", "vSorties", "vPicking", "vCaisse", "vValider");
recomposer(); if (etat.vue === "vAccueil") afficherAccueil();
