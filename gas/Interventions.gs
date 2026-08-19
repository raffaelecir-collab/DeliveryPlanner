/**
 * CRUD Interventi + utilità di filtro usate dalla dashboard.
 */

function listaInterventi(filtri) {
  var tutti = readAll_('INTERVENTI');
  // Un account Squadra vede solo i propri interventi, anche chiamando questa funzione senza
  // filtri espliciti: stessa restrizione applicata da getProgrammazioneSquadraPropria_ (TeamView.gs).
  var ctx = contestoUtenteCorrente_();
  if (ctx.ruolo === RUOLO.SQUADRA) tutti = tutti.filter(function (i) { return i.squadraId === ctx.squadraId; });
  if (!filtri) return tutti;
  return tutti.filter(function (i) {
    if (filtri.stato && i.stato !== filtri.stato) return false;
    if (filtri.squadraId && i.squadraId !== filtri.squadraId) return false;
    return true;
  });
}

/**
 * Scadenza automatica per un Tipo Attività noto (vedi GIORNI_LAVORATIVI_SCADENZA_ in Config.gs),
 * in base a Data Dispacciamento: SM01/SM02/SM04/SM05 vengono SEMPRE ricalcolati (non modificabili
 * a mano: si aggiornano da soli se cambia la Data Dispacciamento). SM03 ha solo un valore di
 * DEFAULT (dispacciamento + 90gg lavorativi), applicato solo se la Scadenza non è già stata
 * impostata (a mano o da un salvataggio precedente) — una volta presente non viene mai più
 * sovrascritto. Per qualunque altro Tipo Attività (Altro, Intervento a vuoto, non specificato)
 * restituisce null: nessun automatismo, il chiamante lascia il campo così com'è (interamente
 * manuale, come prima di questa funzione).
 */
function calcolaScadenzaAutomatica_(tipoAttivita, dataDispacciamento, scadenzaAttuale) {
  var giorni = GIORNI_LAVORATIVI_SCADENZA_[tipoAttivita];
  if (!giorni || !dataDispacciamento) return null;
  if (tipoAttivita === 'SM03') {
    return scadenzaAttuale ? null : aggiungiGiorniLavorativi_(dataDispacciamento, giorni);
  }
  return aggiungiGiorniLavorativi_(dataDispacciamento, giorni);
}

/**
 * Priorità automatica in base ai giorni lavorativi rimanenti alla Scadenza (stessa soglia usata
 * da aggiornaPrioritaAutomaticheGiornaliero_): scaduta o a 0-1 giorni lavorativi → Urgente, a 2-3
 * → Alta, a 4-7 → Normale, oltre 7 → Bassa. Si applica solo ai Tipi Attività con una regola di
 * Scadenza nota (GIORNI_LAVORATIVI_SCADENZA_: SM01-SM05) E una Scadenza effettivamente presente;
 * altrimenti restituisce null (nessun automatismo, come oggi).
 */
function calcolaPrioritaAutomatica_(tipoAttivita, scadenza) {
  if (!GIORNI_LAVORATIVI_SCADENZA_[tipoAttivita] || !scadenza) return null;
  var rimanenti = giorniLavorativiTra_(formatDateStr_(dataOggi_()), scadenza, []);
  if (rimanenti <= 1) return PRIORITA.URGENTE;
  if (rimanenti <= 3) return PRIORITA.ALTA;
  if (rimanenti <= 7) return PRIORITA.NORMALE;
  return PRIORITA.BASSA;
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
  // Data di dispacciamento: per un nuovo intervento creato a mano (mai per un import, che valorizza
  // già il campo da "Data Disp." del tracking esterno), di default è la data odierna se non
  // specificata — usata dal tab Analysis come base dei tempi di lavorazione.
  if (!esistente && !intervento.dataDispacciamento) {
    intervento.dataDispacciamento = formatDateStr_(dataOggi_());
  }

  // Scadenza automatica (vedi calcolaScadenzaAutomatica_): calcolata PRIMA della priorità, che ne
  // dipende. Usa il tipo attività/data dispacciamento EFFETTIVI (quelli sottomessi ora, o quelli
  // già salvati se questo salvataggio non li tocca).
  var tipoAttivitaEffettivo = intervento.tipoAttivita !== undefined && intervento.tipoAttivita !== ''
    ? intervento.tipoAttivita : (esistente ? esistente.tipoAttivita : '');
  var dataDispEffettiva = intervento.dataDispacciamento || (esistente && esistente.dataDispacciamento) || '';
  var scadenzaSottomessa = intervento.scadenza !== undefined ? intervento.scadenza : (esistente ? esistente.scadenza : '');
  var scadenzaAuto = calcolaScadenzaAutomatica_(tipoAttivitaEffettivo, dataDispEffettiva, scadenzaSottomessa);
  if (scadenzaAuto !== null) intervento.scadenza = scadenzaAuto;
  var scadenzaFinale = intervento.scadenza !== undefined ? intervento.scadenza : scadenzaSottomessa;

  // Priorità automatica (vedi calcolaPrioritaAutomatica_): rispetta un override manuale precedente
  // (prioritaManuale=true), a meno che questo stesso salvataggio non stia deliberatamente
  // cambiando la priorità a un valore diverso da quello già salvato (in tal caso resta un
  // override manuale, semplicemente aggiornato). Su un intervento nuovo (esistente assente) si
  // applica sempre il calcolo automatico quando idoneo, ignorando il default di schema sottomesso.
  var prioritaAuto = calcolaPrioritaAutomatica_(tipoAttivitaEffettivo, scadenzaFinale);
  if (prioritaAuto !== null) {
    var prioritaSottomessa = intervento.priorita;
    var eraManuale = !!(esistente && esistente.prioritaManuale);
    var cambiataOraAMano = esistente && prioritaSottomessa !== undefined && prioritaSottomessa !== esistente.priorita;
    if (eraManuale) {
      intervento.priorita = cambiataOraAMano ? prioritaSottomessa : esistente.priorita;
      intervento.prioritaManuale = true;
    } else if (cambiataOraAMano) {
      intervento.priorita = prioritaSottomessa;
      intervento.prioritaManuale = true;
    } else {
      intervento.priorita = prioritaAuto;
      intervento.prioritaManuale = false;
    }
  }

  // Passaggio automatico a "Pianificato": se Squadra Assegnata, Data Pianificata e Ora
  // Pianificata risultano TUTTE e tre valorizzate (che sia questo stesso salvataggio a
  // completarle, es. dall'inline edit di Squadra/Data-ora nell'elenco Interventi, o che fossero
  // già così su un intervento ancora "Da pianificare") e lo stato non è già andato oltre "Da
  // pianificare", passa a "Pianificato" — coerente con l'assegnazione manuale di una tappa senza
  // passare dalla pianificazione automatica/selezione da elenco.
  var squadraIdEffettiva = intervento.squadraId !== undefined ? intervento.squadraId : (esistente ? esistente.squadraId : '');
  var dataPianEffettiva = intervento.dataPianificata !== undefined ? intervento.dataPianificata : (esistente ? esistente.dataPianificata : '');
  var oraPianEffettiva = intervento.oraPianificata !== undefined ? intervento.oraPianificata : (esistente ? esistente.oraPianificata : '');
  var statoEffettivo = intervento.stato !== undefined ? intervento.stato : (esistente ? esistente.stato : STATO_INTERVENTO.DA_PIANIFICARE);
  if (statoEffettivo === STATO_INTERVENTO.DA_PIANIFICARE && squadraIdEffettiva && dataPianEffettiva && oraPianEffettiva) {
    intervento.stato = STATO_INTERVENTO.PIANIFICATO;
    Object.assign(intervento, campiAnalisi_(esistente, { stato: STATO_INTERVENTO.PIANIFICATO }));
  }

  // Sospensione automatica "Cliente chiede dopo": se questo salvataggio imposta o cambia la Data
  // "Non Prima Del" (dataRichiesta) a un nuovo valore non vuoto, l'intervento passa a "Sospeso -
  // zc" con una nota automatica — esattamente come sospendiIntervento (libera l'eventuale squadra/
  // data/ora già assegnate, sovrascrivendo anche un passaggio a "Pianificato" appena deciso sopra
  // in questo stesso salvataggio). Non scatta su un intervento già Completato o Annullato. Se
  // invece la Data viene svuotata mentre l'intervento è "Sospeso - zc" (per questo motivo o scelto
  // a mano), la sospensione termina subito, senza aspettare la data. La fine automatica alla data
  // raggiunta (senza toccare il campo) è invece gestita da
  // terminaSospensioniPerDataRichiestaScaduta_, richiamata da inizializzaApp e dal trigger
  // giornaliero (vedi Triggers.gs) — qui gestiamo solo i cambiamenti espliciti del campo.
  var dataRichiestaPrecedente = esistente ? (esistente.dataRichiesta || '') : '';
  var dataRichiestaSottomessa = intervento.dataRichiesta !== undefined ? (intervento.dataRichiesta || '') : dataRichiestaPrecedente;
  var notaEventoSospensioneAuto = null;
  if (intervento.dataRichiesta !== undefined && dataRichiestaSottomessa !== dataRichiestaPrecedente) {
    var statoBaseSospensioneAuto = intervento.stato !== undefined ? intervento.stato : (esistente ? esistente.stato : STATO_INTERVENTO.DA_PIANIFICARE);
    if (dataRichiestaSottomessa && statoBaseSospensioneAuto !== STATO_INTERVENTO.COMPLETATO && statoBaseSospensioneAuto !== STATO_INTERVENTO.ANNULLATO) {
      var notaSospensioneAuto = 'Cliente chiede dopo ' + dataRichiestaSottomessa;
      intervento.stato = STATO_INTERVENTO.SOSPESO_ZC;
      intervento.squadraId = ''; intervento.dataPianificata = ''; intervento.oraPianificata = '';
      intervento.ordineTappa = ''; intervento.motivoNonPianificato = ''; intervento.nonAutomatizzabileData = '';
      intervento.storiaSospensioni = aggiungiStoriaSospensione_(esistente, STATO_INTERVENTO.SOSPESO_ZC, notaSospensioneAuto);
      Object.assign(intervento, campiAnalisi_(esistente, { stato: STATO_INTERVENTO.SOSPESO_ZC }));
      notaEventoSospensioneAuto = STATO_INTERVENTO.SOSPESO_ZC + ': ' + notaSospensioneAuto;
    } else if (!dataRichiestaSottomessa && statoBaseSospensioneAuto === STATO_INTERVENTO.SOSPESO_ZC) {
      intervento.stato = STATO_INTERVENTO.DA_PIANIFICARE;
      intervento.motivoNonPianificato = '';
      intervento.storiaSospensioni = aggiungiStoriaSospensione_(esistente, STATO_INTERVENTO.DA_PIANIFICARE, 'Fine sospensione (Non Prima Del rimosso)');
      Object.assign(intervento, campiAnalisi_(esistente, { stato: STATO_INTERVENTO.DA_PIANIFICARE }));
      notaEventoSospensioneAuto = 'Fine sospensione: torna "Da pianificare" (Non Prima Del rimosso)';
    }
  }

  var salvato = upsertRow_('INTERVENTI', intervento);
  if (notaEventoSospensioneAuto) creaNotificaIntervento_(salvato, notaEventoSospensioneAuto, RUOLO.ADMIN);
  // Notifica solo la riassegnazione di squadra su un intervento GIÀ esistente (campo "Squadra
  // Assegnata" del form di Modifica): unico cambio davvero rilevante che può passare da questa
  // funzione generica (gli altri campi editabili qui, es. indirizzo/telefono/ricavo, non sono
  // eventi di ciclo di vita). Non notifica la creazione di un nuovo intervento. Non si applica se
  // il cambio di squadra è già stato notificato sopra come parte della sospensione automatica.
  if (!notaEventoSospensioneAuto && esistente && esistente.squadraId !== salvato.squadraId) {
    var nomeNuovaSquadra = salvato.squadraId ? nomeSquadraPerId_(salvato.squadraId) : null;
    var evento = !nomeNuovaSquadra ? 'Squadra assegnata rimossa'
      : (esistente.squadraId ? 'Riassegnato alla squadra "' + nomeNuovaSquadra + '"' : 'Assegnato alla squadra "' + nomeNuovaSquadra + '"');
    creaNotificaIntervento_(salvato, evento, RUOLO.ADMIN);
  }
  return salvato;
}

/**
 * Termina in automatico la sospensione "Cliente chiede dopo" (Sospeso - zc) non appena la Data
 * "Non Prima Del" (dataRichiesta) è raggiunta (oggi >= dataRichiesta): torna "Da pianificare" con
 * una voce di storico, esattamente come terminaSospensione ma senza alcun intervento manuale.
 * Riguarda solo gli Interventi "Sospeso - zc" che hanno effettivamente una Data "Non Prima Del"
 * impostata — un "Sospeso - zc" scelto a mano dal menu Sospendi senza questa data resta sospeso
 * finché non lo si termina a mano, come sempre. Chiamata sia da inizializzaApp (quindi ad ogni
 * apertura della Web App) sia da un trigger giornaliero opzionale (vedi Triggers.gs), sullo stesso
 * modello di aggiornaPrioritaAutomaticheGiornaliero_.
 */
function terminaSospensioniPerDataRichiestaScaduta_() {
  var oggi = dataOggi_();
  var terminati = 0;
  readAll_('INTERVENTI').forEach(function (i) {
    if (i.stato !== STATO_INTERVENTO.SOSPESO_ZC || !i.dataRichiesta) return;
    var dr = parseDateStr_(i.dataRichiesta);
    if (!dr || dr > oggi) return;
    var campi = {
      stato: STATO_INTERVENTO.DA_PIANIFICARE,
      motivoNonPianificato: '',
      storiaSospensioni: aggiungiStoriaSospensione_(i, STATO_INTERVENTO.DA_PIANIFICARE, 'Fine sospensione (raggiunta la data "Non Prima Del")')
    };
    updateRowFields_('INTERVENTI', i._row, Object.assign(campi, campiAnalisi_(i, campi)));
    creaNotificaIntervento_(i, 'Fine sospensione: torna "Da pianificare" (raggiunta la data "Non Prima Del")', RUOLO.ADMIN);
    terminati++;
  });
  return terminati;
}

/** Nome di una Squadra dal suo id, o null se non trovata (squadra eliminata nel frattempo). */
function nomeSquadraPerId_(squadraId) {
  var s = readAll_('SQUADRE').filter(function (sq) { return sq.id === squadraId; })[0];
  return s ? s.nome : null;
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
 * Calcola i campi "di analisi" (primoEventoData, dataPrimoPianificato, dataCompletamento) da
 * unire a un aggiornamento di un Intervento, in base allo stato esistente e a `nuoviCampi.stato`
 * (se presente): nessuno di questi viene mai sovrascritto una volta impostato, sono tutti "prima
 * volta che succede questa cosa". Da richiamare su OGNI scrittura che cambi stato, aggiunga una
 * nota/sospensione o crei un intervento già pianificato, così le metriche del tab Analysis
 * restano coerenti ovunque nel codice le tocchi (Interventions.gs, RouteEngine.gs, Import.gs).
 * Per scelta esplicita, questi campi partono vuoti sui dati storici: si popolano solo da quando
 * questa funzione esiste in poi (vedi tab Analysis per il dettaglio).
 */
function campiAnalisi_(esistente, nuoviCampi) {
  var pregresso = esistente || {};
  var out = {};
  if (!pregresso.primoEventoData) out.primoEventoData = formatDateStr_(dataOggi_());
  if (nuoviCampi && nuoviCampi.stato === STATO_INTERVENTO.PIANIFICATO && !pregresso.dataPrimoPianificato) {
    out.dataPrimoPianificato = formatDateStr_(dataOggi_());
  }
  if (nuoviCampi && nuoviCampi.stato === STATO_INTERVENTO.COMPLETATO && !pregresso.dataCompletamento) {
    out.dataCompletamento = formatDateStr_(dataOggi_());
  }
  return out;
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
  var campi = {
    stato: STATO_INTERVENTO.DA_PIANIFICARE,
    squadraId: '',
    dataPianificata: '',
    oraPianificata: '',
    ordineTappa: '',
    motivoNonPianificato: '',
    nonAutomatizzabileData: esistente.dataPianificata || ''
  };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Rimosso dalla programmazione: torna "Da pianificare"', RUOLO.ADMIN);
  return true;
}

function segnaCompletato(id, row) {
  richiedeAdmin_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  var campi = { stato: STATO_INTERVENTO.COMPLETATO };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Completato', RUOLO.ADMIN);
  return true;
}

/**
 * Invia la mail "è stato pianificato" (pulsante ✉ sulla riga tappa della Dashboard): un'unica
 * frase che avvisa il cliente/destinatario del giorno/ora pianificati. Destinatari (A/Cc) letti
 * dalle regole `emailPianificazioneSM01To`/`emailPianificazioneSM01Cc` per gli interventi di Tipo
 * Attività SM01, o `emailPianificazioneAltriTo`/`emailPianificazioneAltriCc` per qualsiasi altro
 * Tipo Attività (SM02-SM05, "Intervento a vuoto", "Altro" o nessuno scelto) — vedi tab Regole,
 * sezione dedicata in Config.gs. Se impostata, la regola `emailPianificazioneFirma` (stessa
 * sezione, unica per entrambi i gruppi) viene appesa in fondo al corpo — MailApp non include mai
 * da sola la firma configurata su Gmail. Azione ripetibile: non registra nulla nello storico
 * dell'intervento, può essere premuta più volte (es. come promemoria).
 */
function inviaMailPianificazione(id, row) {
  richiedeAdmin_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!esistente.dataPianificata || !esistente.oraPianificata) {
    throw new Error('Questo intervento non ha ancora una Data/Ora Pianificata.');
  }
  var regole = getRegoleMappa_();
  var eSM01 = esistente.tipoAttivita === 'SM01';
  var to = String((eSM01 ? regole.emailPianificazioneSM01To : regole.emailPianificazioneAltriTo) || '').trim();
  var cc = String((eSM01 ? regole.emailPianificazioneSM01Cc : regole.emailPianificazioneAltriCc) || '').trim();
  if (!to) {
    throw new Error('Nessun destinatario (A) configurato per ' + (eSM01 ? 'SM01' : 'gli altri Tipi Attività') +
      ' nel tab Regole, sezione "' + CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_ + '".');
  }
  var oggetto = 'SICURITALIA - ' + [esistente.cliente, esistente.codiceEsterno, esistente.codCliente].filter(Boolean).join(' - ');
  var corpo = 'La presente per informarvi che l\'attività in oggetto è programmata per il giorno ' +
    esistente.dataPianificata + ' alle ' + esistente.oraPianificata + '.';
  // MailApp non include mai in automatico la firma configurata nelle impostazioni di Gmail
  // dell'account che esegue la Web App: se ne serve una, va scritta esplicitamente qui (regola
  // emailPianificazioneFirma, tab Regole), appesa in fondo separata da una riga vuota.
  var firma = String(regole.emailPianificazioneFirma || '').trim();
  if (firma) corpo += '\n\n' + firma;
  var opzioni = {};
  if (cc) opzioni.cc = cc;
  MailApp.sendEmail(to, oggetto, corpo, opzioni);
  return { to: to, cc: cc };
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
 * Estrae dallo storico di un intervento gli intervalli [dal, al) in cui è rimasto sospeso (uno dei
 * 3 stati di sospensione), usati dal tab Analysis per escludere questi giorni dal conteggio dei
 * tempi di lavorazione. Considera solo le voci dello storico con uno stato (non le note libere,
 * che hanno stato vuoto): una sospensione si chiude alla prima voce successiva con uno stato
 * diverso da sospensione (tipicamente "Fine sospensione", ma anche un annullamento o un
 * completamento diretto); se non c'è mai stata una voce di chiusura, l'intervento è ancora
 * sospeso e l'intervallo resta aperto fino a oggi.
 */
function intervalliSospensione_(storiaJson) {
  var storia = [];
  try { storia = JSON.parse(storiaJson || '[]'); } catch (e) { storia = []; }
  if (!Array.isArray(storia)) storia = [];
  var eventi = storia.filter(function (s) { return s.stato; });
  var intervalli = [];
  var inizioSospensione = null;
  eventi.forEach(function (e) {
    if (isStatoSospeso_(e.stato)) {
      if (!inizioSospensione) inizioSospensione = e.data;
    } else if (inizioSospensione) {
      intervalli.push({ dal: inizioSospensione, al: e.data });
      inizioSospensione = null;
    }
  });
  if (inizioSospensione) intervalli.push({ dal: inizioSospensione, al: formatDateStr_(dataOggi_()) });
  return intervalli;
}

/**
 * Sospende un intervento: registra nota + data odierna nello storico sospensioni e imposta lo
 * stato su uno dei tre stati di sospensione. Se l'intervento era già pianificato su un percorso,
 * lo libera (come "Rimuovi") perché un intervento sospeso non deve comparire nella
 * programmazione né essere ripreso dalla pianificazione automatica finché resta in questo stato
 * (i filtri della pianificazione candidano solo "Da pianificare").
 */
function sospendiIntervento(id, row, statoSospensione, nota) {
  richiedeNonSquadra_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!isStatoSospeso_(statoSospensione)) throw new Error('Stato di sospensione non valido.');
  if (!nota) throw new Error('La nota di motivazione è obbligatoria.');
  var campi = {
    stato: statoSospensione,
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, statoSospensione, nota),
    squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: ''
  };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, statoSospensione + ': ' + troncaTesto_(nota, 80));
  return true;
}

/**
 * Termina la sospensione di un intervento: torna "Da pianificare" (lo storico resta) e registra
 * anche qui una voce di storico (stato "Da pianificare"), necessaria per sapere QUANDO è finita
 * la sospensione — senza questa voce il tab Analysis non potrebbe escludere correttamente i
 * giorni di sospensione dal conteggio dei tempi di lavorazione (vedi intervalliSospensione_).
 */
function terminaSospensione(id, row) {
  richiedeNonSquadra_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  var campi = {
    stato: STATO_INTERVENTO.DA_PIANIFICARE,
    motivoNonPianificato: '',
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, STATO_INTERVENTO.DA_PIANIFICARE, 'Fine sospensione')
  };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Fine sospensione: torna "Da pianificare"');
  return true;
}

/**
 * Annulla un intervento: registra nota + data odierna nello storico e imposta stato Annullato.
 * Come "Sospendi", se era già pianificato su un percorso viene tolto dalla programmazione (non
 * viene mai più riproposto dalla pianificazione, a differenza di una sospensione che è temporanea
 * e reversibile con "Fine sospensione"). Usata anche dall'account Cliente.
 */
function annullaIntervento(id, row, nota) {
  richiedeNonSquadra_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!nota) throw new Error('La nota di motivazione è obbligatoria.');
  var campi = {
    stato: STATO_INTERVENTO.ANNULLATO,
    storiaSospensioni: aggiungiStoriaSospensione_(esistente, STATO_INTERVENTO.ANNULLATO, nota),
    squadraId: '', dataPianificata: '', oraPianificata: '', ordineTappa: '', motivoNonPianificato: ''
  };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Annullato: ' + troncaTesto_(nota, 80));
  return true;
}

/**
 * Compone il Ricavo (€) di un Intervento come somma di una o più voci di listino con quantità
 * (vedi "Componi Ricavo" in JS.html): sostituisce sempre l'intera selezione precedente (mai
 * un'aggiunta incrementale). `voci` è un elenco di { voce, quantita }; il prezzo unitario è
 * sempre letto dal Listino AL MOMENTO del salvataggio (mai passato dal client), così un Ricavo
 * già composto resta coerente anche se il listino cambia in seguito. Se il Ricavo risultante è
 * inferiore al Prezzo importato dal tracking esterno per questo intervento, avvisa SOLO l'Admin
 * (creaNotificaSoloAdmin_) per segnalare che andrebbe adeguato.
 */
function componiRicavoIntervento(id, row, voci) {
  richiedeAdmin_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!voci || !voci.length) throw new Error('Seleziona almeno una voce di listino.');

  var listinoPerVoce = {};
  readAll_('LISTINO').forEach(function (v) { listinoPerVoce[v.voce] = v; });

  var dettaglio = [];
  var totale = 0;
  voci.forEach(function (sel) {
    var voceListino = listinoPerVoce[sel.voce];
    if (!voceListino) throw new Error('Voce di listino non trovata: "' + sel.voce + '".');
    var quantita = parseFloat(sel.quantita);
    if (!quantita || quantita <= 0) throw new Error('Quantità non valida per la voce "' + sel.voce + '".');
    var prezzoUnitario = voceListino.prezzo || 0;
    var subtotale = Math.round(prezzoUnitario * quantita * 100) / 100;
    totale += subtotale;
    dettaglio.push({ voce: sel.voce, descrizione: voceListino.descrizione || '', prezzoUnitario: prezzoUnitario, quantita: quantita, subtotale: subtotale });
  });
  totale = Math.round(totale * 100) / 100;

  var campi = { ricavo: totale, vociListino: JSON.stringify(dettaglio) };
  updateRowFields_('INTERVENTI', esistente._row, campi);

  if (typeof esistente.prezzo === 'number' && totale < esistente.prezzo) {
    creaNotificaSoloAdmin_(esistente, 'Ricavo composto (' + totale.toFixed(2) + '€) inferiore al Prezzo importato (' +
      esistente.prezzo.toFixed(2) + '€): valutare un adeguamento.');
  }
  return Object.assign({}, esistente, campi);
}

/**
 * Aggiunge una nota libera (data odierna) allo storico di un intervento, senza toccarne stato
 * o programmazione: usata dalla Dashboard (Admin) per annotare gli interventi già pianificati, e
 * dagli account Cliente/Squadra dai rispettivi tab. Un account Squadra può farlo solo sui propri
 * interventi (verificaAccessoSquadraIntervento_); Admin e Cliente restano senza restrizioni.
 */
function aggiungiNotaIntervento(id, row, nota) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (!nota) throw new Error('La nota è obbligatoria.');
  verificaAccessoSquadraIntervento_(esistente);
  var campi = { storiaSospensioni: aggiungiStoriaSospensione_(esistente, '', nota) };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Nuova nota: ' + troncaTesto_(nota, 80));
  return true;
}

/**
 * Segna come completato un intervento della PROPRIA squadra (account Squadra): a differenza di
 * segnaCompletato (Admin), qui non serve che sia "Pianificato" né che sia oggi — un tecnico può
 * recuperare e spuntare anche un intervento di un giorno passato che non aveva ancora segnato.
 */
function segnaCompletatoSquadraPropria(id, row) {
  var squadraId = contestoSquadraCorrente_();
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  if (esistente.squadraId !== squadraId) throw new Error('Operazione non consentita: intervento non assegnato alla tua squadra.');
  var campi = { stato: STATO_INTERVENTO.COMPLETATO };
  updateRowFields_('INTERVENTI', esistente._row, Object.assign(campi, campiAnalisi_(esistente, campi)));
  creaNotificaIntervento_(esistente, 'Completato dalla squadra', RUOLO.SQUADRA);
  return true;
}

/**
 * Ricalcola la Priorità automatica (vedi calcolaPrioritaAutomatica_) di tutti gli Interventi
 * idonei (Tipo Attività SM01-SM05 con una Scadenza, Priorità non forzata a mano) e riscrive solo
 * quelli il cui valore risulta cambiato: a differenza della Scadenza (fissa una volta calcolata),
 * la Priorità dipende dalla distanza odierna dalla Scadenza e quindi va rinfrescata
 * periodicamente anche SENZA che nessuno tocchi l'intervento. Chiamata sia da inizializzaApp
 * (quindi ad ogni apertura della Web App) sia da un trigger giornaliero opzionale (vedi
 * Triggers.gs), così resta aggiornata anche nei giorni in cui nessuno apre la Web App. Non tocca
 * mai gli Interventi Completati o Annullati (priorità non più rilevante), né quelli con
 * Priorità già forzata a mano (prioritaManuale).
 */
function aggiornaPrioritaAutomaticheGiornaliero_() {
  var aggiornati = 0;
  readAll_('INTERVENTI').forEach(function (i) {
    if (i.prioritaManuale) return;
    if (i.stato === STATO_INTERVENTO.COMPLETATO || i.stato === STATO_INTERVENTO.ANNULLATO) return;
    var prioritaAuto = calcolaPrioritaAutomatica_(i.tipoAttivita, i.scadenza);
    if (prioritaAuto !== null && prioritaAuto !== i.priorita) {
      updateRowFields_('INTERVENTI', i._row, { priorita: prioritaAuto });
      aggiornati++;
    }
  });
  return aggiornati;
}
