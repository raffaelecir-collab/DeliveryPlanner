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

// ---------- calcolo tempi di viaggio (Google Maps Directions con fallback) ----------

function arrotondaCoord_(v) {
  return Math.round(v * 100000) / 100000;
}

/** Tempo/distanza di viaggio reali tra due punti (cache 6h), con fallback in linea d'aria. */
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
    var km = haversineKm_(origine.lat, origine.lng, destinazione.lat, destinazione.lng);
    var velocita = regole.velocitaMediaKmH || 30;
    risultato = { minuti: (km / velocita) * 60, km: km, stimato: true };
  }
  cache.put(key, JSON.stringify(risultato), 21600);
  return risultato;
}

function costruisciMatrice_(nodi, regole) {
  var n = nodi.length;
  var matrice = [];
  for (var i = 0; i < n; i++) {
    matrice[i] = [];
    for (var j = 0; j < n; j++) {
      matrice[i][j] = (i === j) ? { minuti: 0, km: 0, stimato: false } : ottieniViaggio_(nodi[i], nodi[j], regole);
    }
  }
  return matrice;
}

// ---------- costruzione e ottimizzazione del percorso ----------

/** Nearest-neighbour: ad ogni passo sceglie la tappa più vicina; a parità (entro 2 min) preferisce la priorità più alta. */
function ordinaNearestNeighbor_(stopIndices, matrice, partenzaIdx, nodi, regole) {
  var remaining = stopIndices.slice();
  var current = partenzaIdx;
  var ordine = [];
  while (remaining.length > 0) {
    var costi = remaining.map(function (idx) { return { idx: idx, costo: matrice[current][idx].minuti }; });
    var minCosto = Math.min.apply(null, costi.map(function (c) { return c.costo; }));
    var candidati = costi.filter(function (c) { return c.costo <= minCosto + 2; });
    candidati.sort(function (a, b) {
      var pa = pesoPriorita_(nodi[a.idx].intervento.priorita, regole);
      var pb = pesoPriorita_(nodi[b.idx].intervento.priorita, regole);
      if (pb !== pa) return pb - pa;
      return a.costo - b.costo;
    });
    var scelto = candidati[0].idx;
    ordine.push(scelto);
    remaining.splice(remaining.indexOf(scelto), 1);
    current = scelto;
  }
  return ordine;
}

/** Migliora l'ordine con lo scambio 2-opt (estremi partenza/rientro fissi), minimizzando il tempo totale di viaggio. */
function dueOptMigliora_(ordine, matrice, partenzaIdx, rientroIdx) {
  function costoTotale(ord) {
    if (ord.length === 0) return 0;
    var costo = matrice[partenzaIdx][ord[0]].minuti;
    for (var k = 0; k < ord.length - 1; k++) costo += matrice[ord[k]][ord[k + 1]].minuti;
    costo += matrice[ord[ord.length - 1]][rientroIdx].minuti;
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

// ---------- finestre di lavoro (orario turno meno pausa pranzo) ----------

function calcolaFinestreLavoro_(oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin) {
  if (pausaInizioMin === null || pausaFineMin === null || pausaFineMin <= pausaInizioMin) {
    return [[oraInizioMin, oraFineMin]];
  }
  var finestre = [];
  if (pausaInizioMin > oraInizioMin) finestre.push([oraInizioMin, Math.min(pausaInizioMin, oraFineMin)]);
  if (pausaFineMin < oraFineMin) finestre.push([Math.max(pausaFineMin, oraInizioMin), oraFineMin]);
  return finestre.filter(function (f) { return f[1] > f[0]; });
}

/** Primo istante >= candidateStart in cui [start, start+durata] rientra interamente in una finestra. */
function trovaSlotValido_(candidateStart, durata, finestre) {
  for (var i = 0; i < finestre.length; i++) {
    var s = finestre[i][0], e = finestre[i][1];
    var start = Math.max(candidateStart, s);
    if (start + durata <= e) return start;
  }
  return null;
}

// ---------- scheduling: assegna gli orari lungo l'ordine scelto ----------

function pianificaOrarioPercorso_(squadra, nodi, ordine, matrice, partenzaIdx, rientroIdx, regole) {
  var oraInizioMin = timeToMinutes_(squadra.oraInizio);
  var oraFineMin = timeToMinutes_(squadra.oraFine);
  var pausaInizioMin = squadra.pausaPranzoInizio ? timeToMinutes_(squadra.pausaPranzoInizio) : null;
  var pausaFineMin = squadra.pausaPranzoFine ? timeToMinutes_(squadra.pausaPranzoFine) : null;
  var finestre = calcolaFinestreLavoro_(oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin);
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
    var start = trovaSlotValido_(candidateStart, durata, finestre);
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

  var matrice = costruisciMatrice_(nodi, regole);

  var ordine;
  if (ordineManuale && ordineManuale.length === stopIndices.length) {
    ordine = ordineManuale.map(function (id) {
      var pos = selezionati.map(function (it) { return it.id; }).indexOf(id);
      if (pos === -1) throw new Error('Ordine manuale incoerente con la selezione.');
      return pos + 1;
    });
  } else {
    ordine = ordinaNearestNeighbor_(stopIndices, matrice, partenzaIdx, nodi, regole);
    ordine = dueOptMigliora_(ordine, matrice, partenzaIdx, rientroIdx);
  }

  var giorno = parseDateStr_(giornoStr);
  var risultato = pianificaOrarioPercorso_(squadra, nodi, ordine, matrice, partenzaIdx, rientroIdx, regole);
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
 * compatibili con la squadra su un intervallo di giorni: per ciascun giorno (in ordine) genera
 * il percorso ottimizzato con gli interventi ancora disponibili e la cui finestra
 * (Non prima del / Scadenza) include quel giorno, poi lo scrive subito sul foglio.
 * A differenza della modalità a singolo giorno, qui la competenza richiesta è un filtro
 * rigido (nessuna selezione manuale a fare da controllo umano).
 */
function pianificaIntervallo(squadraId, dataInizioStr, dataFineStr) {
  var regole = getRegoleMappa_();
  var squadra = readAll_('SQUADRE').filter(function (s) { return s.id === squadraId; })[0];
  if (!squadra) throw new Error('Squadra non trovata.');
  if (!isNum_(squadra.latPartenza) || !isNum_(squadra.lngPartenza)) {
    throw new Error('L\'indirizzo di partenza della squadra "' + squadra.nome + '" non è geocodificato. Ri-salva la squadra con un indirizzo valido.');
  }

  var dataInizio = parseDateStr_(dataInizioStr);
  var dataFine = parseDateStr_(dataFineStr);
  if (!dataInizio || !dataFine) throw new Error('Intervallo di date non valido.');
  if (dataFine < dataInizio) throw new Error('La data di fine non può precedere la data di inizio.');

  var tuttiInterventi = readAll_('INTERVENTI');
  var pool = tuttiInterventi.filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.DA_PIANIFICARE) return false;
    if (!isNum_(i.lat) || !isNum_(i.lng)) return false;
    if (!squadraCoprCompetenza_(squadra, i)) return false;
    var dr = parseDateStr_(i.dataRichiesta);
    if (dr && dr > dataFine) return false;
    var sc = parseDateStr_(i.scadenza);
    if (sc && sc < dataInizio) return false;
    return true;
  });

  var giorniPianificati = [];
  var giorno = dataInizio;
  while (giorno <= dataFine) {
    var candidatiOggi = pool.filter(function (i) {
      if (i._assegnato) return false;
      var dr = parseDateStr_(i.dataRichiesta);
      if (dr && giorno < dr) return false;
      var sc = parseDateStr_(i.scadenza);
      if (sc && giorno > sc) return false;
      return true;
    });

    if (candidatiOggi.length > 0) {
      var nodi = costruisciNodi_(squadra, candidatiOggi);
      var partenzaIdx = 0, rientroIdx = nodi.length - 1;
      var stopIndices = [];
      for (var k = 1; k < nodi.length - 1; k++) stopIndices.push(k);
      var matrice = costruisciMatrice_(nodi, regole);
      var ordine = ordinaNearestNeighbor_(stopIndices, matrice, partenzaIdx, nodi, regole);
      ordine = dueOptMigliora_(ordine, matrice, partenzaIdx, rientroIdx);
      var risultato = pianificaOrarioPercorso_(squadra, nodi, ordine, matrice, partenzaIdx, rientroIdx, regole);

      risultato.tappe.forEach(function (t, idx) {
        var originale = pool.filter(function (i) { return i.id === t.intervento.id; })[0];
        originale._assegnato = true;
        updateRowFields_('INTERVENTI', t.intervento._row, {
          stato: STATO_INTERVENTO.PIANIFICATO,
          squadraId: squadraId,
          dataPianificata: formatDateStr_(giorno),
          oraPianificata: t.oraInizio,
          ordineTappa: idx + 1,
          motivoNonPianificato: ''
        });
      });

      if (risultato.tappe.length > 0) {
        giorniPianificati.push(formattaAnteprima_(squadra, giorno, risultato));
      }
    }
    giorno = addDays_(giorno, 1);
  }

  var nonIncluse = pool.filter(function (i) { return !i._assegnato; }).map(function (i) {
    var motivo = 'Non è stato possibile inserirlo nel percorso di nessuna squadra tra il ' +
      formatDateStr_(dataInizio) + ' e il ' + formatDateStr_(dataFine) + ' (orario/pausa pranzo/finestra oraria insufficienti).';
    updateRowFields_('INTERVENTI', i._row, { motivoNonPianificato: motivo });
    return { interventoId: i.id, cliente: i.cliente, motivo: motivo };
  });

  var totaleTappe = giorniPianificati.reduce(function (sum, g) { return sum + g.tappe.length; }, 0);
  upsertRow_('LOG', {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    utente: Session.getActiveUser().getEmail() || 'sconosciuto',
    squadra: squadra.nome,
    giorno: formatDateStr_(dataInizio) + ' - ' + formatDateStr_(dataFine),
    tappe: totaleTappe,
    dettagli: JSON.stringify({ nonIncluse: nonIncluse })
  });

  return {
    squadraId: squadra.id,
    squadraNome: squadra.nome,
    dataInizio: formatDateStr_(dataInizio),
    dataFine: formatDateStr_(dataFine),
    giorni: giorniPianificati,
    nonIncluse: nonIncluse
  };
}
