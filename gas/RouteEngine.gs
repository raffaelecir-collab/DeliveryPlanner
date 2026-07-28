/**
 * Motore di ottimizzazione del percorso per una squadra in un giorno specifico.
 *
 * Flusso: l'utente sceglie una squadra e un giorno, seleziona manualmente gli
 * interventi da includere (da mappa/elenco), e il motore calcola l'ordine di
 * visita che minimizza gli spostamenti (nearest-neighbour + miglioramento 2-opt
 * sulla matrice dei tempi di viaggio reali), poi assegna gli orari rispettando:
 *  - l'orario di lavoro della squadra (il viaggio dall'indirizzo di partenza
 *    alla prima tappa e dall'ultima tappa all'indirizzo di rientro NON è
 *    conteggiato nell'orario di lavoro: è considerato tempo di trasferimento
 *    fuori turno, come nell'app di riferimento);
 *  - l'eventuale pausa pranzo (nessuna tappa può cadere in quella fascia);
 *  - la finestra oraria richiesta da ciascun cliente.
 * Gli interventi che non trovano posto vengono segnalati (non esclusi in
 * automatico dal foglio: restano "Da pianificare" con una nota).
 */

// ---------- utilità di tempo/data (condivise) ----------

function timeToMinutes_(hhmm) {
  if (!hhmm) return 0;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10) || 0;
  var m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function minutesToTime_(mins) {
  var total = ((Math.round(mins) % 1440) + 1440) % 1440;
  var h = Math.floor(total / 60);
  var m = total % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function parseDateStr_(str) {
  if (!str) return null;
  if (str instanceof Date) return new Date(str.getFullYear(), str.getMonth(), str.getDate());
  var parts = String(str).split(/[\/\-]/);
  if (parts.length !== 3) return null;
  // accetta sia dd/MM/yyyy (dai form) sia yyyy-MM-dd (da input type=date)
  var d, mo, y;
  if (parts[0].length === 4) { y = parseInt(parts[0], 10); mo = parseInt(parts[1], 10) - 1; d = parseInt(parts[2], 10); }
  else { d = parseInt(parts[0], 10); mo = parseInt(parts[1], 10) - 1; y = parseInt(parts[2], 10); }
  return new Date(y, mo, d);
}

function formatDateStr_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function haversineKm_(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isNum_(v) {
  return typeof v === 'number' && !isNaN(v);
}

function pesoPriorita_(priorita, regole) {
  switch (priorita) {
    case PRIORITA.URGENTE: return regole.pesoPrioritaUrgente || 1000;
    case PRIORITA.ALTA: return regole.pesoPrioritaAlta || 100;
    case PRIORITA.BASSA: return regole.pesoPrioritaBassa || 1;
    default: return regole.pesoPrioritaNormale || 10;
  }
}

// ---------- calcolo tempi di viaggio (stima in linea d'aria + Google Maps Directions reale) ----------
//
// Con decine di interventi, calcolare la matrice COMPLETA (tutte le coppie) con tempi reali
// significa migliaia di chiamate esterne sincrone al servizio Maps: anche a poche centinaia di
// millisecondi l'una, il totale può richiedere minuti o superare il limite di esecuzione di Apps
// Script. Per questo la costruzione del percorso (quale ordine, quali interventi entrano) usa
// SEMPRE la stima in linea d'aria (istantanea, nessuna chiamata esterna); solo alla fine, sui
// pochi tratti che compongono il percorso realmente scelto (non le O(n²) coppie possibili), si
// interroga Google Maps per il tempo di viaggio reale.

function arrotondaCoord_(v) {
  return Math.round(v * 100000) / 100000;
}

/** Stima istantanea (nessuna chiamata esterna) basata sulla distanza in linea d'aria. */
function stimaViaggio_(origine, destinazione, regole) {
  if (Math.abs(origine.lat - destinazione.lat) < 1e-9 && Math.abs(origine.lng - destinazione.lng) < 1e-9) {
    return { minuti: 0, km: 0, stimato: false };
  }
  var km = haversineKm_(origine.lat, origine.lng, destinazione.lat, destinazione.lng);
  var velocita = regole.velocitaMediaKmH || 30;
  return { minuti: (km / velocita) * 60, km: km, stimato: true };
}

/** Tempo/distanza di viaggio reali tra due punti (cache 6h), con fallback in linea d'aria. Chiamare solo per singole coppie mirate, non in un ciclo O(n²). */
function ottieniViaggio_(origine, destinazione, regole) {
  if (Math.abs(origine.lat - destinazione.lat) < 1e-9 && Math.abs(origine.lng - destinazione.lng) < 1e-9) {
    return { minuti: 0, km: 0, stimato: false };
  }
  var cache = CacheService.getScriptCache();
  var key = 'dir:' + arrotondaCoord_(origine.lat) + ',' + arrotondaCoord_(origine.lng) + '>' +
    arrotondaCoord_(destinazione.lat) + ',' + arrotondaCoord_(destinazione.lng);
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  var risultato;
  try {
    var finder = Maps.newDirectionFinder();
    finder.setOrigin(origine.lat, origine.lng);
    finder.setDestination(destinazione.lat, destinazione.lng);
    finder.setMode(Maps.DirectionFinder.Mode.DRIVING);
    var direzioni = finder.getDirections();
    var leg = direzioni.routes[0].legs[0];
    risultato = { minuti: leg.duration.value / 60, km: leg.distance.value / 1000, stimato: false };
  } catch (e) {
    risultato = stimaViaggio_(origine, destinazione, regole);
  }
  cache.put(key, JSON.stringify(risultato), 21600);
  return risultato;
}

/** Matrice completa (tutte le coppie) basata SOLO sulla stima in linea d'aria: istantanea, nessuna chiamata esterna. */
function costruisciMatriceStimata_(nodi, regole) {
  var n = nodi.length;
  var matrice = [];
  for (var i = 0; i < n; i++) {
    matrice[i] = [];
    for (var j = 0; j < n; j++) {
      matrice[i][j] = (i === j) ? { minuti: 0, km: 0, stimato: false } : stimaViaggio_(nodi[i], nodi[j], regole);
    }
  }
  return matrice;
}

// ---------- costruzione e ottimizzazione del percorso ----------

/** Numero di altri interventi del pool raggiungibili entro densitaRaggioMinuti da idx: più alto = area con più interventi vicini. */
function densitaPunto_(idx, stopIndices, matrice, raggioMinuti) {
  var count = 0;
  for (var i = 0; i < stopIndices.length; i++) {
    var other = stopIndices[i];
    if (other !== idx && matrice[idx][other].minuti <= raggioMinuti) count++;
  }
  return count;
}

/**
 * Costruzione "cheapest insertion" con seme scelto per priorità+densità dell'area
 * (con una lieve preferenza per le aree vicine alla partenza della squadra, a
 * parità del resto, così un'area ugualmente valida ma più vicina viene preferita
 * a una lontana). Ad ogni passo si inserisce, nel punto della rotta che costa
 * meno in termini di deviazione, l'intervento rimanente più economico da
 * aggiungere: questo fa sì che gli interventi "sulla strada" tra due tappe già
 * pianificate vengano naturalmente raccolti, e che le aree con più interventi
 * vicini tendano ad essere completate per intero, massimizzando quanti
 * interventi entrano nel tempo disponibile.
 *
 * Il costo di inserimento è quello di un "percorso aperto": il primo e l'ultimo
 * intervento del percorso non hanno un costo di aggancio a partenza/rientro
 * (coerentemente con lo scheduling, dove quei due spostamenti non sono
 * conteggiati nell'orario di lavoro) — un punto viene quindi agganciato in testa
 * o in coda al costo di un solo arco, non di un arco fittizio verso la base.
 */
function costruisciPercorsoInserzione_(stopIndices, matrice, partenzaIdx, nodi, regole) {
  if (stopIndices.length === 0) return [];
  var raggioMinuti = regole.densitaRaggioMinuti || 8;
  var pesoDensita = regole.pesoDensita || 50;
  var pesoProssimita = regole.pesoProssimitaBase || 5;

  function scorePunto(idx) {
    var densita = densitaPunto_(idx, stopIndices, matrice, raggioMinuti);
    var distanzaBase = matrice[partenzaIdx][idx].minuti;
    return pesoPriorita_(nodi[idx].intervento.priorita, regole) + pesoDensita * densita - pesoProssimita * distanzaBase;
  }

  var remaining = stopIndices.slice();
  remaining.sort(function (a, b) { return scorePunto(b) - scorePunto(a); });
  var route = [remaining.shift()];

  function costoInserzione(idx, pos) {
    if (pos === -1) return matrice[idx][route[0]].minuti;
    if (pos === route.length - 1) return matrice[route[pos]][idx].minuti;
    var prima = route[pos], dopo = route[pos + 1];
    return matrice[prima][idx].minuti + matrice[idx][dopo].minuti - matrice[prima][dopo].minuti;
  }

  while (remaining.length > 0) {
    var migliore = null;
    remaining.forEach(function (idx) {
      for (var pos = -1; pos < route.length; pos++) {
        var costo = costoInserzione(idx, pos);
        if (!migliore || costo < migliore.costo) migliore = { idx: idx, pos: pos, costo: costo };
      }
    });
    route.splice(migliore.pos + 1, 0, migliore.idx);
    remaining.splice(remaining.indexOf(migliore.idx), 1);
  }
  return route;
}

/**
 * Migliora l'ordine con lo scambio 2-opt, minimizzando il tempo di viaggio totale
 * lungo il percorso "aperto" (senza contare gli archi verso partenza/rientro, per
 * coerenza con il modello di costo usato in costruzione e con lo scheduling).
 */
function dueOptMigliora_(ordine, matrice) {
  function costoTotale(ord) {
    var costo = 0;
    for (var k = 0; k < ord.length - 1; k++) costo += matrice[ord[k]][ord[k + 1]].minuti;
    return costo;
  }
  var best = ordine.slice();
  var bestCosto = costoTotale(best);
  var migliorato = true;
  var passate = 0;
  while (migliorato && passate < 30 && best.length > 2) {
    migliorato = false;
    passate++;
    for (var i = 0; i < best.length - 1; i++) {
      for (var j = i + 1; j < best.length; j++) {
        var candidato = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        var costo = costoTotale(candidato);
        if (costo < bestCosto - 1e-6) {
          best = candidato;
          bestCosto = costo;
          migliorato = true;
        }
      }
    }
  }
  return best;
}

// ---------- orario di lavoro e pausa pranzo ----------
//
// La pausa pranzo blocca solo l'INIZIO di un nuovo intervento in quella fascia (la squadra
// non viene mandata a iniziare un lavoro proprio durante la pausa): un intervento già in corso,
// iniziato prima della pausa, può proseguire senza interruzioni ed essere "a cavallo" della
// pausa stessa — non viene spezzato né bloccato a metà.

/**
 * Primo istante >= candidateStart, entro l'orario di lavoro, in cui è possibile iniziare un
 * intervento: se cade dentro la pausa pranzo viene spostato alla fine della pausa (un intervento
 * non può INIZIARE in pausa), ma una volta iniziato può proseguire oltre la pausa e oltre
 * l'orario di fine turno non è mai consentito.
 */
function trovaSlotValido_(candidateStart, durata, oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin) {
  var start = Math.max(candidateStart, oraInizioMin);
  if (pausaInizioMin !== null && pausaFineMin !== null && pausaFineMin > pausaInizioMin &&
    start >= pausaInizioMin && start < pausaFineMin) {
    start = pausaFineMin;
  }
  if (start + durata > oraFineMin) return null;
  return start;
}

// ---------- scheduling: assegna gli orari lungo l'ordine scelto ----------

function pianificaOrarioPercorso_(squadra, nodi, ordine, matrice, partenzaIdx, rientroIdx, regole) {
  var oraInizioMin = timeToMinutes_(squadra.oraInizio);
  var oraFineMin = timeToMinutes_(squadra.oraFine);
  var pausaInizioMin = squadra.pausaPranzoInizio ? timeToMinutes_(squadra.pausaPranzoInizio) : null;
  var pausaFineMin = squadra.pausaPranzoFine ? timeToMinutes_(squadra.pausaPranzoFine) : null;
  var bufferSetup = regole.bufferSetupMinuti || 10;

  var cursor = null;
  var prevIdx = partenzaIdx;
  var isFirst = true;
  var tappe = [];
  var nonIncluse = [];
  var distanzaTotale = 0, tempoViaggioTotale = 0;
  var primoIdxEffettivo = null;

  ordine.forEach(function (idx) {
    var intervento = nodi[idx].intervento;
    var finestraInizioInt = timeToMinutes_(intervento.finestraInizio || '00:00');
    var finestraFineInt = timeToMinutes_(intervento.finestraFine || '23:59');
    var durata = intervento.durataMinuti || 60;
    var viaggio = isFirst ? { minuti: 0, km: 0, stimato: false } : matrice[prevIdx][idx];
    var candidateStart = isFirst
      ? Math.max(oraInizioMin, finestraInizioInt)
      : Math.max(cursor + viaggio.minuti + bufferSetup, finestraInizioInt);
    var start = trovaSlotValido_(candidateStart, durata, oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin);
    if (start === null || start + durata > finestraFineInt) {
      nonIncluse.push({
        intervento: intervento,
        motivo: start === null
          ? 'Non entra nel turno disponibile (orario di lavoro/pausa pranzo insufficienti)'
          : 'Non rispetta la finestra oraria richiesta dal cliente (' + intervento.finestraInizio + '-' + intervento.finestraFine + ')'
      });
      return;
    }
    tappe.push({
      intervento: intervento,
      oraInizio: minutesToTime_(start),
      oraFine: minutesToTime_(start + durata),
      viaggioMinutiDallaPrecedente: isFirst ? 0 : Math.round(viaggio.minuti),
      distanzaKmDallaPrecedente: isFirst ? 0 : viaggio.km,
      stimato: viaggio.stimato
    });
    if (!isFirst) { distanzaTotale += viaggio.km; tempoViaggioTotale += viaggio.minuti; }
    if (primoIdxEffettivo === null) primoIdxEffettivo = idx;
    cursor = start + durata;
    prevIdx = idx;
    isFirst = false;
  });

  var partenzaStimata = null, rientroStimato = null;
  if (tappe.length > 0) {
    var viaggioIniziale = matrice[partenzaIdx][primoIdxEffettivo];
    var primaTappaMin = timeToMinutes_(tappe[0].oraInizio);
    partenzaStimata = {
      orario: minutesToTime_(Math.max(0, primaTappaMin - viaggioIniziale.minuti)),
      viaggioMinuti: Math.round(viaggioIniziale.minuti),
      distanzaKm: viaggioIniziale.km,
      stimato: viaggioIniziale.stimato
    };
    var viaggioFinale = matrice[prevIdx][rientroIdx];
    rientroStimato = {
      orario: minutesToTime_(cursor + viaggioFinale.minuti),
      viaggioMinuti: Math.round(viaggioFinale.minuti),
      distanzaKm: viaggioFinale.km,
      stimato: viaggioFinale.stimato
    };
    distanzaTotale += viaggioIniziale.km + viaggioFinale.km;
    tempoViaggioTotale += viaggioIniziale.minuti + viaggioFinale.minuti;
  }

  return {
    tappe: tappe,
    nonIncluse: nonIncluse,
    partenzaStimata: partenzaStimata,
    rientroStimato: rientroStimato,
    distanzaTotaleKm: Math.round(distanzaTotale * 10) / 10,
    tempoViaggioTotaleMinuti: Math.round(tempoViaggioTotale)
  };
}

/**
 * Rischedula con i tempi di viaggio REALI (Google Maps), ma li richiede solo per i pochi
 * tratti (n-1, non n²) che compongono il percorso effettivamente incluso dopo lo scheduling
 * a stima: molto più veloce che costruire l'intera matrice con tempi reali. Se i tempi reali
 * risultano più lunghi della stima al punto da far perdere una tappa, questa viene comunque
 * spostata in nonIncluse dalla ri-pianificazione (comportamento corretto: riflette la realtà).
 */
function pianificaConUpgradeReale_(squadra, nodi, ordine, matriceStima, partenzaIdx, rientroIdx, regole) {
  var risultatoStima = pianificaOrarioPercorso_(squadra, nodi, ordine, matriceStima, partenzaIdx, rientroIdx, regole);
  if (risultatoStima.tappe.length === 0) return risultatoStima;

  var idxPerInterventoId = {};
  ordine.forEach(function (idx) { idxPerInterventoId[nodi[idx].intervento.id] = idx; });
  var inclusi = risultatoStima.tappe.map(function (t) { return idxPerInterventoId[t.intervento.id]; });

  for (var k = 0; k < inclusi.length - 1; k++) {
    matriceStima[inclusi[k]][inclusi[k + 1]] = ottieniViaggio_(nodi[inclusi[k]], nodi[inclusi[k + 1]], regole);
  }
  matriceStima[partenzaIdx][inclusi[0]] = ottieniViaggio_(nodi[partenzaIdx], nodi[inclusi[0]], regole);
  var ultimo = inclusi[inclusi.length - 1];
  matriceStima[ultimo][rientroIdx] = ottieniViaggio_(nodi[ultimo], nodi[rientroIdx], regole);

  return pianificaOrarioPercorso_(squadra, nodi, ordine, matriceStima, partenzaIdx, rientroIdx, regole);
}

/**
 * Costruisce l'ordine di visita (inserimento più economico, seme per priorità/densità
 * dell'area) e pianifica gli orari usando la stima in linea d'aria (istantanea), poi tenta
 * un raffinamento 2-opt sul solo sottoinsieme di tappe risultate effettivamente incluse: le
 * tappe scartate per orario/finestra non vengono riconsiderate in questo passaggio. Il
 * raffinamento viene adottato solo se non fa perdere nessuna tappa già inclusa (altrimenti si
 * tiene il risultato originale), per non sacrificare mai il numero di interventi eseguibili
 * in cambio di un percorso marginalmente più corto. Infine i tempi vengono aggiornati con
 * quelli reali (Google Maps) solo sui tratti del percorso scelto.
 */
function costruisciEPianificaPercorso_(squadra, nodi, stopIndices, matriceStima, partenzaIdx, rientroIdx, regole) {
  var ordineIniziale = costruisciPercorsoInserzione_(stopIndices, matriceStima, partenzaIdx, nodi, regole);
  var risultato = pianificaOrarioPercorso_(squadra, nodi, ordineIniziale, matriceStima, partenzaIdx, rientroIdx, regole);
  var ordineFinale = ordineIniziale;

  if (risultato.tappe.length > 2) {
    var idxPerInterventoId = {};
    stopIndices.forEach(function (idx) { idxPerInterventoId[nodi[idx].intervento.id] = idx; });
    var inclusiOrdine = risultato.tappe.map(function (t) { return idxPerInterventoId[t.intervento.id]; });
    var raffinato = dueOptMigliora_(inclusiOrdine, matriceStima);
    var risultatoRaffinato = pianificaOrarioPercorso_(squadra, nodi, raffinato, matriceStima, partenzaIdx, rientroIdx, regole);
    if (risultatoRaffinato.tappe.length >= risultato.tappe.length) {
      risultatoRaffinato.nonIncluse = risultato.nonIncluse;
      risultato = risultatoRaffinato;
      ordineFinale = raffinato;
    }
  }

  var risultatoFinale = pianificaConUpgradeReale_(squadra, nodi, ordineFinale, matriceStima, partenzaIdx, rientroIdx, regole);
  return riempiGiornata_(squadra, nodi, risultatoFinale, matriceStima, partenzaIdx, rientroIdx, regole);
}

/**
 * Tenta di riempire ulteriormente la giornata aggiungendo in coda, tra gli interventi
 * scartati, quelli più economici da raggiungere dall'ultima tappa (viaggio + durata), finché
 * ce n'è che entrano nel tempo residuo del turno. Serve a massimizzare l'utilizzo della
 * giornata: la costruzione iniziale ottimizza soprattutto la distanza complessiva e può
 * lasciare fuori interventi brevi/vicini solo perché non erano i più economici da inserire nel
 * punto ottimale del percorso — qui si dà loro una seconda possibilità, aggiungendoli in coda
 * (che tipicamente corrisponde a proseguire lungo il percorso di rientro).
 */
function riempiGiornata_(squadra, nodi, risultato, matriceStima, partenzaIdx, rientroIdx, regole) {
  var MAX_ITERAZIONI = 15;
  var MAX_CANDIDATI_PER_TENTATIVO = 6;
  var corrente = risultato;

  var idxPerId = {};
  nodi.forEach(function (n, idx) { if (n.intervento) idxPerId[n.intervento.id] = idx; });

  for (var iter = 0; iter < MAX_ITERAZIONI; iter++) {
    if (corrente.nonIncluse.length === 0 || corrente.tappe.length === 0) break;

    var ordineAttuale = corrente.tappe.map(function (t) { return idxPerId[t.intervento.id]; });
    var ultimoIdx = ordineAttuale[ordineAttuale.length - 1];

    var candidati = corrente.nonIncluse
      .map(function (n) {
        var idx = idxPerId[n.interventoId];
        var viaggio = matriceStima[ultimoIdx][idx].minuti;
        var durata = nodi[idx].intervento.durataMinuti || 60;
        return { idx: idx, id: n.interventoId, costo: viaggio + durata };
      })
      .sort(function (a, b) { return a.costo - b.costo; })
      .slice(0, MAX_CANDIDATI_PER_TENTATIVO);

    var migliorato = false;
    for (var i = 0; i < candidati.length; i++) {
      var provaOrdine = ordineAttuale.concat([candidati[i].idx]);
      var provaRisultato = pianificaConUpgradeReale_(squadra, nodi, provaOrdine, matriceStima, partenzaIdx, rientroIdx, regole);
      if (provaRisultato.tappe.length > corrente.tappe.length) {
        // pianificaConUpgradeReale_ conosce solo gli elementi passati in provaOrdine: bisogna
        // riportare a mano gli altri scartati (tutti tranne quello appena aggiunto), altrimenti
        // andrebbero persi dal riepilogo.
        provaRisultato.nonIncluse = corrente.nonIncluse.filter(function (n) { return n.interventoId !== candidati[i].id; });
        corrente = provaRisultato;
        migliorato = true;
        break;
      }
    }
    if (!migliorato) break;
  }
  return corrente;
}

// ---------- API esposte al client ----------

/** Interventi disponibili per la selezione + eventuale percorso già confermato per squadra+giorno. */
function getContestoPianificazione(squadraId, giornoStr) {
  var giorno = parseDateStr_(giornoStr);
  var giornoFmt = formatDateStr_(giorno);
  var tutti = readAll_('INTERVENTI');
  var disponibili = tutti.filter(function (i) { return i.stato === STATO_INTERVENTO.DA_PIANIFICARE; });
  var pianificati = tutti.filter(function (i) {
    return i.squadraId === squadraId && i.dataPianificata === giornoFmt && i.stato === STATO_INTERVENTO.PIANIFICATO;
  });
  pianificati.sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); });
  return { disponibili: disponibili, pianificati: pianificati };
}

/** Tutti i percorsi già confermati per un giorno, raggruppati per squadra (vista d'insieme). */
function getPercorsiGiorno(giornoStr) {
  var giorno = parseDateStr_(giornoStr);
  var giornoFmt = formatDateStr_(giorno);
  var tutti = readAll_('INTERVENTI').filter(function (i) {
    return i.dataPianificata === giornoFmt && i.stato === STATO_INTERVENTO.PIANIFICATO;
  });
  var squadre = readAll_('SQUADRE');
  var squadreMap = {};
  squadre.forEach(function (s) { squadreMap[s.id] = s; });
  var gruppi = {};
  tutti.forEach(function (i) {
    if (!gruppi[i.squadraId]) {
      gruppi[i.squadraId] = {
        squadraId: i.squadraId,
        squadraNome: squadreMap[i.squadraId] ? squadreMap[i.squadraId].nome : i.squadraId,
        colore: squadreMap[i.squadraId] ? squadreMap[i.squadraId].colore : '#999999',
        tappe: []
      };
    }
    gruppi[i.squadraId].tappe.push(i);
  });
  var risultato = Object.keys(gruppi).map(function (k) { return gruppi[k]; });
  risultato.forEach(function (g) { g.tappe.sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); }); });
  return risultato;
}

function costruisciNodi_(squadra, selezionati) {
  var latRientro = isNum_(squadra.latRientro) ? squadra.latRientro : squadra.latPartenza;
  var lngRientro = isNum_(squadra.lngRientro) ? squadra.lngRientro : squadra.lngPartenza;
  var nodi = [{ tipo: 'partenza', lat: squadra.latPartenza, lng: squadra.lngPartenza }];
  selezionati.forEach(function (it) { nodi.push({ tipo: 'stop', lat: it.lat, lng: it.lng, intervento: it }); });
  nodi.push({ tipo: 'rientro', lat: latRientro, lng: lngRientro });
  return nodi;
}

function formattaAnteprima_(squadra, giorno, risultato) {
  return {
    squadraId: squadra.id,
    squadraNome: squadra.nome,
    giorno: formatDateStr_(giorno),
    tappe: risultato.tappe.map(function (t) {
      return {
        interventoId: t.intervento.id,
        cliente: t.intervento.cliente,
        indirizzo: t.intervento.indirizzo,
        priorita: t.intervento.priorita,
        durataMinuti: t.intervento.durataMinuti,
        oraInizio: t.oraInizio,
        oraFine: t.oraFine,
        viaggioMinuti: t.viaggioMinutiDallaPrecedente,
        distanzaKm: Math.round(t.distanzaKmDallaPrecedente * 10) / 10,
        stimato: t.stimato
      };
    }),
    nonIncluse: risultato.nonIncluse.map(function (n) {
      return { interventoId: n.intervento.id, cliente: n.intervento.cliente, motivo: n.motivo };
    }),
    partenzaStimata: risultato.partenzaStimata,
    rientroStimato: risultato.rientroStimato,
    distanzaTotaleKm: risultato.distanzaTotaleKm,
    tempoViaggioTotaleMinuti: risultato.tempoViaggioTotaleMinuti
  };
}

/**
 * Calcola l'anteprima del percorso per una squadra/giorno dato un elenco di interventi selezionati.
 * Se `ordineManuale` (array di id intervento, stesso insieme di interventoIds) è fornito, salta
 * l'ottimizzazione automatica e programma esattamente in quell'ordine (usato dopo un riordino manuale).
 */
function anteprimaPercorso(squadraId, giornoStr, interventoIds, ordineManuale) {
  if (!interventoIds || interventoIds.length === 0) throw new Error('Seleziona almeno un intervento.');
  var regole = getRegoleMappa_();
  var squadra = readAll_('SQUADRE').filter(function (s) { return s.id === squadraId; })[0];
  if (!squadra) throw new Error('Squadra non trovata.');
  if (!isNum_(squadra.latPartenza) || !isNum_(squadra.lngPartenza)) {
    throw new Error('L\'indirizzo di partenza della squadra "' + squadra.nome + '" non è geocodificato. Ri-salva la squadra con un indirizzo valido.');
  }

  var tuttiInterventi = readAll_('INTERVENTI');
  var selezionati = interventoIds.map(function (id) {
    var it = tuttiInterventi.filter(function (i) { return i.id === id; })[0];
    if (!it) throw new Error('Intervento non trovato: ' + id);
    if (!isNum_(it.lat) || !isNum_(it.lng)) throw new Error('L\'indirizzo dell\'intervento "' + it.cliente + '" non è geocodificato. Ri-salvalo con un indirizzo valido.');
    return it;
  });

  var nodi = costruisciNodi_(squadra, selezionati);
  var partenzaIdx = 0, rientroIdx = nodi.length - 1;
  var stopIndices = [];
  for (var i = 1; i < nodi.length - 1; i++) stopIndices.push(i);

  var matriceStima = costruisciMatriceStimata_(nodi, regole);
  var giorno = parseDateStr_(giornoStr);

  if (ordineManuale && ordineManuale.length === stopIndices.length) {
    var ordine = ordineManuale.map(function (id) {
      var pos = selezionati.map(function (it) { return it.id; }).indexOf(id);
      if (pos === -1) throw new Error('Ordine manuale incoerente con la selezione.');
      return pos + 1;
    });
    var risultatoManuale = pianificaConUpgradeReale_(squadra, nodi, ordine, matriceStima, partenzaIdx, rientroIdx, regole);
    return formattaAnteprima_(squadra, giorno, risultatoManuale);
  }

  var risultato = costruisciEPianificaPercorso_(squadra, nodi, stopIndices, matriceStima, partenzaIdx, rientroIdx, regole);
  return formattaAnteprima_(squadra, giorno, risultato);
}

/**
 * Conferma e salva un percorso: ricalcola l'anteprima nell'ordine indicato (fonte di verità
 * unica lato server) e scrive stato/assegnazione/orario sugli interventi coinvolti. Eventuali
 * interventi già pianificati per questa squadra/giorno ma non più presenti nella selezione
 * tornano automaticamente "Da pianificare".
 */
function confermaPercorso(squadraId, giornoStr, interventoIdsOrdinati) {
  var anteprima = anteprimaPercorso(squadraId, giornoStr, interventoIdsOrdinati, interventoIdsOrdinati);
  var tuttiInterventi = readAll_('INTERVENTI');

  var precedentementePianificati = tuttiInterventi.filter(function (i) {
    return i.squadraId === squadraId && i.dataPianificata === anteprima.giorno && i.stato === STATO_INTERVENTO.PIANIFICATO;
  });
  var idsConfermati = anteprima.tappe.map(function (t) { return t.interventoId; });
  precedentementePianificati.forEach(function (i) {
    if (idsConfermati.indexOf(i.id) === -1) {
      updateRowFields_('INTERVENTI', i._row, {
        stato: STATO_INTERVENTO.DA_PIANIFICARE, squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: ''
      });
    }
  });

  anteprima.tappe.forEach(function (t, idx) {
    var it = tuttiInterventi.filter(function (i) { return i.id === t.interventoId; })[0];
    updateRowFields_('INTERVENTI', it._row, {
      stato: STATO_INTERVENTO.PIANIFICATO,
      squadraId: squadraId,
      dataPianificata: anteprima.giorno,
      oraPianificata: t.oraInizio,
      ordineTappa: idx + 1,
      motivoNonPianificato: ''
    });
  });

  anteprima.nonIncluse.forEach(function (n) {
    var it = tuttiInterventi.filter(function (i) { return i.id === n.interventoId; })[0];
    updateRowFields_('INTERVENTI', it._row, {
      stato: STATO_INTERVENTO.DA_PIANIFICARE, squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: n.motivo
    });
  });

  upsertRow_('LOG', {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    utente: Session.getActiveUser().getEmail() || 'sconosciuto',
    squadra: anteprima.squadraNome,
    giorno: anteprima.giorno,
    tappe: anteprima.tappe.length,
    dettagli: JSON.stringify({ nonIncluse: anteprima.nonIncluse })
  });

  return anteprima;
}

// ---------- pianificazione automatica su un intervallo di giorni (una squadra) ----------

function addDays_(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function splitList_(str) {
  return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function squadraCoprCompetenza_(squadra, intervento) {
  var competenze = splitList_(squadra.competenze).map(function (c) { return c.toLowerCase(); });
  return !intervento.competenza || competenze.length === 0 || competenze.indexOf(String(intervento.competenza).toLowerCase()) !== -1;
}

/**
 * Pianifica automaticamente, senza selezione manuale, tutti gli interventi "Da pianificare"
 * compatibili con una o più squadre su un intervallo di giorni: per ciascun giorno (in ordine),
 * ciascuna squadra (nell'ordine indicato in squadraIds) pesca dal pool condiviso di interventi
 * ancora disponibili la cui finestra (Non prima del / Scadenza) include quel giorno, genera il
 * percorso ottimizzato e lo scrive subito sul foglio. La competenza richiesta è un filtro
 * rigido (nessuna selezione manuale a fare da controllo umano). Con più squadre selezionate,
 * la prima della lista ha la precedenza nella scelta degli interventi in ciascun giorno.
 */
function pianificaIntervallo(squadraIds, dataInizioStr, dataFineStr) {
  if (!squadraIds || squadraIds.length === 0) throw new Error('Seleziona almeno una squadra.');
  var regole = getRegoleMappa_();
  var tutteLeSquadre = readAll_('SQUADRE');
  var squadre = squadraIds.map(function (id) {
    var s = tutteLeSquadre.filter(function (x) { return x.id === id; })[0];
    if (!s) throw new Error('Squadra non trovata: ' + id);
    if (!isNum_(s.latPartenza) || !isNum_(s.lngPartenza)) {
      throw new Error('L\'indirizzo di partenza della squadra "' + s.nome + '" non è geocodificato. Ri-salva la squadra con un indirizzo valido.');
    }
    return s;
  });

  var dataInizio = parseDateStr_(dataInizioStr);
  var dataFine = parseDateStr_(dataFineStr);
  if (!dataInizio || !dataFine) throw new Error('Intervallo di date non valido.');
  if (dataFine < dataInizio) throw new Error('La data di fine non può precedere la data di inizio.');

  var tuttiInterventi = readAll_('INTERVENTI');
  var pool = tuttiInterventi.filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.DA_PIANIFICARE) return false;
    if (!isNum_(i.lat) || !isNum_(i.lng)) return false;
    var copertoDaAlmenoUna = squadre.some(function (s) { return squadraCoprCompetenza_(s, i); });
    if (!copertoDaAlmenoUna) return false;
    var dr = parseDateStr_(i.dataRichiesta);
    if (dr && dr > dataFine) return false;
    var sc = parseDateStr_(i.scadenza);
    if (sc && sc < dataInizio) return false;
    return true;
  });

  // Guardrail: con molti interventi/giorni/squadre l'esecuzione potrebbe avvicinarsi al limite
  // di Apps Script (6 minuti per gli account consumer). Se il tempo sta per scadere, si
  // interrompe l'elaborazione dei giorni/squadre restanti restituendo comunque quanto già
  // pianificato, invece di rischiare di superare il limite senza dare alcun riscontro.
  var TEMPO_MASSIMO_MS = 4.5 * 60 * 1000;
  var inizioEsecuzione = new Date().getTime();
  var tempoScaduto = false;
  var giorniLavorativi = splitList_(regole.giorniLavorativi || 'Lun,Mar,Mer,Gio,Ven');

  var giorniMap = {}; // 'dd/MM/yyyy' -> array di { squadraId, squadraNome, colore, tappe }
  var giorno = dataInizio;
  while (giorno <= dataFine) {
    if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; break; }
    if (giorniLavorativi.length > 0 && giorniLavorativi.indexOf(GIORNI_SETTIMANA[giorno.getDay()]) === -1) {
      giorno = addDays_(giorno, 1);
      continue;
    }
    var giornoFmt = formatDateStr_(giorno);
    squadre.forEach(function (squadra) {
      if (tempoScaduto) return;
      if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; return; }
      var candidatiOggi = pool.filter(function (i) {
        if (i._assegnato) return false;
        if (!squadraCoprCompetenza_(squadra, i)) return false;
        var dr = parseDateStr_(i.dataRichiesta);
        if (dr && giorno < dr) return false;
        var sc = parseDateStr_(i.scadenza);
        if (sc && giorno > sc) return false;
        return true;
      });
      if (candidatiOggi.length === 0) return;

      var nodi = costruisciNodi_(squadra, candidatiOggi);
      var partenzaIdx = 0, rientroIdx = nodi.length - 1;
      var stopIndices = [];
      for (var k = 1; k < nodi.length - 1; k++) stopIndices.push(k);
      var matriceStima = costruisciMatriceStimata_(nodi, regole);
      var risultato = costruisciEPianificaPercorso_(squadra, nodi, stopIndices, matriceStima, partenzaIdx, rientroIdx, regole);

      risultato.tappe.forEach(function (t, idx) {
        var originale = pool.filter(function (i) { return i.id === t.intervento.id; })[0];
        originale._assegnato = true;
        updateRowFields_('INTERVENTI', t.intervento._row, {
          stato: STATO_INTERVENTO.PIANIFICATO,
          squadraId: squadra.id,
          dataPianificata: giornoFmt,
          oraPianificata: t.oraInizio,
          ordineTappa: idx + 1,
          motivoNonPianificato: ''
        });
      });

      if (risultato.tappe.length > 0) {
        if (!giorniMap[giornoFmt]) giorniMap[giornoFmt] = [];
        var anteprimaGiorno = formattaAnteprima_(squadra, giorno, risultato);
        giorniMap[giornoFmt].push({
          squadraId: squadra.id,
          squadraNome: squadra.nome,
          colore: squadra.colore,
          tappe: anteprimaGiorno.tappe,
          partenzaStimata: anteprimaGiorno.partenzaStimata,
          rientroStimato: anteprimaGiorno.rientroStimato
        });
      }
    });
    giorno = addDays_(giorno, 1);
  }

  var giorniArray = Object.keys(giorniMap)
    .map(function (g) { return { giorno: g, squadre: giorniMap[g] }; })
    .sort(function (a, b) { return parseDateStr_(a.giorno) - parseDateStr_(b.giorno); });

  var nonIncluse = pool.filter(function (i) { return !i._assegnato; }).map(function (i) {
    var motivo = tempoScaduto
      ? 'Elaborazione interrotta per limite di tempo prima di poter considerare questo intervento: gli interventi già pianificati restano validi, ripeti la pianificazione (magari su un intervallo più corto o con meno squadre insieme) per completare il resto.'
      : 'Non è stato possibile inserirlo nel percorso di nessuna squadra tra il ' +
        formatDateStr_(dataInizio) + ' e il ' + formatDateStr_(dataFine) + ' (competenza, orario/pausa pranzo o finestra oraria non compatibili).';
    updateRowFields_('INTERVENTI', i._row, { motivoNonPianificato: motivo });
    return { interventoId: i.id, cliente: i.cliente, motivo: motivo };
  });

  var totaleTappe = giorniArray.reduce(function (sum, g) {
    return sum + g.squadre.reduce(function (s2, sq) { return s2 + sq.tappe.length; }, 0);
  }, 0);
  upsertRow_('LOG', {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    utente: Session.getActiveUser().getEmail() || 'sconosciuto',
    squadra: squadre.map(function (s) { return s.nome; }).join(', '),
    giorno: formatDateStr_(dataInizio) + ' - ' + formatDateStr_(dataFine),
    tappe: totaleTappe,
    dettagli: JSON.stringify({ nonIncluse: nonIncluse })
  });

  return {
    squadre: squadre.map(function (s) { return { squadraId: s.id, squadraNome: s.nome }; }),
    dataInizio: formatDateStr_(dataInizio),
    dataFine: formatDateStr_(dataFine),
    giorni: giorniArray,
    nonIncluse: nonIncluse,
    tempoScaduto: tempoScaduto
  };
}
