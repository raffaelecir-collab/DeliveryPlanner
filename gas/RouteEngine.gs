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

/** Data odierna normalizzata a mezzanotte, per confronti omogenei con parseDateStr_. */
function dataOggi_() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

/**
 * Valore interno ("intensità piena", equivalente al vecchio peso numerico) corrispondente al
 * 100% di ciascuna regola-peso: le regole stesse sono impostate ed espresse in percentuale
 * (0-100) nel foglio Regole per essere comprensibili senza dover capire scale numeriche
 * arbitrarie, ma internamente le formule di punteggio continuano a usare questi valori assoluti.
 */
var RIFERIMENTO_PESI_ = {
  pesoPrioritaUrgente: 1000,
  pesoPrioritaAlta: 100,
  pesoPrioritaNormale: 10,
  pesoPrioritaBassa: 1,
  pesoDensita: 50,
  pesoProssimitaBase: 5,
  pesoRicavo: 0.2,
  pesoCompetenzaSpecifica: 150
};

/** Converte una regola-peso in percentuale (0-100, 100 = intensità di default se non impostata) nel valore interno usato dalle formule di punteggio. */
function pesoRegola_(regole, chiave) {
  var percentuale = regole[chiave];
  if (percentuale === undefined || percentuale === null || percentuale === '') percentuale = 100;
  return (percentuale / 100) * RIFERIMENTO_PESI_[chiave];
}

/**
 * La scadenza NON esclude più un intervento dalla pianificazione automatica (vedi
 * riempiBucoGiorno/pianificaIntervallo): un intervento con scadenza già superata rispetto a oggi
 * resta pianificabile, ma va trattato come massima priorità ("Urgente") ovunque la priorità
 * influenzi l'ordine di scelta, per farlo emergere subito invece di lasciarlo indietro a tempo
 * indeterminato. Calcolato al volo (non scritto sul foglio): si aggiorna da solo se la scadenza
 * viene corretta o rimossa, senza lasciare un'etichetta "Urgente" incoerente.
 */
function prioritaEffettiva_(intervento) {
  var sc = parseDateStr_(intervento.scadenza);
  if (sc && sc < dataOggi_()) return PRIORITA.URGENTE;
  return intervento.priorita;
}

function pesoPriorita_(priorita, regole) {
  switch (priorita) {
    case PRIORITA.URGENTE: return pesoRegola_(regole, 'pesoPrioritaUrgente');
    case PRIORITA.ALTA: return pesoRegola_(regole, 'pesoPrioritaAlta');
    case PRIORITA.BASSA: return pesoRegola_(regole, 'pesoPrioritaBassa');
    default: return pesoRegola_(regole, 'pesoPrioritaNormale');
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
function costruisciPercorsoInserzione_(squadra, stopIndices, matrice, partenzaIdx, nodi, regole) {
  if (stopIndices.length === 0) return [];
  var raggioMinuti = regole.densitaRaggioMinuti || 8;
  var pesoDensita = pesoRegola_(regole, 'pesoDensita');
  var pesoProssimita = pesoRegola_(regole, 'pesoProssimitaBase');
  // All'inizio della costruzione la produzione della squadra per questa giornata è ancora zero,
  // quindi si è sempre alla massima distanza dal target: il ricavo pesa già alla sua spinta
  // massima nella scelta del seme (stessa logica di riempiGiornata_, dove invece si attenua man
  // mano che la produzione accumulata si avvicina al target).
  var pesoRicavo = pesoRegola_(regole, 'pesoRicavo') * (squadra.produzioneTarget ? 5 : 1);
  var pesoCompetenzaSpecifica = pesoRegola_(regole, 'pesoCompetenzaSpecifica');

  function scorePunto(idx) {
    var densita = densitaPunto_(idx, stopIndices, matrice, raggioMinuti);
    var distanzaBase = matrice[partenzaIdx][idx].minuti;
    var ricavo = nodi[idx].intervento.ricavo || 0;
    var bonusCompetenza = squadraHaCompetenzaSpecificaPer_(squadra, nodi[idx].intervento) ? pesoCompetenzaSpecifica : 0;
    return pesoPriorita_(prioritaEffettiva_(nodi[idx].intervento), regole) + pesoDensita * densita - pesoProssimita * distanzaBase + pesoRicavo * ricavo + bonusCompetenza;
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
      // Le posizioni vengono provate dalla coda verso la testa (non da -1 in su): a parità di
      // costo (tipico quando due interventi sono vicinissimi tra loro, quindi indifferente
      // inserirsi prima o dopo) questo fa sì che il pareggio venga risolto in coda, non in testa.
      // Altrimenti il "seme" scelto per primo in base a punteggio (priorità/densità/ricavo)
      // finirebbe quasi sempre spostato in seconda posizione da un candidato vicinissimo
      // inserito davanti a lui a costo pari, vanificando proprio la priorità che lo ha fatto
      // scegliere come seme quando il tempo disponibile basta per uno solo dei due.
      for (var pos = route.length - 1; pos >= -1; pos--) {
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
// La pausa pranzo blocca sempre l'INIZIO di un nuovo intervento in quella fascia (la squadra
// non viene mai mandata a iniziare un lavoro proprio durante la pausa). Un intervento già in
// corso quando inizia la pausa può sconfinarci dentro solo entro la tolleranza impostata in
// Regole (pausaTolleranzaMinuti): un piccolo sconfinamento viene tollerato senza spezzare il
// lavoro, ma oltre quella soglia la pausa viene inserita per intero (il tecnico si ferma
// davvero e riprende a fine pausa), spostando in avanti il completamento reale dell'intervento
// e, di conseguenza, l'orario delle tappe successive.

/**
 * Primo istante >= candidateStart, entro l'orario di lavoro, in cui è possibile iniziare un
 * intervento, più l'istante di completamento REALE (che può essere posticipato dall'inserimento
 * della pausa pranzo). Restituisce null se non c'è modo di iniziare/completare entro il turno.
 */
function trovaSlotValido_(candidateStart, durata, oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin, tolleranzaPausaMinuti) {
  var start = Math.max(candidateStart, oraInizioMin);
  var haPausa = pausaInizioMin !== null && pausaFineMin !== null && pausaFineMin > pausaInizioMin;
  if (haPausa && start >= pausaInizioMin && start < pausaFineMin) {
    start = pausaFineMin; // un intervento non può INIZIARE durante la pausa
  }

  var fine = start + durata;
  if (haPausa && start < pausaInizioMin && fine > pausaInizioMin) {
    // L'intervento è già in corso quando comincia la pausa: quanti minuti di lavoro
    // sconfinerebbero nella pausa se si proseguisse senza fermarsi.
    var minutiSconfinamento = fine - pausaInizioMin;
    if (minutiSconfinamento > (tolleranzaPausaMinuti || 0)) {
      fine += (pausaFineMin - pausaInizioMin); // pausa inserita per intero
    }
  }

  if (fine > oraFineMin) return null;
  return { start: start, fine: fine };
}

// ---------- scheduling: assegna gli orari lungo l'ordine scelto ----------

function pianificaOrarioPercorso_(squadra, nodi, ordine, matrice, partenzaIdx, rientroIdx, regole) {
  var oraInizioMin = timeToMinutes_(squadra.oraInizio);
  var oraFineMin = timeToMinutes_(squadra.oraFine);
  var pausaInizioMin = squadra.pausaPranzoInizio ? timeToMinutes_(squadra.pausaPranzoInizio) : null;
  var pausaFineMin = squadra.pausaPranzoFine ? timeToMinutes_(squadra.pausaPranzoFine) : null;
  var bufferSetup = regole.bufferSetupMinuti || 10;
  var tolleranzaPausaMinuti = regole.pausaTolleranzaMinuti || 0;
  var tempoViaggioMassimo = regole.tempoViaggioMassimoMinuti || 0;

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
    if (!isFirst && tempoViaggioMassimo > 0 && (tempoViaggioTotale + viaggio.minuti) > tempoViaggioMassimo) {
      nonIncluse.push({
        intervento: intervento,
        motivo: 'Supererebbe il tempo massimo di viaggio tra le tappe impostato per la giornata (' + Math.round(tempoViaggioMassimo) + ' min)'
      });
      return;
    }
    var candidateStart = isFirst
      ? Math.max(oraInizioMin, finestraInizioInt)
      : Math.max(cursor + viaggio.minuti + bufferSetup, finestraInizioInt);
    var slot = trovaSlotValido_(candidateStart, durata, oraInizioMin, oraFineMin, pausaInizioMin, pausaFineMin, tolleranzaPausaMinuti);
    if (slot === null || slot.fine > finestraFineInt) {
      nonIncluse.push({
        intervento: intervento,
        motivo: slot === null
          ? 'Non entra nel turno disponibile (orario di lavoro/pausa pranzo insufficienti)'
          : 'Non rispetta la finestra oraria richiesta dal cliente (' + intervento.finestraInizio + '-' + intervento.finestraFine + ')'
      });
      return;
    }
    tappe.push({
      intervento: intervento,
      oraInizio: minutesToTime_(slot.start),
      oraFine: minutesToTime_(slot.fine),
      viaggioMinutiDallaPrecedente: isFirst ? 0 : Math.round(viaggio.minuti),
      distanzaKmDallaPrecedente: isFirst ? 0 : viaggio.km,
      stimato: viaggio.stimato
    });
    if (!isFirst) { distanzaTotale += viaggio.km; tempoViaggioTotale += viaggio.minuti; }
    if (primoIdxEffettivo === null) primoIdxEffettivo = idx;
    cursor = slot.fine;
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
  var inclusi = risultatoStima.tappe
    .map(function (t) { return idxPerInterventoId[t.intervento.id]; })
    .filter(function (idx) { return idx !== undefined; });
  if (inclusi.length === 0) return risultatoStima;

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
 *
 * Se `ordineInizialeForzato` è fornito (dal confronto congiunto multi-squadra), viene usato al
 * posto della normale costruzione a inserimento più economico: eventuali candidati di
 * stopIndices non compresi in quell'ordine (mai vinti da questa squadra nel confronto) vengono
 * comunque proposti al passaggio di riempimento finale, per non perdere copertura.
 */
function costruisciEPianificaPercorso_(squadra, nodi, stopIndices, matriceStima, partenzaIdx, rientroIdx, regole, ordineInizialeForzato) {
  var ordineIniziale = ordineInizialeForzato || costruisciPercorsoInserzione_(squadra, stopIndices, matriceStima, partenzaIdx, nodi, regole);
  var risultato = pianificaOrarioPercorso_(squadra, nodi, ordineIniziale, matriceStima, partenzaIdx, rientroIdx, regole);
  var ordineFinale = ordineIniziale;

  if (risultato.tappe.length > 2) {
    var idxPerInterventoId = {};
    stopIndices.forEach(function (idx) { idxPerInterventoId[nodi[idx].intervento.id] = idx; });
    var inclusiOrdine = risultato.tappe
      .map(function (t) { return idxPerInterventoId[t.intervento.id]; })
      .filter(function (idx) { return idx !== undefined; });
    var raffinato = inclusiOrdine.length === risultato.tappe.length ? dueOptMigliora_(inclusiOrdine, matriceStima) : ordineFinale;
    var risultatoRaffinato = pianificaOrarioPercorso_(squadra, nodi, raffinato, matriceStima, partenzaIdx, rientroIdx, regole);
    if (raffinato !== ordineFinale && risultatoRaffinato.tappe.length >= risultato.tappe.length) {
      risultatoRaffinato.nonIncluse = risultato.nonIncluse;
      risultato = risultatoRaffinato;
      ordineFinale = raffinato;
    }
  }

  var risultatoFinale = pianificaConUpgradeReale_(squadra, nodi, ordineFinale, matriceStima, partenzaIdx, rientroIdx, regole);

  if (ordineInizialeForzato) {
    var consideratiSet = {};
    ordineInizialeForzato.forEach(function (idx) { consideratiSet[idx] = true; });
    stopIndices.forEach(function (idx) {
      if (!consideratiSet[idx]) {
        risultatoFinale.nonIncluse.push({ intervento: nodi[idx].intervento, motivo: 'Non vinto da questa squadra nel confronto tra squadre' });
      }
    });
  }

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
  var MAX_ITERAZIONI = 30;
  var MAX_CANDIDATI_PER_TENTATIVO = 8;
  var corrente = risultato;

  var idxPerId = {};
  nodi.forEach(function (n, idx) { if (n.intervento) idxPerId[n.intervento.id] = idx; });

  function costoInserzionePosizione(route, idx, pos) {
    if (pos === -1) return matriceStima[idx][route[0]].minuti;
    if (pos === route.length - 1) return matriceStima[route[pos]][idx].minuti;
    var prima = route[pos], dopo = route[pos + 1];
    return matriceStima[prima][idx].minuti + matriceStima[idx][dopo].minuti - matriceStima[prima][dopo].minuti;
  }

  var target = squadra.produzioneTarget || 0;

  for (var iter = 0; iter < MAX_ITERAZIONI; iter++) {
    if (corrente.nonIncluse.length === 0 || corrente.tappe.length === 0) break;

    var ordineAttuale = corrente.tappe.map(function (t) { return idxPerId[t.intervento.id]; });
    if (ordineAttuale.indexOf(undefined) !== -1) break; // id incoerente: non rischiare, esci senza ulteriori aggiunte

    // Quanto manca al target di produzione della squadra guida QUANTO il ricavo pesa in questo
    // giro: più siamo lontani dal target, più un candidato redditizio viene preferito con forza
    // (fino a diverse volte il peso base); avvicinandosi al target il peso torna gradualmente a
    // quello base impostato in Regole. Superato il target, nessuna spinta aggiuntiva — resta
    // comunque un fattore tra gli altri, non un vincolo, e il riempimento della giornata non si
    // ferma mai per questo.
    var pesoRicavoBase = pesoRegola_(regole, 'pesoRicavo');
    var pesoRicavoEffettivo = pesoRicavoBase;
    if (target > 0) {
      var produzioneAttuale = corrente.tappe.reduce(function (sum, t) { return sum + (t.intervento.ricavo || 0); }, 0);
      if (produzioneAttuale < target) {
        var distanzaDalTarget = (target - produzioneAttuale) / target; // 0..1
        pesoRicavoEffettivo = pesoRicavoBase * (1 + distanzaDalTarget * 4); // fino a 5x quando molto lontani
      }
    }
    var pesoCompetenzaSpecifica = pesoRegola_(regole, 'pesoCompetenzaSpecifica');

    // Per ciascun candidato scartato, cerca il punto di inserimento più economico su TUTTO il
    // percorso (non solo in coda): un intervento può stare bene "in mezzo" a due tappe già
    // pianificate anche se da sola l'ultima tappa sembrerebbe lontana. Questo massimizza le
    // probabilità di riempire i buchi residui della giornata.
    var candidati = corrente.nonIncluse
      .filter(function (n) { return idxPerId[n.interventoId] !== undefined; })
      .map(function (n) {
        var idx = idxPerId[n.interventoId];
        var migliorPos = -1, migliorCosto = Infinity;
        for (var pos = -1; pos < ordineAttuale.length; pos++) {
          var costo = costoInserzionePosizione(ordineAttuale, idx, pos);
          if (costo < migliorCosto) { migliorCosto = costo; migliorPos = pos; }
        }
        var durata = nodi[idx].intervento.durataMinuti || 60;
        var ricavo = nodi[idx].intervento.ricavo || 0;
        var bonusCompetenza = squadraHaCompetenzaSpecificaPer_(squadra, nodi[idx].intervento) ? pesoCompetenzaSpecifica : 0;
        // Il ricavo e la competenza specifica abbassano il costo "percepito" di un candidato (a
        // parità di tutto il resto lo fanno scegliere prima), senza mai impedire il riempimento
        // della giornata: restano fattori tra gli altri, non vincoli.
        return { idx: idx, id: n.interventoId, pos: migliorPos, costo: migliorCosto + durata - pesoRicavoEffettivo * ricavo - bonusCompetenza };
      })
      .sort(function (a, b) { return a.costo - b.costo; })
      .slice(0, MAX_CANDIDATI_PER_TENTATIVO);

    var migliorato = false;
    for (var i = 0; i < candidati.length; i++) {
      var provaOrdine = ordineAttuale.slice();
      provaOrdine.splice(candidati[i].pos + 1, 0, candidati[i].idx);
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

/**
 * Come riempiGiornata_, ma con un pool di candidati ESPLICITO (passato dal chiamante) invece che
 * ricavato da risultato.nonIncluse: usata da estendiPercorsoEsistente_ per aggiungere nuovi
 * candidati a un percorso le cui tappe iniziali sono già fissate (vedi lì). Per ciascun candidato
 * prova TUTTE le posizioni di inserimento (partendo dalla più economica in termini di viaggio),
 * non solo la migliore: con stime di viaggio simmetriche la posizione "più economica" spesso
 * pareggia tra inserire prima o dopo una tappa fissa, e solo una delle due può risultare
 * compatibile con orario di lavoro/pausa pranzo/finestra oraria (es. una tappa lunga già fissata
 * che finisce esattamente all'inizio della pausa pranzo: inserire un candidato prima la fa
 * sconfinare, inserirlo dopo no). Fermarsi alla prima posizione provata farebbe scartare
 * ingiustamente candidati che in realtà entrano benissimo nella giornata. Per lo stesso motivo,
 * ogni iterazione prova TUTTI i candidati non ancora inclusi (in ordine di costo crescente, così
 * il caso comune resta veloce) e non si ferma ai primi N: alcuni candidati "economici" per
 * vicinanza/durata possono essere di fatto impossibili da inserire (finestra oraria, competenza)
 * mentre uno "più costoso" secondo la stima sarebbe perfettamente pianificabile — fermarsi dopo
 * un numero fisso di tentativi lo scarterebbe ingiustamente. Accetta un inserimento solo se il
 * numero di tappe incluse aumenta — non elimina/sposta mai una tappa già presente.
 */
function riempiGiornataConCandidatiEspliciti_(squadra, nodi, risultato, matriceStima, partenzaIdx, rientroIdx, regole) {
  var MAX_ITERAZIONI = 30;
  var corrente = risultato;

  var idxPerId = {};
  nodi.forEach(function (n, idx) { if (n.intervento) idxPerId[n.intervento.id] = idx; });

  function costoInserzionePosizione(route, idx, pos) {
    if (pos === -1) return matriceStima[idx][route[0]].minuti;
    if (pos === route.length - 1) return matriceStima[route[pos]][idx].minuti;
    var prima = route[pos], dopo = route[pos + 1];
    return matriceStima[prima][idx].minuti + matriceStima[idx][dopo].minuti - matriceStima[prima][dopo].minuti;
  }

  var target = squadra.produzioneTarget || 0;

  for (var iter = 0; iter < MAX_ITERAZIONI; iter++) {
    if (corrente.nonIncluse.length === 0 || corrente.tappe.length === 0) break;

    var ordineAttuale = corrente.tappe.map(function (t) { return idxPerId[t.intervento.id]; });
    if (ordineAttuale.indexOf(undefined) !== -1) break;

    var pesoRicavoBase = pesoRegola_(regole, 'pesoRicavo');
    var pesoRicavoEffettivo = pesoRicavoBase;
    if (target > 0) {
      var produzioneAttuale = corrente.tappe.reduce(function (sum, t) { return sum + (t.intervento.ricavo || 0); }, 0);
      if (produzioneAttuale < target) {
        var distanzaDalTarget = (target - produzioneAttuale) / target;
        pesoRicavoEffettivo = pesoRicavoBase * (1 + distanzaDalTarget * 4);
      }
    }
    var pesoCompetenzaSpecifica = pesoRegola_(regole, 'pesoCompetenzaSpecifica');

    var candidati = corrente.nonIncluse
      .map(function (n) {
        var idx = idxPerId[n.intervento.id];
        if (idx === undefined) return null;
        var posizioni = [];
        for (var pos = -1; pos < ordineAttuale.length; pos++) {
          posizioni.push({ pos: pos, costoViaggio: costoInserzionePosizione(ordineAttuale, idx, pos) });
        }
        posizioni.sort(function (a, b) { return a.costoViaggio - b.costoViaggio; });
        var durata = nodi[idx].intervento.durataMinuti || 60;
        var ricavo = nodi[idx].intervento.ricavo || 0;
        var bonusCompetenza = squadraHaCompetenzaSpecificaPer_(squadra, nodi[idx].intervento) ? pesoCompetenzaSpecifica : 0;
        return { idx: idx, id: n.intervento.id, posizioni: posizioni, costo: posizioni[0].costoViaggio + durata - pesoRicavoEffettivo * ricavo - bonusCompetenza };
      })
      .filter(function (c) { return c !== null; })
      .sort(function (a, b) { return a.costo - b.costo; });

    var migliorato = false;
    for (var i = 0; i < candidati.length && !migliorato; i++) {
      for (var p = 0; p < candidati[i].posizioni.length; p++) {
        var provaOrdine = ordineAttuale.slice();
        provaOrdine.splice(candidati[i].posizioni[p].pos + 1, 0, candidati[i].idx);
        var provaRisultato = pianificaConUpgradeReale_(squadra, nodi, provaOrdine, matriceStima, partenzaIdx, rientroIdx, regole);
        if (provaRisultato.tappe.length > corrente.tappe.length) {
          provaRisultato.nonIncluse = corrente.nonIncluse.filter(function (n) { return n.intervento.id !== candidati[i].id; });
          corrente = provaRisultato;
          migliorato = true;
          break;
        }
      }
    }
    if (!migliorato) break;
  }
  return corrente;
}

/**
 * Pianifica una giornata mantenendo FISSE (stesso ordine, e stessi orari se nulla cambia) le
 * tappe indicate da ordineFissato (indici in nodi, tipicamente le tappe già confermate in
 * precedenza), e prova ad aggiungere — senza mai spostarle o toglierle — i candidati elencati in
 * indiciCandidati nei buchi residui del turno. Usata quando una squadra/giorno ha già un
 * percorso confermato (tab Programmazione → "Riempi buco", o pianificazione automatica su un
 * intervallo che ricade su un giorno già pianificato in precedenza): evita che una ricostruzione
 * da zero possa riordinare o scartare interventi già pianificati per far posto ad altri.
 */
function estendiPercorsoEsistente_(squadra, nodi, ordineFissato, indiciCandidati, matriceStima, partenzaIdx, rientroIdx, regole) {
  var risultato = pianificaConUpgradeReale_(squadra, nodi, ordineFissato, matriceStima, partenzaIdx, rientroIdx, regole);
  risultato.nonIncluse = indiciCandidati.map(function (idx) {
    return { intervento: nodi[idx].intervento, motivo: 'Non è entrato nel tempo residuo della giornata' };
  });
  return riempiGiornataConCandidatiEspliciti_(squadra, nodi, risultato, matriceStima, partenzaIdx, rientroIdx, regole);
}

// ---------- API esposte al client ----------

/** Interventi disponibili per la selezione + eventuale percorso già confermato per squadra+giorno. */
function getContestoPianificazione(squadraId, giornoStr) {
  var giorno = parseDateStr_(giornoStr);
  var giornoFmt = formatDateStr_(giorno);
  var tutti = assicuraIdTutti_('INTERVENTI');
  var disponibili = tutti.filter(function (i) { return i.stato === STATO_INTERVENTO.DA_PIANIFICARE; });
  var pianificati = tutti.filter(function (i) {
    return i.squadraId === squadraId && i.dataPianificata === giornoFmt && i.stato === STATO_INTERVENTO.PIANIFICATO;
  });
  pianificati.sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); });

  // Interventi già pianificati ma per un'altra squadra e/o un altro giorno: inclusi (con
  // l'indicazione di dove si trovano attualmente) così, dalla mappa di selezione, è possibile
  // "spostarli" manualmente su questa squadra/giorno semplicemente selezionandoli e
  // confermando — la conferma sovrascrive la loro assegnazione precedente.
  var squadreMap = {};
  readAll_('SQUADRE').forEach(function (s) { squadreMap[s.id] = s; });
  var pianificatiAltrove = tutti.filter(function (i) {
    return i.stato === STATO_INTERVENTO.PIANIFICATO && !(i.squadraId === squadraId && i.dataPianificata === giornoFmt);
  }).map(function (i) {
    var s = squadreMap[i.squadraId];
    return Object.assign({}, i, { squadraNomeAttuale: s ? s.nome : i.squadraId });
  });

  return { disponibili: disponibili, pianificati: pianificati, pianificatiAltrove: pianificatiAltrove };
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
        priorita: prioritaEffettiva_(t.intervento),
        durataMinuti: t.intervento.durataMinuti,
        ricavo: t.intervento.ricavo || 0,
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
    tempoViaggioTotaleMinuti: risultato.tempoViaggioTotaleMinuti,
    produzioneTotale: risultato.tappe.reduce(function (sum, t) { return sum + (t.intervento.ricavo || 0); }, 0),
    produzioneTarget: squadra.produzioneTarget || 0
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
  var squadra = assicuraIdTutti_('SQUADRE').filter(function (s) { return s.id === squadraId; })[0];
  if (!squadra) throw new Error('Squadra non trovata.');
  if (!isNum_(squadra.latPartenza) || !isNum_(squadra.lngPartenza)) {
    throw new Error('L\'indirizzo di partenza della squadra "' + squadra.nome + '" non è geocodificato. Ri-salva la squadra con un indirizzo valido.');
  }
  var giorno = parseDateStr_(giornoStr);
  if (!giorno) throw new Error('Data non valida.');
  if (!squadraDisponibileGiorno_(squadra, giorno)) {
    throw new Error('La squadra "' + squadra.nome + '" non è disponibile il ' + formatDateStr_(giorno) + ' (' + motivoIndisponibilita_(squadra, giorno) + ').');
  }

  var tuttiInterventi = assicuraIdTutti_('INTERVENTI');
  var selezionati = interventoIds.map(function (id) {
    var it = tuttiInterventi.filter(function (i) { return i.id === id; })[0];
    if (!it) throw new Error('Intervento non trovato: ' + id);
    if (!isNum_(it.lat) || !isNum_(it.lng)) throw new Error('L\'indirizzo dell\'intervento "' + it.cliente + '" non è geocodificato. Ri-salvalo con un indirizzo valido.');
    return it;
  });

  // La competenza richiesta è un vincolo rigido: una squadra non può essere assegnata a un
  // intervento la cui competenza non è tra le proprie, né in questa modalità manuale né in
  // quella automatica (già filtrata a monte da squadraCoprCompetenza_ in pianificaIntervallo).
  var incompatibili = selezionati.filter(function (it) { return !squadraCoprCompetenza_(squadra, it); });
  if (incompatibili.length > 0) {
    throw new Error('La squadra "' + squadra.nome + '" non ha la competenza richiesta per: ' +
      incompatibili.map(function (it) { return it.cliente + ' (' + it.competenza + ')'; }).join(', ') + '.');
  }

  var nodi = costruisciNodi_(squadra, selezionati);
  var partenzaIdx = 0, rientroIdx = nodi.length - 1;
  var stopIndices = [];
  for (var i = 1; i < nodi.length - 1; i++) stopIndices.push(i);

  var matriceStima = costruisciMatriceStimata_(nodi, regole);

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

// ---------- vista "Programmazione": elenco pianificato + riempimento buchi ----------

/**
 * Elenco degli interventi già pianificati (stato Pianificato) in un intervallo di date,
 * con le indicazioni essenziali più il telefono, pensato per l'uso sul campo (contattare
 * il cliente) e per poter deselezionare una tappa già programmata.
 */
function getProgrammazione(dataInizioStr, dataFineStr) {
  var dataInizio = parseDateStr_(dataInizioStr);
  var dataFine = parseDateStr_(dataFineStr);
  if (!dataInizio || !dataFine) throw new Error('Intervallo di date non valido.');

  var squadreMap = {};
  readAll_('SQUADRE').forEach(function (s) { squadreMap[s.id] = s; });

  var righe = readAll_('INTERVENTI').filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.PIANIFICATO) return false;
    var d = parseDateStr_(i.dataPianificata);
    return d && d >= dataInizio && d <= dataFine;
  });

  righe.sort(function (a, b) {
    var diff = parseDateStr_(a.dataPianificata) - parseDateStr_(b.dataPianificata);
    if (diff !== 0) return diff;
    var an = squadreMap[a.squadraId] ? squadreMap[a.squadraId].nome : (a.squadraId || '');
    var bn = squadreMap[b.squadraId] ? squadreMap[b.squadraId].nome : (b.squadraId || '');
    if (an !== bn) return an < bn ? -1 : 1;
    return (a.ordineTappa || 0) - (b.ordineTappa || 0);
  });

  return righe.map(function (i) {
    var s = squadreMap[i.squadraId];
    return {
      id: i.id,
      _row: i._row,
      cliente: i.cliente,
      indirizzo: i.indirizzo,
      lat: i.lat,
      lng: i.lng,
      telefono: i.telefono || '',
      competenza: i.competenza,
      priorita: prioritaEffettiva_(i),
      durataMinuti: i.durataMinuti,
      ricavo: i.ricavo || 0,
      dataPianificata: i.dataPianificata,
      oraPianificata: i.oraPianificata,
      ordineTappa: i.ordineTappa,
      squadraId: i.squadraId,
      squadraNome: s ? s.nome : i.squadraId,
      colore: s ? s.colore : '#999999',
      produzioneTarget: s ? (s.produzioneTarget || 0) : 0
    };
  });
}

/**
 * Aggiunge, senza mai toccarli, interventi al percorso già confermato di una squadra/giorno: gli
 * interventi già pianificati restano fissi (stesso ordine; l'orario può solo spostarsi se un
 * nuovo intervento viene inserito prima di loro nel percorso, mai perderli né farli assegnare
 * altrove), e si prova ad aggiungere il pool di interventi ancora "Da pianificare" compatibili
 * con quel giorno e quella squadra nei buchi residui del turno (anche "di passaggio", tra due
 * tappe già fissate). Solo i nuovi candidati che non trovano posto restano "Da pianificare";
 * quelli già pianificati non vengono mai retrocessi da questa funzione.
 */
function riempiBucoGiorno(squadraId, giornoStr) {
  var regole = getRegoleMappa_();
  var squadra = assicuraIdTutti_('SQUADRE').filter(function (s) { return s.id === squadraId; })[0];
  if (!squadra) throw new Error('Squadra non trovata.');
  if (!isNum_(squadra.latPartenza) || !isNum_(squadra.lngPartenza)) {
    throw new Error('L\'indirizzo di partenza della squadra "' + squadra.nome + '" non è geocodificato. Ri-salva la squadra con un indirizzo valido.');
  }
  var giorno = parseDateStr_(giornoStr);
  if (!giorno) throw new Error('Data non valida.');
  if (!squadraDisponibileGiorno_(squadra, giorno)) {
    throw new Error('La squadra "' + squadra.nome + '" non è disponibile il ' + formatDateStr_(giorno) + ' (' + motivoIndisponibilita_(squadra, giorno) + ').');
  }
  var giornoFmt = formatDateStr_(giorno);

  var tuttiInterventi = assicuraIdTutti_('INTERVENTI');
  var giaPianificati = tuttiInterventi.filter(function (i) {
    return i.squadraId === squadraId && i.dataPianificata === giornoFmt && i.stato === STATO_INTERVENTO.PIANIFICATO;
  }).sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); });

  // A differenza della selezione manuale (che non applica alcun controllo su "Non Prima Del"), qui
  // questo campo è un vincolo rigido: un intervento richiesto per una data futura non viene
  // proposto. A differenza degli altri motivi di esclusione (finestra oraria, orario di lavoro...)
  // questo si decide PRIMA di costruire il percorso, quindi va segnalato esplicitamente sulla riga
  // — altrimenti l'utente vedrebbe l'intervento restare "Da pianificare" senza alcuna nota, come se
  // fosse un errore. La scadenza invece NON esclude più: un intervento scaduto resta pianificabile
  // (vedi prioritaEffettiva_), semplicemente con la massima priorità.
  var esclusiPerData = [];
  var disponibiliCompatibili = tuttiInterventi.filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.DA_PIANIFICARE) return false;
    if (!isNum_(i.lat) || !isNum_(i.lng)) return false;
    if (!squadraCoprCompetenza_(squadra, i)) return false;
    var dr = parseDateStr_(i.dataRichiesta);
    if (dr && giorno < dr) { esclusiPerData.push({ intervento: i, motivo: 'Non incluso nel riempimento del ' + giornoFmt + ': non disponibile prima del ' + i.dataRichiesta }); return false; }
    return true;
  });
  esclusiPerData.forEach(function (n) {
    updateRowFields_('INTERVENTI', n.intervento._row, { motivoNonPianificato: n.motivo });
  });

  var selezionati = giaPianificati.concat(disponibiliCompatibili);
  if (selezionati.length === 0) {
    return formattaAnteprima_(squadra, giorno, { tappe: [], nonIncluse: [], partenzaStimata: null, rientroStimato: null, distanzaTotaleKm: 0, tempoViaggioTotaleMinuti: 0 });
  }

  var nodi = costruisciNodi_(squadra, selezionati);
  var partenzaIdx = 0, rientroIdx = nodi.length - 1;
  var matriceStima = costruisciMatriceStimata_(nodi, regole);

  // Le tappe già pianificate (le prime giaPianificati.length di `selezionati`, quindi di `nodi`)
  // restano fisse; solo gli indici dei nuovi candidati (disponibiliCompatibili) vengono proposti
  // per il riempimento dei buchi residui — mai una ricostruzione da zero che potrebbe scartarle
  // o riordinarle per far posto ad altro.
  var ordineFissato = [];
  for (var g = 1; g <= giaPianificati.length; g++) ordineFissato.push(g);
  var indiciCandidati = [];
  for (var k = giaPianificati.length + 1; k < nodi.length - 1; k++) indiciCandidati.push(k);

  var risultato = ordineFissato.length === 0
    ? costruisciEPianificaPercorso_(squadra, nodi, indiciCandidati, matriceStima, partenzaIdx, rientroIdx, regole)
    : estendiPercorsoEsistente_(squadra, nodi, ordineFissato, indiciCandidati, matriceStima, partenzaIdx, rientroIdx, regole);

  risultato.tappe.forEach(function (t, idx) {
    updateRowFields_('INTERVENTI', t.intervento._row, {
      stato: STATO_INTERVENTO.PIANIFICATO,
      squadraId: squadra.id,
      dataPianificata: giornoFmt,
      oraPianificata: t.oraInizio,
      ordineTappa: idx + 1,
      motivoNonPianificato: ''
    });
  });
  risultato.nonIncluse.forEach(function (n) {
    updateRowFields_('INTERVENTI', n.intervento._row, {
      stato: STATO_INTERVENTO.DA_PIANIFICARE, squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: n.motivo
    });
  });

  return formattaAnteprima_(squadra, giorno, risultato);
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
  // La competenza dell'intervento va normalizzata (trim + minuscolo) esattamente come quelle
  // della squadra: senza il trim, un valore inserito/incollato con uno spazio iniziale o finale
  // (es. "Idraulico " da un copia-incolla) non risulterebbe mai compatibile con nessuna squadra,
  // pur essendo visivamente identico.
  var competenzaIntervento = String(intervento.competenza || '').trim().toLowerCase();
  return !competenzaIntervento || competenze.length === 0 || competenze.indexOf(competenzaIntervento) !== -1;
}

/**
 * true se la squadra ha una o più competenze specifiche elencate (non è "generica") E
 * l'intervento richiede esplicitamente una di quelle competenze (non è un intervento generico
 * a competenza vuota). Usato per far preferire, a un tecnico specializzato, gli interventi che
 * richiedono proprio la sua specializzazione rispetto a quelli generici — che restano comunque
 * assegnabili come riempitivo quando non c'è (più) lavoro specifico disponibile.
 */
function squadraHaCompetenzaSpecificaPer_(squadra, intervento) {
  var competenze = splitList_(squadra.competenze).map(function (c) { return c.toLowerCase(); });
  if (competenze.length === 0) return false;
  var competenzaIntervento = String(intervento.competenza || '').trim().toLowerCase();
  return !!competenzaIntervento && competenze.indexOf(competenzaIntervento) !== -1;
}

/** true se `giorno` (Date) cade in uno dei periodi di ferie/assenza della squadra. */
function squadraInFerie_(squadra, giorno) {
  if (!squadra.feriePeriodi) return false;
  var periodi;
  try { periodi = JSON.parse(squadra.feriePeriodi); } catch (e) { return false; }
  if (!Array.isArray(periodi)) return false;
  return periodi.some(function (p) {
    var dal = parseDateStr_(p.dal), al = parseDateStr_(p.al);
    return dal && al && giorno >= dal && giorno <= al;
  });
}

/**
 * true se la squadra è disponibile in quel giorno: né in un giorno settimanale di
 * indisponibilità specifico della squadra, né in un periodo di ferie/assenza.
 */
function squadraDisponibileGiorno_(squadra, giorno) {
  if (squadraInFerie_(squadra, giorno)) return false;
  var giorniIndisponibili = splitList_(squadra.giorniIndisponibili);
  if (giorniIndisponibili.indexOf(GIORNI_SETTIMANA[giorno.getDay()]) !== -1) return false;
  return true;
}

/** Messaggio descrittivo del motivo di non disponibilità (assume che squadraDisponibileGiorno_ sia già false). */
function motivoIndisponibilita_(squadra, giorno) {
  if (squadraInFerie_(squadra, giorno)) return 'In ferie/assente';
  return 'Giorno di riposo settimanale della squadra';
}

/**
 * Costruisce, per un singolo giorno con più squadre coinvolte, un ordine di visita di partenza
 * per ciascuna squadra scegliendo ad ogni passo la combinazione (squadra, intervento) col costo
 * più basso in ASSOLUTO tra tutte quelle ancora possibili — non un giro "a turno" in cui ogni
 * squadra ne prende comunque una. Questo fa sì che una squadra già vicina a un gruppo di
 * interventi tenda a vincerli in sequenza (il suo costo per il prossimo intervento dello stesso
 * gruppo resta il più basso finché non li esaurisce, concentrando il lavoro su poche squadre),
 * mentre un intervento genuinamente più vicino a un'altra squadra va a lei, anche se quest'ultima
 * è più in fondo nell'ordine di selezione: nessuna squadra monopolizza lavoro sparso su tutta
 * l'area solo perché elaborata per prima. Il costo tiene conto anche del peso dinamico del
 * ricavo verso il target di produzione della squadra e della priorità per le competenze
 * specifiche. È solo un ordine di PARTENZA: il raffinamento successivo (2-opt + riempimento in
 * qualsiasi posizione) in costruisciEPianificaPercorso_ lo perfeziona e recupera eventuali
 * interventi rimasti fuori da questo passaggio.
 */
function costruisciOrdiniGiornoCongiunti_(squadre, candidatiPerSquadra, regole) {
  var tolleranzaPausaMinuti = regole.pausaTolleranzaMinuti || 0;
  var bufferSetup = regole.bufferSetupMinuti || 10;
  var pesoRicavoBase = pesoRegola_(regole, 'pesoRicavo');
  var pesoCompetenzaSpecifica = pesoRegola_(regole, 'pesoCompetenzaSpecifica');
  var tempoViaggioMassimo = regole.tempoViaggioMassimoMinuti || 0;

  var oraInizioMin = {}, oraFineMin = {}, pausaInizioMin = {}, pausaFineMin = {};
  var cursorMin = {}, ultimoPunto = {}, ordine = {}, produzioneAccumulata = {}, viaggioAccumulato = {};
  squadre.forEach(function (s) {
    oraInizioMin[s.id] = timeToMinutes_(s.oraInizio);
    oraFineMin[s.id] = timeToMinutes_(s.oraFine);
    pausaInizioMin[s.id] = s.pausaPranzoInizio ? timeToMinutes_(s.pausaPranzoInizio) : null;
    pausaFineMin[s.id] = s.pausaPranzoFine ? timeToMinutes_(s.pausaPranzoFine) : null;
    cursorMin[s.id] = oraInizioMin[s.id];
    ultimoPunto[s.id] = { lat: s.latPartenza, lng: s.lngPartenza };
    ordine[s.id] = [];
    produzioneAccumulata[s.id] = 0;
    viaggioAccumulato[s.id] = 0;
  });

  var assegnato = {}; // interventoId -> true non appena vinto da una squadra

  function migliorMossaPer(s) {
    var candidati = (candidatiPerSquadra[s.id] || []).filter(function (i) { return !assegnato[i.id]; });
    if (!candidati.length) return null;

    var target = s.produzioneTarget || 0;
    var pesoRicavoEffettivo = pesoRicavoBase;
    if (target > 0 && produzioneAccumulata[s.id] < target) {
      var gap = (target - produzioneAccumulata[s.id]) / target;
      pesoRicavoEffettivo = pesoRicavoBase * (1 + gap * 4);
    }

    // Il tragitto dalla partenza alla prima tappa del giorno non conta come tempo di viaggio, né
    // ai fini dell'orario né del limite giornaliero (stessa regola di pianificaOrarioPercorso_,
    // la funzione di scheduling autoritativa): per la prima mossa della giornata di questa
    // squadra, quel tragitto resta un segnale di costo utile per scegliere DA QUALE zona
    // iniziare (si preferisce comunque partire da qualcosa di vicino, a parità di altri
    // fattori), ma non deve né far scartare il candidato per il limite di viaggio massimo né
    // spingere in avanti l'orario di inizio calcolato.
    var isFirstMossa = ordine[s.id].length === 0;
    var migliore = null;
    candidati.forEach(function (cand) {
      var viaggio = stimaViaggio_(ultimoPunto[s.id], cand, regole).minuti;
      if (!isFirstMossa && tempoViaggioMassimo > 0 && (viaggioAccumulato[s.id] + viaggio) > tempoViaggioMassimo) return;
      var durata = cand.durataMinuti || 60;
      var finestraInizioInt = timeToMinutes_(cand.finestraInizio || '00:00');
      var finestraFineInt = timeToMinutes_(cand.finestraFine || '23:59');
      var candidateStart = isFirstMossa
        ? Math.max(oraInizioMin[s.id], finestraInizioInt)
        : Math.max(cursorMin[s.id] + viaggio + bufferSetup, finestraInizioInt);
      var slot = trovaSlotValido_(candidateStart, durata, oraInizioMin[s.id], oraFineMin[s.id], pausaInizioMin[s.id], pausaFineMin[s.id], tolleranzaPausaMinuti);
      if (!slot || slot.fine > finestraFineInt) return; // non entra nel turno di questa squadra
      var ricavo = cand.ricavo || 0;
      var bonusCompetenza = squadraHaCompetenzaSpecificaPer_(s, cand) ? pesoCompetenzaSpecifica : 0;
      var costo = viaggio - pesoPriorita_(prioritaEffettiva_(cand), regole) * 0.05 - pesoRicavoEffettivo * ricavo - bonusCompetenza;
      if (!migliore || costo < migliore.costo) migliore = { cand: cand, costo: costo, fine: slot.fine, viaggio: isFirstMossa ? 0 : viaggio };
    });
    return migliore;
  }

  var attive = squadre.slice();
  while (attive.length > 0) {
    // Ad ogni passo si calcola la mossa migliore per CIASCUNA squadra ancora attiva, ma si
    // assegna solo quella col costo più basso in assoluto tra tutte — non una a testa: così una
    // squadra in vantaggio su un gruppo di interventi continua a vincerli finché non li esaurisce.
    var mosse = attive
      .map(function (s) { return { squadra: s, mossa: migliorMossaPer(s) }; })
      .filter(function (m) { return m.mossa !== null; });
    if (!mosse.length) break;

    mosse.sort(function (a, b) { return a.mossa.costo - b.mossa.costo; });
    var vincitore = mosse[0];
    var s = vincitore.squadra, mossa = vincitore.mossa;

    ordine[s.id].push(mossa.cand.id);
    assegnato[mossa.cand.id] = true;
    cursorMin[s.id] = mossa.fine;
    ultimoPunto[s.id] = { lat: mossa.cand.lat, lng: mossa.cand.lng };
    produzioneAccumulata[s.id] += (mossa.cand.ricavo || 0);
    viaggioAccumulato[s.id] += mossa.viaggio;

    attive = attive.filter(function (sq) {
      return (candidatiPerSquadra[sq.id] || []).some(function (i) { return !assegnato[i.id]; });
    });
  }

  return ordine; // { squadraId: [interventoId, ...] }
}

/**
 * Pianifica automaticamente, senza selezione manuale, tutti gli interventi "Da pianificare"
 * compatibili con una o più squadre su un intervallo di giorni: per ciascun giorno, le squadre
 * disponibili vengono confrontate congiuntamente (non una alla volta nell'ordine di selezione,
 * vedi costruisciOrdiniGiornoCongiunti_) per decidere a chi assegnare ciascun intervento, in modo
 * da concentrare il lavoro vicino su poche squadre senza però sottrarlo a una squadra
 * genuinamente più adatta solo perché elencata prima. Le squadre senza lavoro compatibile per un
 * giorno restano "libere".
 */
function pianificaIntervallo(squadraIds, dataInizioStr, dataFineStr) {
  if (!squadraIds || squadraIds.length === 0) throw new Error('Seleziona almeno una squadra.');
  var regole = getRegoleMappa_();
  var tutteLeSquadre = assicuraIdTutti_('SQUADRE');
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

  var tuttiInterventi = assicuraIdTutti_('INTERVENTI');
  var pool = tuttiInterventi.filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.DA_PIANIFICARE) return false;
    if (!isNum_(i.lat) || !isNum_(i.lng)) return false;
    var copertoDaAlmenoUna = squadre.some(function (s) { return squadraCoprCompetenza_(s, i); });
    if (!copertoDaAlmenoUna) return false;
    // La scadenza NON esclude un intervento dal pool (vedi prioritaEffettiva_): se già superata,
    // resta pianificabile con la massima priorità invece di restare escluso a tempo indeterminato.
    var dr = parseDateStr_(i.dataRichiesta);
    if (dr && dr > dataFine) return false;
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
    if (!giorniMap[giornoFmt]) giorniMap[giornoFmt] = [];

    // Le squadre in ferie o nel loro giorno di riposo settimanale specifico vengono escluse
    // subito da questo giorno, ma comunque riportate come "libere" con il motivo.
    var squadreDisponibiliOggi = [];
    squadre.forEach(function (squadra) {
      if (!squadraDisponibileGiorno_(squadra, giorno)) {
        giorniMap[giornoFmt].push({
          squadraId: squadra.id, squadraNome: squadra.nome, colore: squadra.colore,
          tappe: [], libera: true, motivoLibera: motivoIndisponibilita_(squadra, giorno),
          produzioneTotale: 0, produzioneTarget: squadra.produzioneTarget || 0
        });
        return;
      }
      squadreDisponibiliOggi.push(squadra);
    });

    var candidatiPerSquadra = {};
    squadreDisponibiliOggi.forEach(function (squadra) {
      candidatiPerSquadra[squadra.id] = pool.filter(function (i) {
        if (i._assegnato) return false;
        if (!squadraCoprCompetenza_(squadra, i)) return false;
        var dr = parseDateStr_(i.dataRichiesta);
        if (dr && giorno < dr) return false;
        return true;
      });
    });

    // Confronto congiunto: per questo giorno, decide a chi assegnare ciascun intervento
    // confrontando il costo tra TUTTE le squadre disponibili (non una alla volta nell'ordine di
    // selezione), così il lavoro vicino si concentra su poche squadre senza sottrarlo a una
    // squadra genuinamente più adatta solo perché elencata dopo.
    var ordiniCongiunti = costruisciOrdiniGiornoCongiunti_(squadreDisponibiliOggi, candidatiPerSquadra, regole);

    squadreDisponibiliOggi.forEach(function (squadra) {
      if (tempoScaduto) return;
      if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; return; }
      var candidatiOggi = candidatiPerSquadra[squadra.id];

      // Interventi già confermati in precedenza per questa squadra/giorno (es. da un run
      // precedente di pianificaIntervallo, o pianificati a mano): restano fissi, questa
      // funzione può solo aggiungere altri interventi nei buchi residui, mai spostarli o
      // toglierli per far posto a candidati "migliori" nel confronto di oggi.
      var giaPianificatiOggi = tuttiInterventi.filter(function (i) {
        return i.squadraId === squadra.id && i.dataPianificata === giornoFmt && i.stato === STATO_INTERVENTO.PIANIFICATO;
      }).sort(function (a, b) { return (a.ordineTappa || 0) - (b.ordineTappa || 0); });

      // Anche senza nessun candidato nuovo, se la squadra ha già un percorso per questo giorno
      // va comunque riportato (non "libera"): solo se non c'è NÉ un percorso esistente NÉ
      // candidati nuovi la squadra risulta libera per questo giorno.
      if (candidatiOggi.length === 0 && giaPianificatiOggi.length === 0) {
        giorniMap[giornoFmt].push({
          squadraId: squadra.id, squadraNome: squadra.nome, colore: squadra.colore, tappe: [], libera: true,
          produzioneTotale: 0, produzioneTarget: squadra.produzioneTarget || 0
        });
        return;
      }

      var nodi = costruisciNodi_(squadra, giaPianificatiOggi.concat(candidatiOggi));
      var partenzaIdx = 0, rientroIdx = nodi.length - 1;
      var matriceStima = costruisciMatriceStimata_(nodi, regole);

      var idxPerId = {};
      nodi.forEach(function (n, idx) { if (n.intervento) idxPerId[n.intervento.id] = idx; });
      // NB: se questa squadra non ha vinto nulla nel confronto congiunto, ordineForzato resta
      // un array vuoto (non null): deve restare "vincolante" così com'è, altrimenti
      // costruisciEPianificaPercorso_ (ordineInizialeForzato || costruisciPercorsoInserzione_(...))
      // ricadrebbe sulla costruzione indipendente dall'intero pool di candidati di questa
      // squadra, ignorando l'esito del confronto congiunto e potendo così assegnarle interventi
      // già vinti da un'altra squadra nello stesso giorno (bug: stesso intervento duplicato su
      // più squadre).
      var ordineForzato = (ordiniCongiunti[squadra.id] || [])
        .map(function (id) { return idxPerId[id]; })
        .filter(function (idx) { return idx !== undefined; });

      // Le tappe già pianificate (le prime giaPianificatiOggi.length di `nodi`) restano fisse:
      // le vincitrici del confronto congiunto di oggi vengono solo aggiunte nei buchi residui,
      // mai usate per ricostruire l'intera giornata da zero.
      var ordineFissato = [];
      for (var g = 1; g <= giaPianificatiOggi.length; g++) ordineFissato.push(g);

      var risultato;
      if (ordineFissato.length === 0) {
        var stopIndices = [];
        for (var k = 1; k < nodi.length - 1; k++) stopIndices.push(k);
        risultato = costruisciEPianificaPercorso_(squadra, nodi, stopIndices, matriceStima, partenzaIdx, rientroIdx, regole, ordineForzato);
      } else {
        risultato = estendiPercorsoEsistente_(squadra, nodi, ordineFissato, ordineForzato, matriceStima, partenzaIdx, rientroIdx, regole);
      }

      risultato.tappe.forEach(function (t, idx) {
        var originale = pool.filter(function (i) { return i.id === t.intervento.id; })[0];
        if (originale) originale._assegnato = true; // già pianificate in precedenza: non fanno parte del pool, restano semplicemente invariate
        updateRowFields_('INTERVENTI', t.intervento._row, {
          stato: STATO_INTERVENTO.PIANIFICATO,
          squadraId: squadra.id,
          dataPianificata: giornoFmt,
          oraPianificata: t.oraInizio,
          ordineTappa: idx + 1,
          motivoNonPianificato: ''
        });
      });

      var anteprimaGiorno = formattaAnteprima_(squadra, giorno, risultato);
      giorniMap[giornoFmt].push({
        squadraId: squadra.id,
        squadraNome: squadra.nome,
        colore: squadra.colore,
        tappe: anteprimaGiorno.tappe,
        partenzaStimata: anteprimaGiorno.partenzaStimata,
        rientroStimato: anteprimaGiorno.rientroStimato,
        libera: risultato.tappe.length === 0,
        produzioneTotale: anteprimaGiorno.produzioneTotale,
        produzioneTarget: anteprimaGiorno.produzioneTarget
      });
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
