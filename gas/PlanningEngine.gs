/**
 * Motore di pianificazione intelligente.
 *
 * Per ciascun giorno lavorativo dell'orizzonte selezionato e per ciascuna squadra attiva,
 * assegna in modo greedy gli interventi "Da pianificare" rispettando, in ordine:
 *  1) Copertura territoriale e competenza (una squadra può prendere solo interventi
 *     nella propria zona e con la competenza richiesta, se specificata).
 *  2) Priorità/urgenza e finestra oraria del cliente (un intervento Urgente con
 *     scadenza vicina viene sempre preferito a uno a bassa priorità).
 *  3) Clustering geografico: a parità di priorità viene scelto l'intervento più
 *     vicino all'ultima tappa della squadra, per ridurre gli spostamenti (nearest-neighbour).
 *  4) Capacità giornaliera della squadra (minuti di lavoro disponibili e orario di lavoro).
 *
 * Gli interventi che non trovano posto nell'orizzonte vengono marcati
 * "Non pianificabile" con un motivo, così da essere visibili e gestibili manualmente.
 */

function timeToMinutes_(hhmm) {
  if (!hhmm) return 0;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10) || 0;
  var m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function minutesToTime_(mins) {
  var h = Math.floor(mins / 60) % 24;
  var m = Math.round(mins % 60);
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function parseDateStr_(str) {
  if (!str) return null;
  if (str instanceof Date) return new Date(str.getFullYear(), str.getMonth(), str.getDate());
  var parts = String(str).split('/');
  if (parts.length !== 3) return null;
  var d = parseInt(parts[0], 10), mo = parseInt(parts[1], 10) - 1, y = parseInt(parts[2], 10);
  return new Date(y, mo, d);
}

function formatDateStr_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function dayOfWeekAbbrev_(date) {
  return GIORNI_SETTIMANA[date.getDay()];
}

function addDays_(date, n) {
  return new Date(date.getTime() + n * 24 * 3600 * 1000);
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

function splitList_(str) {
  return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function isNum_(v) {
  return typeof v === 'number' && !isNaN(v);
}

function getLocation_(item, zoneMap) {
  if (isNum_(item.lat) && isNum_(item.lng)) return { lat: item.lat, lng: item.lng };
  var zona = zoneMap[String(item.zona || '').toLowerCase()];
  if (zona && isNum_(zona.lat) && isNum_(zona.lng)) return { lat: zona.lat, lng: zona.lng };
  return null;
}

function stimaMinutiViaggio_(da, a, regole) {
  var buffer = regole.bufferViaggioMinuti || 15;
  if (da && a && isNum_(da.lat) && isNum_(da.lng) && isNum_(a.lat) && isNum_(a.lng)) {
    var distKm = haversineKm_(da.lat, da.lng, a.lat, a.lng);
    var velocita = regole.velocitaMediaKmH || 30;
    var minuti = (distKm / velocita) * 60;
    return Math.max(5, Math.round(minuti));
  }
  return buffer;
}

function pesoPriorita_(priorita, regole) {
  switch (priorita) {
    case PRIORITA.URGENTE: return regole.pesoPrioritaUrgente || 1000;
    case PRIORITA.ALTA: return regole.pesoPrioritaAlta || 100;
    case PRIORITA.BASSA: return regole.pesoPrioritaBassa || 1;
    default: return regole.pesoPrioritaNormale || 10;
  }
}

function teamCoversIntervento_(team, intervento) {
  var zone = splitList_(team.zoneCoperte);
  var competenze = splitList_(team.competenze);
  var zonaOk = zone.length === 0 || zone.some(function (z) { return z.toLowerCase() === String(intervento.zona || '').toLowerCase(); });
  var compOk = !intervento.competenza || competenze.length === 0 ||
    competenze.some(function (c) { return c.toLowerCase() === String(intervento.competenza || '').toLowerCase(); });
  return zonaOk && compOk;
}

function rispettaFinestraData_(intervento, day) {
  var dr = parseDateStr_(intervento.dataRichiesta);
  if (dr && day < dr) return false;
  var sc = parseDateStr_(intervento.scadenza);
  if (sc && day > sc) return false;
  return true;
}

/** Pianifica un singolo giorno per una singola squadra sul pool condiviso di candidati. */
function pianificaGiornoPerSquadra_(team, day, pool, regole, zoneMap) {
  var cursor = timeToMinutes_(team.oraInizio);
  var fineGiornata = timeToMinutes_(team.oraFine);
  var capacitaResidua = team.capacitaMinuti || (fineGiornata - cursor);
  var minutiLavorati = 0;
  var currentLocation = (isNum_(team.latBase) && isNum_(team.lngBase)) ? { lat: team.latBase, lng: team.lngBase } : null;
  var assegnazioni = [];

  while (true) {
    var eligibili = pool.filter(function (c) {
      return !c._assegnato && teamCoversIntervento_(team, c) && rispettaFinestraData_(c, day);
    });
    if (eligibili.length === 0) break;

    var fattibili = [];
    eligibili.forEach(function (c) {
      var locazione = getLocation_(c, zoneMap);
      var travel = stimaMinutiViaggio_(currentLocation, locazione, regole);
      var finestraInizioMin = timeToMinutes_(c.finestraInizio || '00:00');
      var finestraFineMin = timeToMinutes_(c.finestraFine || '23:59');
      var durata = c.durataMinuti || 60;
      var start = Math.max(cursor + travel, finestraInizioMin);
      var finish = start + durata;
      if (finish <= finestraFineMin && finish <= fineGiornata && (minutiLavorati + durata) <= capacitaResidua) {
        fattibili.push({ c: c, travel: travel, start: start, finish: finish, finestraFineMin: finestraFineMin, peso: pesoPriorita_(c.priorita, regole) });
      }
    });
    if (fattibili.length === 0) break;

    fattibili.sort(function (x, y) {
      if (y.peso !== x.peso) return y.peso - x.peso;
      if (x.travel !== y.travel) return x.travel - y.travel;
      return x.finestraFineMin - y.finestraFineMin;
    });

    var scelto = fattibili[0];
    scelto.c._assegnato = true;
    assegnazioni.push({
      intervento: scelto.c,
      squadraId: team.id,
      data: formatDateStr_(day),
      oraInizio: minutesToTime_(scelto.start),
      oraFine: minutesToTime_(scelto.finish)
    });
    cursor = scelto.finish;
    minutiLavorati += (scelto.c.durataMinuti || 60);
    currentLocation = getLocation_(scelto.c, zoneMap) || currentLocation;
  }

  return assegnazioni;
}

/**
 * Esegue la pianificazione su tutti gli interventi "Da pianificare" nell'orizzonte richiesto.
 * @param {{dataInizio:string, dataFine:string}} params date in formato dd/MM/yyyy (opzionali)
 */
function eseguiPianificazione(params) {
  params = params || {};
  var regole = getRegoleMappa_();
  var oggi = new Date();
  var dataInizio = params.dataInizio ? parseDateStr_(params.dataInizio) : new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate());
  var orizzonteGiorni = regole.orizzonteGiorni || 7;
  var dataFine = params.dataFine ? parseDateStr_(params.dataFine) : addDays_(dataInizio, orizzonteGiorni - 1);
  var giorniLavorativi = splitList_(regole.giorniLavorativi || 'Lun,Mar,Mer,Gio,Ven');

  var squadre = readAll_('SQUADRE').filter(function (s) { return s.attiva; });
  var zone = readAll_('ZONE');
  var zoneMap = {};
  zone.forEach(function (z) { zoneMap[String(z.nome).toLowerCase()] = z; });

  var tuttiGliInterventi = readAll_('INTERVENTI');
  var pool = tuttiGliInterventi.filter(function (i) {
    if (i.stato !== STATO_INTERVENTO.DA_PIANIFICARE) return false;
    var dr = parseDateStr_(i.dataRichiesta);
    if (dr && dr > dataFine) return false; // fuori orizzonte, non ancora attuale: non toccare
    return true;
  });

  var giorni = [];
  var cursorDay = dataInizio;
  while (cursorDay <= dataFine) {
    if (giorniLavorativi.length === 0 || giorniLavorativi.indexOf(dayOfWeekAbbrev_(cursorDay)) !== -1) {
      giorni.push(cursorDay);
    }
    cursorDay = addDays_(cursorDay, 1);
  }

  var pianoPerGiornoSquadra = [];
  giorni.forEach(function (day) {
    squadre.forEach(function (team) {
      var assegnazioni = pianificaGiornoPerSquadra_(team, day, pool, regole, zoneMap);
      if (assegnazioni.length > 0) {
        pianoPerGiornoSquadra.push({ data: formatDateStr_(day), squadraId: team.id, squadraNome: team.nome, tappe: assegnazioni });
      }
    });
  });

  // Scrittura sul foglio degli interventi pianificati
  var pianificatiCount = 0;
  pianoPerGiornoSquadra.forEach(function (blocco) {
    blocco.tappe.forEach(function (tappa) {
      updateRowFields_('INTERVENTI', tappa.intervento._row, {
        stato: STATO_INTERVENTO.PIANIFICATO,
        squadraId: tappa.squadraId,
        dataPianificata: tappa.data,
        oraPianificata: tappa.oraInizio,
        motivoNonPianificato: ''
      });
      pianificatiCount++;
    });
  });

  // Interventi rimasti non assegnati nell'orizzonte: marcati come "Non pianificabile" con motivo
  var nonPianificabili = [];
  pool.filter(function (c) { return !c._assegnato; }).forEach(function (c) {
    var teamsEligible = squadre.filter(function (t) { return teamCoversIntervento_(t, c); });
    var motivo = teamsEligible.length === 0
      ? 'Nessuna squadra attiva copre la zona/competenza richiesta'
      : 'Finestra oraria o capacità squadre insufficiente nell\'orizzonte selezionato (' + formatDateStr_(dataInizio) + ' - ' + formatDateStr_(dataFine) + ')';
    updateRowFields_('INTERVENTI', c._row, {
      stato: STATO_INTERVENTO.NON_PIANIFICABILE,
      motivoNonPianificato: motivo
    });
    nonPianificabili.push({ id: c.id, cliente: c.cliente, motivo: motivo });
  });

  var riepilogo = {
    dataInizio: formatDateStr_(dataInizio),
    dataFine: formatDateStr_(dataFine),
    pianificati: pianificatiCount,
    nonPianificabili: nonPianificabili.length,
    dettagliNonPianificabili: nonPianificabili,
    piano: pianoPerGiornoSquadra
  };

  upsertRow_('LOG', {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    utente: Session.getActiveUser().getEmail() || 'sconosciuto',
    pianificati: pianificatiCount,
    nonPianificabili: nonPianificabili.length,
    dettagli: JSON.stringify({ dataInizio: riepilogo.dataInizio, dataFine: riepilogo.dataFine, nonPianificabili: nonPianificabili })
  });

  return riepilogo;
}

/** Restituisce il piano già salvato sul foglio Interventi, raggruppato per giorno e squadra. */
function getPianificazione(dataInizioStr, dataFineStr) {
  var interventi = readAll_('INTERVENTI').filter(function (i) { return i.stato === STATO_INTERVENTO.PIANIFICATO; });
  if (dataInizioStr) {
    var dInizio = parseDateStr_(dataInizioStr);
    interventi = interventi.filter(function (i) { var d = parseDateStr_(i.dataPianificata); return d && d >= dInizio; });
  }
  if (dataFineStr) {
    var dFine = parseDateStr_(dataFineStr);
    interventi = interventi.filter(function (i) { var d = parseDateStr_(i.dataPianificata); return d && d <= dFine; });
  }
  var squadre = readAll_('SQUADRE');
  var squadreMap = {};
  squadre.forEach(function (s) { squadreMap[s.id] = s; });

  var gruppi = {};
  interventi.forEach(function (i) {
    var chiave = i.dataPianificata + '|' + i.squadraId;
    if (!gruppi[chiave]) {
      gruppi[chiave] = {
        data: i.dataPianificata,
        squadraId: i.squadraId,
        squadraNome: squadreMap[i.squadraId] ? squadreMap[i.squadraId].nome : i.squadraId,
        colore: squadreMap[i.squadraId] ? squadreMap[i.squadraId].colore : '#999999',
        tappe: []
      };
    }
    gruppi[chiave].tappe.push(i);
  });

  var risultato = Object.keys(gruppi).map(function (k) { return gruppi[k]; });
  risultato.forEach(function (g) {
    g.tappe.sort(function (a, b) { return timeToMinutes_(a.oraPianificata) - timeToMinutes_(b.oraPianificata); });
  });
  risultato.sort(function (a, b) {
    var da = parseDateStr_(a.data), db = parseDateStr_(b.data);
    if (da.getTime() !== db.getTime()) return da - db;
    return a.squadraNome.localeCompare(b.squadraNome);
  });
  return risultato;
}
