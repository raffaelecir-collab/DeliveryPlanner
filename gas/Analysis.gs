/**
 * Metriche per il tab Analysis (solo Admin — richiedeAdmin_ su tutto). Tutti i calcoli sono
 * fatti in memoria a partire da una singola lettura di INTERVENTI/SQUADRE, coerentemente con il
 * resto dell'app (RouteEngine.gs fa lo stesso). I tempi di lavorazione sono espressi in giorni
 * LAVORATIVI secondo il calendario fisso di Calendario.gs (Lun-Ven, festività italiane escluse),
 * NON secondo la regola configurabile "giorniLavorativi" usata dalla pianificazione — per scelta
 * esplicita (vedi discussione in chat): un calendario fisso rende le metriche comparabili nel
 * tempo anche se la regola di pianificazione cambia.
 *
 * Importante limite noto: primoEventoData / dataPrimoPianificato / dataCompletamento vengono
 * scritti da campiAnalisi_ (Interventions.gs) solo a partire da quando è stato introdotto: sugli
 * Interventi già esistenti prima di allora questi campi restano vuoti, quindi i tre "tempi di
 * lavorazione" si popolano solo per gli Interventi dispacciati/lavorati da questo momento in poi.
 */

/** true se dataStr (dd/MM/yyyy) cade nell'intervallo [dal, al] inclusi (entrambi opzionali). */
function nelPeriodo_(dataStr, dal, al) {
  var d = parseDateStr_(dataStr);
  if (!d) return false;
  var i = dal ? parseDateStr_(dal) : null;
  var f = al ? parseDateStr_(al) : null;
  if (i && d < i) return false;
  if (f && d > f) return false;
  return true;
}

function bucketSettimana_(dataStr) {
  var d = parseDateStr_(dataStr);
  if (!d) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "YYYY-'W'ww");
}

function bucketMese_(dataStr) {
  var d = parseDateStr_(dataStr);
  if (!d) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
}

function etichettaSettimana_(chiave) {
  return chiave.replace('-W', ' · sett. ');
}

function etichettaMese_(chiave) {
  var parti = chiave.split('-');
  var d = new Date(parseInt(parti[0], 10), parseInt(parti[1], 10) - 1, 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM yyyy');
}

/**
 * Serie temporale generica: raggruppa `interventi` per bucket (settimana/mese, da bucketFn su
 * `interventi[i][campoData]`), sommando `valoreFn(i)` per bucket e, se `chiaveGruppoFn` è passata,
 * anche per sotto-gruppo (es. squadra o tipo attività) dentro ogni bucket.
 */
function serieTemporale_(interventi, campoData, bucketFn, etichettaFn, valoreFn, chiaveGruppoFn) {
  var mappa = {};
  interventi.forEach(function (i) {
    var bucket = bucketFn(i[campoData]);
    if (!bucket) return;
    if (!mappa[bucket]) mappa[bucket] = { totale: 0, gruppi: {} };
    var valore = valoreFn(i);
    mappa[bucket].totale += valore;
    if (chiaveGruppoFn) {
      var g = chiaveGruppoFn(i) || TIPO_ATTIVITA_ALTRO;
      mappa[bucket].gruppi[g] = (mappa[bucket].gruppi[g] || 0) + valore;
    }
  });
  return Object.keys(mappa).sort().map(function (b) {
    return {
      chiave: b,
      etichetta: etichettaFn(b),
      totale: Math.round(mappa[b].totale * 100) / 100,
      perGruppo: mappa[b].gruppi
    };
  });
}

function arrotonda1_(n) { return Math.round(n * 10) / 10; }
function arrotonda2_(n) { return Math.round(n * 100) / 100; }

/** Giorni lavorativi (calendario fisso) tra dataDispacciamento e campoFine di un intervento, esclusi i periodi di sospensione. */
function giorniLavorazioneIntervento_(intervento, campoFine, fineForzata) {
  var fine = fineForzata || intervento[campoFine];
  if (!intervento.dataDispacciamento || !fine) return null;
  var intervalli = intervalliSospensione_(intervento.storiaSospensioni);
  return giorniLavorativiTra_(intervento.dataDispacciamento, fine, intervalli);
}

/**
 * Valori di una metrica di tempo (prima lavorazione / lavorazione / completamento) su un elenco
 * già filtrato di Interventi: se `includiAperti`, include anche chi non ha ancora raggiunto quel
 * traguardo (usando oggi come stima), altrimenti considera solo chi lo ha già raggiunto.
 */
function valoriTempoMetrica_(interventi, campoFine, includiAperti) {
  var oggiStr = formatDateStr_(dataOggi_());
  var valori = [];
  interventi.forEach(function (i) {
    var fine = i[campoFine];
    if (!fine) {
      if (!includiAperti || i.stato === STATO_INTERVENTO.ANNULLATO) return;
      fine = oggiStr;
    }
    var giorni = giorniLavorazioneIntervento_(i, campoFine, fine);
    if (giorni === null) return;
    valori.push({ giorni: giorni, tipoAttivita: i.tipoAttivita || TIPO_ATTIVITA_ALTRO });
  });
  return valori;
}

function aggregaMedia_(valori) {
  if (!valori.length) return { media: null, n: 0 };
  var somma = valori.reduce(function (s, v) { return s + v.giorni; }, 0);
  return { media: arrotonda1_(somma / valori.length), n: valori.length };
}

function aggregaMediaPerAttivita_(valori) {
  var perTipo = {};
  valori.forEach(function (v) {
    if (!perTipo[v.tipoAttivita]) perTipo[v.tipoAttivita] = [];
    perTipo[v.tipoAttivita].push(v);
  });
  return Object.keys(perTipo).sort().map(function (k) {
    var agg = aggregaMedia_(perTipo[k]);
    return { tipoAttivita: k, media: agg.media, n: agg.n };
  });
}

/**
 * Metrica completa (dati grezzi popolazione + entrambe le viste cumulativo/per-attività) per uno
 * dei tre "tempi di lavorazione": prima lavorazione, lavorazione (fino a Pianificato),
 * completamento. Per scelta esplicita (vedi chat) la popolazione di base è SOLO gli Interventi
 * "Completato" nel periodo, salvo che `includiAperti` sia true: in quel caso si aggiungono anche
 * quelli ancora aperti (non Annullati), stimando "ad oggi" chi non ha ancora raggiunto il
 * traguardo di quella specifica metrica.
 */
function metricaTempo_(popolazioneCompletati, popolazioneAperti, campoFine, includiAperti) {
  var base = includiAperti ? popolazioneCompletati.concat(popolazioneAperti) : popolazioneCompletati;
  var valori = valoriTempoMetrica_(base, campoFine, includiAperti);
  return { cumulativo: aggregaMedia_(valori), perAttivita: aggregaMediaPerAttivita_(valori) };
}

/**
 * Endpoint unico del tab Analysis: calcola tutte le metriche per il periodo/filtri scelti in una
 * sola chiamata (evita più round-trip al server, che su Apps Script possono richiedere secondi).
 * `filtri`: { dal, al: 'dd/MM/yyyy' (obbligatori); squadraId: '' = tutte le squadre;
 * includiAperti: bool: anche gli Interventi ancora aperti nei tempi di lavorazione (stima ad
 * oggi), non solo i Completati; sogliaBacklogGiorni: numero (default 5) usato per l'aging del
 * backlog "Da pianificare". }
 */
function getAnalisiDashboard(filtri) {
  richiedeAdmin_();
  filtri = filtri || {};
  var dal = filtri.dal, al = filtri.al;
  if (!dal || !al) throw new Error('Seleziona un intervallo di date (Dal/Al).');
  var includiAperti = !!filtri.includiAperti;
  var sogliaBacklogGiorni = isNum_(filtri.sogliaBacklogGiorni) ? filtri.sogliaBacklogGiorni : 5;

  var tutti = readAll_('INTERVENTI');
  var squadre = readAll_('SQUADRE');
  var squadreMap = {};
  squadre.forEach(function (s) { squadreMap[s.id] = s; });
  var nomeSquadra_ = function (id) { return squadreMap[id] ? squadreMap[id].nome : '(squadra eliminata)'; };
  var coloreSquadra_ = function (id) { return squadreMap[id] ? (squadreMap[id].colore || '#999') : '#999'; };

  // ---------- popolazione "dispacciati nel periodo" (per data di dispacciamento) ----------
  var dispacciatiNelPeriodo = tutti.filter(function (i) { return i.dataDispacciamento && nelPeriodo_(i.dataDispacciamento, dal, al); });

  // ---------- 1. Ricavo totale per tecnico (solo Completati, per data pianificata) ----------
  var completatiConRicavo = tutti.filter(function (i) {
    return i.stato === STATO_INTERVENTO.COMPLETATO && i.dataPianificata && nelPeriodo_(i.dataPianificata, dal, al) &&
      (!filtri.squadraId || i.squadraId === filtri.squadraId);
  });
  var ricavoTotale = arrotonda2_(completatiConRicavo.reduce(function (s, i) { return s + (parseFloat(i.ricavo) || 0); }, 0));
  var ricavoPerSquadraMappa = {};
  completatiConRicavo.forEach(function (i) {
    ricavoPerSquadraMappa[i.squadraId] = (ricavoPerSquadraMappa[i.squadraId] || 0) + (parseFloat(i.ricavo) || 0);
  });
  var ricavoPerSquadra = Object.keys(ricavoPerSquadraMappa).map(function (sid) {
    return { squadraId: sid, squadraNome: nomeSquadra_(sid), colore: coloreSquadra_(sid), totale: arrotonda2_(ricavoPerSquadraMappa[sid]) };
  }).sort(function (a, b) { return b.totale - a.totale; });
  var ricavo = {
    totale: ricavoTotale,
    perSquadra: ricavoPerSquadra,
    serieSettimanale: serieTemporale_(completatiConRicavo, 'dataPianificata', bucketSettimana_, etichettaSettimana_,
      function (i) { return parseFloat(i.ricavo) || 0; }, function (i) { return i.squadraId; }),
    serieMensile: serieTemporale_(completatiConRicavo, 'dataPianificata', bucketMese_, etichettaMese_,
      function (i) { return parseFloat(i.ricavo) || 0; }, function (i) { return i.squadraId; })
  };

  // ---------- 2-4. Tempi di prima lavorazione / lavorazione / completamento ----------
  var dispCompletati = dispacciatiNelPeriodo.filter(function (i) { return i.stato === STATO_INTERVENTO.COMPLETATO; });
  var dispAperti = dispacciatiNelPeriodo.filter(function (i) { return i.stato !== STATO_INTERVENTO.COMPLETATO; });
  var tempi = {
    primaLavorazione: metricaTempo_(dispCompletati, dispAperti, 'primoEventoData', includiAperti),
    lavorazione: metricaTempo_(dispCompletati, dispAperti, 'dataPrimoPianificato', includiAperti),
    completamento: metricaTempo_(dispCompletati, dispAperti, 'dataCompletamento', includiAperti)
  };

  // ---------- 5. Nuovi interventi dispacciati mensilmente ----------
  var nuoviInterventi = {
    totale: dispacciatiNelPeriodo.length,
    serieMensile: serieTemporale_(dispacciatiNelPeriodo, 'dataDispacciamento', bucketMese_, etichettaMese_,
      function () { return 1; }, function (i) { return i.tipoAttivita || TIPO_ATTIVITA_ALTRO; })
  };

  // ---------- 6. Tassi di completamento/annullamento/sospensione ----------
  var totaleDispacciati = dispacciatiNelPeriodo.length;
  var nCompletati = dispCompletati.length;
  var nAnnullati = dispacciatiNelPeriodo.filter(function (i) { return i.stato === STATO_INTERVENTO.ANNULLATO; }).length;
  var nSospesi = dispacciatiNelPeriodo.filter(function (i) { return isStatoSospeso_(i.stato); }).length;
  var percentuale_ = function (n) { return totaleDispacciati ? arrotonda1_(100 * n / totaleDispacciati) : null; };
  var tassiPerAttivitaMappa = {};
  dispacciatiNelPeriodo.forEach(function (i) {
    var k = i.tipoAttivita || TIPO_ATTIVITA_ALTRO;
    if (!tassiPerAttivitaMappa[k]) tassiPerAttivitaMappa[k] = { totale: 0, completati: 0, annullati: 0, sospesi: 0 };
    tassiPerAttivitaMappa[k].totale++;
    if (i.stato === STATO_INTERVENTO.COMPLETATO) tassiPerAttivitaMappa[k].completati++;
    if (i.stato === STATO_INTERVENTO.ANNULLATO) tassiPerAttivitaMappa[k].annullati++;
    if (isStatoSospeso_(i.stato)) tassiPerAttivitaMappa[k].sospesi++;
  });
  var tassi = {
    totaleDispacciati: totaleDispacciati,
    completati: nCompletati, annullati: nAnnullati, sospesi: nSospesi,
    percCompletati: percentuale_(nCompletati), percAnnullati: percentuale_(nAnnullati), percSospesi: percentuale_(nSospesi),
    perAttivita: Object.keys(tassiPerAttivitaMappa).sort().map(function (k) {
      var v = tassiPerAttivitaMappa[k];
      return {
        tipoAttivita: k, totale: v.totale, completati: v.completati, annullati: v.annullati, sospesi: v.sospesi,
        percCompletati: v.totale ? arrotonda1_(100 * v.completati / v.totale) : null,
        percAnnullati: v.totale ? arrotonda1_(100 * v.annullati / v.totale) : null,
        percSospesi: v.totale ? arrotonda1_(100 * v.sospesi / v.totale) : null
      };
    })
  };

  // ---------- 7. Tempo medio di sospensione + numero medio di sospensioni ----------
  var tuttiGliIntervalli = [];
  var interventiConSospensione = 0;
  dispacciatiNelPeriodo.forEach(function (i) {
    var intervalli = intervalliSospensione_(i.storiaSospensioni);
    if (intervalli.length) interventiConSospensione++;
    intervalli.forEach(function (iv) {
      tuttiGliIntervalli.push(giorniLavorativiTra_(iv.dal, iv.al, []));
    });
  });
  var sospensioni = {
    numeroSospensioni: tuttiGliIntervalli.length,
    interventiConAlmenoUnaSospensione: interventiConSospensione,
    tempoMedioGiorni: tuttiGliIntervalli.length ? arrotonda1_(tuttiGliIntervalli.reduce(function (s, g) { return s + g; }, 0) / tuttiGliIntervalli.length) : null,
    numeroMedioPerIntervento: interventiConSospensione ? arrotonda1_(tuttiGliIntervalli.length / interventiConSospensione) : null
  };

  // ---------- 8. Aging del backlog "Da pianificare" (snapshot attuale, non filtrato dal periodo) ----------
  var oggiStr = formatDateStr_(dataOggi_());
  var backlogElenco = tutti.filter(function (i) { return i.stato === STATO_INTERVENTO.DA_PIANIFICARE && i.dataDispacciamento; })
    .map(function (i) {
      var intervalli = intervalliSospensione_(i.storiaSospensioni);
      return { id: i.id, cliente: i.cliente, dataDispacciamento: i.dataDispacciamento, giorniTrascorsi: giorniLavorativiTra_(i.dataDispacciamento, oggiStr, intervalli) };
    })
    .filter(function (r) { return r.giorniTrascorsi >= sogliaBacklogGiorni; })
    .sort(function (a, b) { return b.giorniTrascorsi - a.giorniTrascorsi; });
  var backlogAging = { sogliaGiorni: sogliaBacklogGiorni, numero: backlogElenco.length, elenco: backlogElenco.slice(0, 50) };

  // ---------- 9. SLA scadenza (solo Completati con scadenza impostata, nel periodo) ----------
  var completatiConScadenza = dispCompletati.filter(function (i) { return i.scadenza; });
  var oltreScadenza = completatiConScadenza.filter(function (i) {
    var s = parseDateStr_(i.scadenza), c = parseDateStr_(i.dataCompletamento);
    return s && c && c > s;
  }).length;
  var slaScadenza = {
    totaleConScadenza: completatiConScadenza.length,
    oltreScadenza: oltreScadenza,
    percentuale: completatiConScadenza.length ? arrotonda1_(100 * oltreScadenza / completatiConScadenza.length) : null
  };

  // ---------- 10. Ricavo medio per tipo di attività (Completati, per data pianificata) ----------
  var ricavoPerAttivitaMappa = {};
  completatiConRicavo.forEach(function (i) {
    var k = i.tipoAttivita || TIPO_ATTIVITA_ALTRO;
    if (!ricavoPerAttivitaMappa[k]) ricavoPerAttivitaMappa[k] = [];
    ricavoPerAttivitaMappa[k].push(parseFloat(i.ricavo) || 0);
  });
  var ricavoMedioPerAttivita = Object.keys(ricavoPerAttivitaMappa).sort().map(function (k) {
    var lista = ricavoPerAttivitaMappa[k];
    return { tipoAttivita: k, media: arrotonda2_(lista.reduce(function (s, v) { return s + v; }, 0) / lista.length), n: lista.length };
  });

  // ---------- 11. Km stimati per tecnico nel periodo (Pianificato+Completato, per data pianificata) ----------
  var interventiConPercorso = tutti.filter(function (i) {
    return (i.stato === STATO_INTERVENTO.PIANIFICATO || i.stato === STATO_INTERVENTO.COMPLETATO) &&
      i.dataPianificata && nelPeriodo_(i.dataPianificata, dal, al) && isNum_(i.lat) && isNum_(i.lng) &&
      (!filtri.squadraId || i.squadraId === filtri.squadraId);
  });
  var perSquadraGiorno = {};
  interventiConPercorso.forEach(function (i) {
    var chiave = i.squadraId + '|' + i.dataPianificata;
    if (!perSquadraGiorno[chiave]) perSquadraGiorno[chiave] = [];
    perSquadraGiorno[chiave].push(i);
  });
  var kmPerSquadraMappa = {};
  Object.keys(perSquadraGiorno).forEach(function (chiave) {
    var squadraId = chiave.split('|')[0];
    var squadra = squadreMap[squadraId];
    if (!squadra || !isNum_(squadra.latPartenza) || !isNum_(squadra.lngPartenza)) return;
    var tappe = perSquadraGiorno[chiave].slice().sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); });
    var partenza = [squadra.latPartenza, squadra.lngPartenza];
    var rientro = isNum_(squadra.latRientro) ? [squadra.latRientro, squadra.lngRientro] : partenza;
    var punti = [partenza].concat(tappe.map(function (t) { return [t.lat, t.lng]; })).concat([rientro]);
    var km = 0;
    for (var p = 1; p < punti.length; p++) km += haversineKm_(punti[p - 1][0], punti[p - 1][1], punti[p][0], punti[p][1]);
    kmPerSquadraMappa[squadraId] = (kmPerSquadraMappa[squadraId] || 0) + km;
  });
  var kmPerTecnico = Object.keys(kmPerSquadraMappa).map(function (sid) {
    return { squadraId: sid, squadraNome: nomeSquadra_(sid), colore: coloreSquadra_(sid), km: Math.round(kmPerSquadraMappa[sid]) };
  }).sort(function (a, b) { return b.km - a.km; });

  // ---------- 12. Distribuzione per Comune (dispacciati nel periodo) ----------
  var comuneMappa = {};
  dispacciatiNelPeriodo.forEach(function (i) {
    if (!i.comune) return;
    comuneMappa[i.comune] = (comuneMappa[i.comune] || 0) + 1;
  });
  var distribuzioneComune = Object.keys(comuneMappa).map(function (c) {
    return { comune: c, numero: comuneMappa[c] };
  }).sort(function (a, b) { return b.numero - a.numero; });

  return {
    periodo: { dal: dal, al: al },
    squadre: squadre.map(function (s) { return { id: s.id, nome: s.nome, colore: s.colore }; }),
    ricavo: ricavo,
    tempi: tempi,
    nuoviInterventi: nuoviInterventi,
    tassi: tassi,
    sospensioni: sospensioni,
    backlogAging: backlogAging,
    slaScadenza: slaScadenza,
    ricavoMedioPerAttivita: ricavoMedioPerAttivita,
    kmPerTecnico: kmPerTecnico,
    distribuzioneComune: distribuzioneComune
  };
}
