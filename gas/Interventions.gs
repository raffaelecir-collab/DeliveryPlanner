/**
 * CRUD Interventi + utilità di filtro usate dalla dashboard.
 */

function listaInterventi(filtri) {
  var tutti = readAll_('INTERVENTI');
  if (!filtri) return tutti;
  return tutti.filter(function (i) {
    if (filtri.stato && i.stato !== filtri.stato) return false;
    if (filtri.squadraId && i.squadraId !== filtri.squadraId) return false;
    return true;
  });
}

function salvaIntervento(intervento) {
  richiedeAdmin_();
  if (!intervento.cliente) throw new Error('Il cliente è obbligatorio.');
  if (!intervento.indirizzo) throw new Error('L\'indirizzo è obbligatorio.');

  var esistente = intervento.id
    ? readAll_('INTERVENTI').filter(function (i) { return i.id === intervento.id; })[0]
    : (intervento._row ? readAll_('INTERVENTI').filter(function (i) { return i._row === intervento._row; })[0] : null);
  // Ri-geocodifica non solo se l'indirizzo è cambiato, ma anche se le coordinate sono
  // ancora mancanti (riga creata a mano, o salvata prima che esistesse la geocodifica).
  if (!esistente || esistente.indirizzo !== intervento.indirizzo || !isNum_(esistente.lat) || !isNum_(esistente.lng)) {
    var coord = geocodifica_(intervento.indirizzo);
    if (!coord) throw new Error('Indirizzo non trovato (provato sia con Google Maps sia con OpenStreetMap): "' + intervento.indirizzo + '". Verifica che sia corretto e completo (via, numero civico, città).');
    intervento.lat = coord.lat;
    intervento.lng = coord.lng;
  }

  return upsertRow_('INTERVENTI', intervento);
}

/** Trova una riga per id, con fallback sul numero di riga fisica se l'id è assente (riga inserita a mano). */
function trovaInterventoPerIdORiga_(id, row) {
  var tutti = readAll_('INTERVENTI');
  var trovato = id ? tutti.filter(function (i) { return i.id === id; })[0] : null;
  if (!trovato && row) trovato = tutti.filter(function (i) { return i._row === row; })[0];
  return trovato;
}

function eliminaIntervento(id, row) {
  richiedeAdmin_();
  return deleteRow_('INTERVENTI', id, row);
}

/**
 * Riporta un intervento allo stato "Da pianificare", liberando squadra/data/ora assegnate (senza
 * ripianificarlo automaticamente: è compito dell'utente farlo, a mano o con un successivo "Riempi
 * buco" esplicito). Registra in nonAutomatizzabileData la data da cui è stato rimosso: finché
 * quel campo resta valorizzato, gli strumenti automatici (Riempi buco, pianificazione su
 * intervallo) non lo riproporranno per quella stessa data — resta comunque selezionabile a mano,
 * anche per la stessa data. Il vincolo si azzera da solo alla prossima ripianificazione (vedi
 * salvaIntervento, confermaPercorso, riempiBucoGiorno, pianificaIntervallo).
 */
function ripianificaIntervento(id, row) {
  richiedeAdmin_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, {
    stato: STATO_INTERVENTO.DA_PIANIFICARE,
    squadraId: '',
    dataPianificata: '',
    oraPianificata: '',
    ordineTappa: '',
    motivoNonPianificato: '',
    nonAutomatizzabileData: esistente.dataPianificata || ''
  });
  return true;
}

function segnaCompletato(id, row) {
  richiedeAdmin_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.COMPLETATO });
  return true;
}

/**
 * Aggiunge una voce (data odierna, stato, nota, autore) allo storico sospensioni/note esistente di
 * un intervento. L'autore (Admin/Cliente) è preso dal ruolo dell'account che sta effettivamente
 * chiamando in quel momento, così ogni voce dello storico è sempre attribuita correttamente
 * (utile per far leggere all'Admin le note inserite dall'account Cliente, e viceversa).
 */
function aggiungiStoriaSospensione_(esistente, stato, nota) {
  var storia = [];
  try { storia = JSON.parse((esistente && esistente.storiaSospensioni) || '[]'); } catch (e) { storia = []; }
  if (!Array.isArray(storia)) storia = [];
  storia.push({ data: formatDateStr_(dataOggi_()), stato: stato, nota: nota || '', autore: ruoloUtenteCorrente_() });
  return JSON.stringify(storia);
}

/**
 * Sospende un intervento: registra nota + data odierna nello storico sospensioni e imposta lo
 * stato su uno dei tre stati di sospensione. Se l'intervento era già pianificato su un percorso,
 * lo libera (come "Rimuovi") perché un intervento sospeso non deve comparire nella
 * programmazione né essere ripreso dalla pianificazione automatica finché resta in questo stato
 * (i filtri della pianificazione candidano solo "Da pianificare").
 */
function sospendiIntervento(id, row, statoSospensione, nota) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!isStatoSospeso_(statoSospensione)) throw new Error('Stato di sospensione non valido.');
  if (!nota) throw new Error('La nota di motivazione è obbligatoria.');
  updateRowFields_('INTERVENTI', esistente._row, {
    stato: statoSospensione,
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, statoSospensione, nota),
    squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: ''
  });
  return true;
}

/** Termina la sospensione di un intervento: torna "Da pianificare" (lo storico resta). */
function terminaSospensione(id, row) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.DA_PIANIFICARE, motivoNonPianificato: '' });
  return true;
}

/**
 * Annulla un intervento: registra nota + data odierna nello storico e imposta stato Annullato.
 * Come "Sospendi", se era già pianificato su un percorso viene tolto dalla programmazione (non
 * viene mai più riproposto dalla pianificazione, a differenza di una sospensione che è temporanea
 * e reversibile con "Fine sospensione"). Usata anche dall'account Cliente.
 */
function annullaIntervento(id, row, nota) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!nota) throw new Error('La nota di motivazione è obbligatoria.');
  updateRowFields_('INTERVENTI', esistente._row, {
    stato: STATO_INTERVENTO.ANNULLATO,
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, STATO_INTERVENTO.ANNULLATO, nota),
    squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: ''
  });
  return true;
}

/**
 * Aggiunge una nota libera (data odierna) allo storico di un intervento, senza toccarne stato
 * o programmazione: usata dalla Dashboard per annotare gli interventi già pianificati.
 */
function aggiungiNotaIntervento(id, row, nota) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!nota) throw new Error('La nota è obbligatoria.');
  updateRowFields_('INTERVENTI', esistente._row, {
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, '', nota)
  });
  return true;
}
