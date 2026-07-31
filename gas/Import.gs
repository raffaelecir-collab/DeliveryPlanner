/**
 * Import di Interventi direttamente dalla prima tab di un foglio Google esterno (il sistema di
 * tracking del cliente), il cui ID è configurato nella regola "foglioImportEsternoId" (tab
 * Regole). Si preme "Importa" nel tab Interventi della Web App: ogni riga compilata (Nome
 * Cliente + Indirizzo valorizzati, "Ods" opzionale) crea un nuovo Intervento, con l'indirizzo
 * geocodificato automaticamente come nel salvataggio manuale. Una riga con "Ods" già importato in
 * precedenza viene riconciliata con l'Intervento esistente (Codice Esterno): i campi anagrafici
 * vengono AGGIORNATI con i valori attuali del foglio esterno invece di creare un duplicato — solo
 * le righe senza Ods, prive di qualunque chiave su cui riconciliare, vengono importate una sola
 * volta e poi "congelate" (marcate direttamente sul foglio esterno). Le colonne vengono lette per
 * NOME dall'intestazione del foglio esterno (non per posizione), quindi il loro ordine lì può
 * differire da IMPORT_ESTERNO_HEADERS.
 */

/** Legge una cella per nome di colonna; '' se quella colonna non esiste nel foglio esterno. */
function valoreColonnaImport_(row, idx, header) {
  var i = idx[header];
  return (i === undefined || row[i] === null || row[i] === undefined) ? '' : row[i];
}

function normalizzaOraImport_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'HH:mm');
  var m = String(raw).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2];
}

function normalizzaDataImport_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(raw).trim();
}

function normalizzaTelefonoImport_(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') return String(Math.round(raw));
  return String(raw).trim();
}

/**
 * Nota distintiva scritta su un Intervento quando l'import lo annulla automaticamente perché il
 * suo Ods non compare più nel foglio esterno (vedi importaInterventiEsterni). Serve a
 * distinguerlo da un annullamento fatto di proposito da un operatore nella Web App: solo un
 * Intervento annullato CON questa nota può essere "resuscitato" se il suo Ods ricompare in un
 * import successivo; uno annullato manualmente resta protetto come qualunque altro Intervento
 * già preso in carico.
 */
var NOTA_ANNULLATO_AUTOMATICO_ = 'Annullato automaticamente: Ods non più presente nel tracking esterno';

/**
 * Mappa lo stato testuale del tracking esterno (libero, non standardizzato: es. "Appuntamentato
 * - yn", "Giacente - nessun blocco") sui 7 stati dell'Intervento, per parola contenuta invece che
 * per corrispondenza esatta — così regge anche valori non ancora visti, senza dover conoscere
 * l'elenco completo usato nel foglio esterno:
 * - contiene "sospes" -> uno dei 3 stati di sospensione, scelto cercando le sigle "ys"/"zp"/"zc"
 *   nello stesso testo (es. "Sospeso YS"); se "sospes" compare senza nessuna delle tre sigle
 *   riconoscibili, ricade su "Sospeso - ys" come sospensione generica (verificare/correggere a
 *   mano se il tracking esterno usa una dicitura diversa per distinguerle);
 * - contiene "annullat"/"revocat"/"disdett"/"cancellat" -> Annullato;
 * - contiene "complet"/"chius"/"eseguit"/"risolt" -> Completato;
 * - altrimenti, se "Tecnico" corrisponde a una squadra e "Data App." è valorizzata (un
 *   appuntamento è di fatto fissato, qualunque sia la dicitura esatta dello stato, es.
 *   "Appuntamentato") -> Pianificato;
 * - in ogni altro caso (es. "Giacente") -> Da pianificare.
 */
function classificaStatoEsterno_(statoEsternoRaw, squadraMatch, dataApp) {
  var s = String(statoEsternoRaw || '').trim().toLowerCase();
  if (/sospes/.test(s)) {
    if (/\bys\b/.test(s)) return STATO_INTERVENTO.SOSPESO_YS;
    if (/\bzp\b/.test(s)) return STATO_INTERVENTO.SOSPESO_ZP;
    if (/\bzc\b/.test(s)) return STATO_INTERVENTO.SOSPESO_ZC;
    return STATO_INTERVENTO.SOSPESO_YS;
  }
  if (/annullat|revocat|disdett|cancellat/.test(s)) return STATO_INTERVENTO.ANNULLATO;
  if (/complet|chius|eseguit|risolt/.test(s)) return STATO_INTERVENTO.COMPLETATO;
  if (squadraMatch && dataApp) return STATO_INTERVENTO.PIANIFICATO;
  return STATO_INTERVENTO.DA_PIANIFICARE;
}

/**
 * Legenda durata stimata per tipo di "Attività" (colonna del tracking esterno), alcune delle
 * quali graduate sull'"Importo ODS" (fornita dal cliente). Le soglie sono intervalli chiusi a
 * sinistra sul valore più basso (es. per Installazione WiComm: importo <= 280 -> 240 min,
 * 280 < importo <= 350 -> 360 min, importo > 350 -> 480 min), così ogni importo ricade in
 * esattamente una fascia, inclusi i valori esattamente sui confini indicati. Per "Integrazione
 * impianto" il terzo importo indicato dal cliente (360) non si combina in una fascia coerente
 * con gli altri due (130 e 270): assumendo un refuso, è trattata con lo stesso schema a 2 soglie
 * delle altre attività graduate (< 130 / 130-270 / > 270) — verificare e correggere se non è
 * l'intenzione.
 */
var LEGENDA_DURATA_ATTIVITA_ = {
  'installazione periferica': function () { return 120; },
  'installazione wicomm': function (importo) {
    if (importo === null) return null;
    if (importo <= 280) return 240;
    if (importo <= 350) return 360;
    return 480;
  },
  'manutenzione correttiva': function () { return 60; },
  'manutenzione ispettiva': function () { return 60; },
  'smontaggio': function () { return 45; },
  'integrazione impianto': function (importo) {
    if (importo === null) return null;
    if (importo <= 130) return 120;
    if (importo <= 270) return 240;
    return 480;
  },
  'scarico immagini': function () { return 120; },
  'installazione filare': function (importo) {
    if (importo === null) return null;
    if (importo <= 280) return 240;
    if (importo <= 350) return 360;
    return 480;
  }
};

/**
 * Durata stimata (minuti) per una riga del tracking esterno, secondo LEGENDA_DURATA_ATTIVITA_.
 * Restituisce null se l'Attività non è tra quelle note, o se richiede un Importo ODS numerico
 * che non è disponibile: in quel caso il chiamante lascia il campo durata invariato (resta il
 * default dello schema, 60 minuti).
 */
function calcolaDurataAttivitaImport_(attivitaRaw, importoOdsRaw) {
  var chiave = String(attivitaRaw || '').trim().toLowerCase();
  var calcolatore = LEGENDA_DURATA_ATTIVITA_[chiave];
  if (!calcolatore) return null;
  var importo = (importoOdsRaw === '' || importoOdsRaw === null || importoOdsRaw === undefined) ? null : parseFloat(importoOdsRaw);
  if (importo !== null && isNaN(importo)) importo = null;
  return calcolatore(importo);
}

/**
 * Apre il foglio esterno configurato in Regole (chiave "foglioImportEsternoId") e ne restituisce
 * la prima tab, con un errore chiaro se l'ID manca o se il foglio non è raggiungibile/condiviso
 * con l'account che esegue la Web App. Deve essere condiviso in SCRITTURA (non solo lettura):
 * l'import vi scrive un marcatore per riconoscere le righe già importate (vedi
 * IMPORT_ESTERNO_COLONNA_MARCATORE).
 */
function apriFoglioImportEsterno_() {
  var regole = getRegoleMappa_();
  var foglioId = regole.foglioImportEsternoId ? String(regole.foglioImportEsternoId).trim() : '';
  if (!foglioId) {
    throw new Error('Nessun ID di foglio esterno configurato: impostalo nella regola "foglioImportEsternoId" (tab Regole).');
  }
  var ssEsterno;
  try {
    ssEsterno = SpreadsheetApp.openById(foglioId);
  } catch (e) {
    throw new Error('Impossibile aprire il foglio esterno (ID "' + foglioId + '"): ' + e.message +
      '. Verifica che l\'ID sia corretto (si trova nell\'URL del foglio: docs.google.com/spreadsheets/d/ID/edit) ' +
      'e che il foglio sia condiviso in scrittura con l\'account Google che esegue la Web App (serve anche solo per ' +
      'lettura, ma l\'import scrive un marcatore sulle righe già importate per evitare duplicati).');
  }
  var sheet = ssEsterno.getSheets()[0];
  if (!sheet) throw new Error('Il foglio esterno (ID "' + foglioId + '") non ha nessuna tab.');
  return sheet;
}

/**
 * Trova la colonna marcatore (IMPORT_ESTERNO_COLONNA_MARCATORE) nell'intestazione già letta; se
 * assente, la crea (scrive l'intestazione nella prima colonna libera). Restituisce l'indice
 * 0-based della colonna, coerente con `idx`/`headerRow`.
 */
function trovaOCreaColonnaMarcatore_(sheet, headerRow, lastCol) {
  var posizione = headerRow.indexOf(IMPORT_ESTERNO_COLONNA_MARCATORE);
  if (posizione !== -1) return posizione;
  sheet.getRange(1, lastCol + 1).setValue(IMPORT_ESTERNO_COLONNA_MARCATORE);
  return lastCol; // 0-based: la nuova colonna è la (lastCol + 1)-esima in base 1
}

/**
 * Legge la prima tab del foglio esterno configurato dall'alto ed elabora ogni riga compilata
 * (Nome Cliente + Indirizzo valorizzati), geocodificando l'indirizzo (Indirizzo + Comune +
 * Provincia) come nel salvataggio manuale.
 *
 * L'elaborazione SI FERMA alla prima riga non compilata (né Ods né Nome Cliente né Indirizzo):
 * il foglio esterno tipicamente ha centinaia di righe "modello" vuote sotto i dati veri (con
 * solo la casella Urgente valorizzata a FALSE di default), che altrimenti verrebbero comunque
 * scandite una per una.
 *
 * Una riga con "Ods" viene sempre riconciliata con Interventi tramite il Codice Esterno: se
 * esiste già un Intervento con quell'Ods, i suoi campi anagrafici (cliente, indirizzo, priorità,
 * date, note, telefono, ricavo, durata) vengono AGGIORNATI con i valori attuali del foglio
 * esterno — non viene mai creata una riga duplicata. Se l'Intervento non esiste ancora, viene
 * creato. In entrambi i casi, se non ancora oltre "Da pianificare" (cioè se la Web App non lo ha
 * già preso in carico attivamente), stato/squadra/data/ora vengono anche loro aggiornati in base
 * a Stato/Tecnico/Data App.; un Intervento che la Web App ha già pianificato/completato/annullato
 * non viene mai retrocesso da un re-import, anche se il tracking esterno segna qualcos'altro.
 *
 * Una riga SENZA "Ods" non ha invece alcuna chiave su cui riconciliare un futuro re-import:
 * viene importata una sola volta (con una nota di avviso sull'intervento) e marcata direttamente
 * sul foglio esterno, nella colonna IMPORT_ESTERNO_COLONNA_MARCATORE (creata automaticamente se
 * assente): i run successivi la saltano, restando quindi "congelata" — eventuali modifiche
 * successive di quella riga sul foglio esterno non verranno più riportate, proprio perché non è
 * possibile distinguerla da una riga diversa senza un Ods.
 *
 * Lo stato (colonna "Stato" del foglio esterno, testo libero non standardizzato) viene mappato
 * sui 4 stati dell'Intervento da classificaStatoEsterno_ (vedi lì per le parole chiave
 * riconosciute). In particolare, quando risulta un appuntamento fissato (Tecnico corrisponde al
 * nome di una squadra esistente e "Data App." è valorizzata), l'intervento viene importato/
 * aggiornato come "Pianificato" per quella squadra/data/ora: da quel momento è un Intervento
 * pianificato a tutti gli effetti — compare nel tab Programmazione, si può rimuovere/completare/
 * annullare o spostare su un'altra squadra/giorno dalla mappa di selezione, esattamente come una
 * pianificazione fatta dalla Web App — con l'unica differenza che l'import NON ricalcola né
 * inserisce la tappa nel percorso ottimizzato di quella squadra/giorno: va verificato a mano (o
 * con "Riempi buco") che non si sovrapponga ad altri interventi già confermati.
 *
 * "Urgente" (TRUE/FALSE) diventa priorità Urgente/Normale; "Data Scadenza" viene riportata come
 * scadenza dell'Intervento (non è un vincolo rigido: se supera la scadenza, l'intervento non
 * viene comunque escluso dalla pianificazione automatica, ma trattato come priorità Urgente — vedi
 * prioritaEffettiva_ in RouteEngine.gs); "Data Disp." NON viene importata ("Non Prima Del" resta
 * sempre vuoto per le righe importate); "Importo ODS" diventa il Ricavo (€); la durata stimata è
 * calcolata da LEGENDA_DURATA_ATTIVITA_ in base ad "Attività" (e, per alcune attività, allo stesso
 * Importo ODS).
 *
 * Guardrail di tempo (come in pianificaIntervallo): con moltissime righe da importare in un solo
 * run, se il tempo sta per scadere si interrompe l'elaborazione delle righe restanti
 * restituendo comunque quanto già importato/aggiornato fin lì.
 *
 * Infine, un Ods che in un import precedente era presente ma che ORA non compare più tra le
 * righe compilate del foglio esterno (riga cancellata dal tracking) fa passare l'Intervento
 * corrispondente ad "Annullato" — qualunque fosse il suo stato precedente, anche se già
 * Pianificato o Completato dalla Web App (per scelta esplicita: il tracking esterno è
 * considerato la fonte di verità su quali Ods sono ancora attivi). Riguarda solo gli Interventi
 * con un Codice Esterno (mai quelli creati a mano nella Web App) e non tocca quelli già
 * Annullato. Se il foglio esterno risultasse del tutto vuoto (nessuna riga), per prudenza questo
 * passaggio non viene eseguito: un foglio vuoto è più probabilmente un problema di
 * configurazione/accesso che un'intenzione di annullare tutto.
 */
function importaInterventiEsterni() {
  richiedeAdmin_();
  var sheet = apriFoglioImportEsterno_();
  var lastRow = sheet.getLastRow();
  var risultatoVuoto = { creati: 0, aggiornati: 0, giaImportati: 0, annullatiRimossi: 0, saltati: 0, falliti: 0, dettagliSaltati: [], dettagliFalliti: [], tempoScaduto: false };
  if (lastRow < 2) return risultatoVuoto;

  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  headerRow.forEach(function (h, i) { idx[String(h).trim()] = i; });

  var mancanti = IMPORT_ESTERNO_COLONNE_OBBLIGATORIE.filter(function (c) { return idx[c] === undefined; });
  if (mancanti.length) {
    throw new Error('Il foglio esterno non ha le colonne obbligatorie attese (mancano: ' + mancanti.join(', ') +
      '). Colonne previste: ' + IMPORT_ESTERNO_HEADERS.join(', ') + '.');
  }

  // Il marcatore serve SOLO per le righe senza Ods (nessun'altra chiave possibile): quelle con
  // Ods si riconciliano invece via Codice Esterno su Interventi, quindi possono essere
  // rielaborate (e aggiornate) ad ogni run senza rischio di duplicati.
  var colonnaMarcatore = trovaOCreaColonnaMarcatore_(sheet, headerRow, lastCol);
  var marcatori = sheet.getRange(2, colonnaMarcatore + 1, lastRow - 1, 1).getValues();

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var squadrePerNome = {};
  readAll_('SQUADRE').forEach(function (s) { squadrePerNome[String(s.nome || '').trim().toLowerCase()] = s; });

  var interventiPerCodice = {};
  readAll_('INTERVENTI').forEach(function (i) { if (i.codiceEsterno) interventiPerCodice[String(i.codiceEsterno)] = i; });

  var TEMPO_MASSIMO_MS = 4.5 * 60 * 1000;
  var inizioEsecuzione = new Date().getTime();
  var tempoScaduto = false;

  var creati = 0, aggiornati = 0, giaImportati = 0, saltati = 0, falliti = 0;
  var dettagliSaltati = [], dettagliFalliti = [];

  // Ods incontrati in questo run (anche se la riga viene poi saltata per altri motivi, es.
  // indirizzo mancante): usato a fine funzione per riconoscere gli Ods che sono SPARITI dal
  // foglio esterno rispetto a un import precedente.
  var odsPresentiOra = {};

  for (var r = 0; r < values.length; r++) {
    if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; break; }
    var row = values[r];

    var odsRaw = valoreColonnaImport_(row, idx, 'Ods');
    var odsStr = (odsRaw === null || odsRaw === undefined || odsRaw === '') ? '' : String(typeof odsRaw === 'number' ? Math.round(odsRaw) : odsRaw).trim();
    var cliente = String(valoreColonnaImport_(row, idx, 'Nome Cliente') || '').trim();
    var indirizzoBase = String(valoreColonnaImport_(row, idx, 'Indirizzo') || '').trim();

    // Riga non compilata (né Ods né Cliente né Indirizzo): da qui in poi sono solo righe
    // "modello" vuote, ci si ferma senza scandire il resto del foglio.
    if (!odsStr && !cliente && !indirizzoBase) break;

    if (odsStr) odsPresentiOra[odsStr] = true;

    // Senza Ods, il marcatore è l'unico modo per riconoscere una riga già importata: se già
    // marcata, resta congelata (nessun aggiornamento possibile senza una chiave).
    if (!odsStr && marcatori[r][0]) { giaImportati++; continue; }

    if (!cliente || !indirizzoBase) {
      saltati++;
      dettagliSaltati.push('Riga ' + (r + 2) + (cliente ? ' (' + cliente + ')' : '') + ': Nome Cliente e Indirizzo sono obbligatori.');
      continue;
    }

    var esistente = odsStr ? interventiPerCodice[odsStr] : null;
    // Un Intervento annullato AUTOMATICAMENTE da un import precedente (Ods sparito) va
    // riconsiderato da zero se l'Ods ricompare — non è una decisione dell'operatore da
    // rispettare, solo una conseguenza contabile della sua assenza temporanea.
    var eraAnnullatoAutomaticamente = esistente && esistente.stato === STATO_INTERVENTO.ANNULLATO &&
      String(esistente.note || '').indexOf(NOTA_ANNULLATO_AUTOMATICO_) !== -1;
    var puoImpostarePianificazione = !esistente || esistente.stato === STATO_INTERVENTO.DA_PIANIFICARE || eraAnnullatoAutomaticamente;

    var comune = String(valoreColonnaImport_(row, idx, 'Comune') || '').trim();
    var provincia = String(valoreColonnaImport_(row, idx, 'Provincia') || '').trim();
    var indirizzoCompleto = [indirizzoBase, comune, provincia].filter(function (p) { return p; }).join(', ');

    var noteParti = [];
    var attivita = valoreColonnaImport_(row, idx, 'Attività');
    var statoEsterno = valoreColonnaImport_(row, idx, 'Stato');
    var noteSicuritalia = valoreColonnaImport_(row, idx, 'Note Sicuritalia');
    var noteSite = valoreColonnaImport_(row, idx, 'Note Site');
    if (!odsStr) noteParti.push('⚠ Importato senza Ods nel tracking esterno (non aggiornabile ai re-import successivi)');
    if (attivita) noteParti.push('Attività: ' + attivita);
    if (statoEsterno) noteParti.push('Stato tracking esterno: ' + statoEsterno);
    if (noteSicuritalia) noteParti.push('Note Sicuritalia: ' + noteSicuritalia);
    if (noteSite) noteParti.push('Note Site: ' + noteSite);

    var payload = {
      cliente: cliente,
      indirizzo: indirizzoCompleto,
      priorita: valoreColonnaImport_(row, idx, 'Urgente') === true ? PRIORITA.URGENTE : PRIORITA.NORMALE,
      // "Data Disp." (Non Prima Del) non viene importata: nel tracking esterno questo campo si è
      // rivelato inaffidabile e bloccava "Riempi buco"/pianificazione automatica su interventi in
      // realtà disponibili. La scadenza resta importata, ma non è più un vincolo rigido (vedi
      // prioritaEffettiva_ in RouteEngine.gs): se superata l'intervento diventa solo prioritario.
      scadenza: normalizzaDataImport_(valoreColonnaImport_(row, idx, 'Data Scadenza')),
      note: noteParti.join(' | '),
      telefono: normalizzaTelefonoImport_(valoreColonnaImport_(row, idx, 'Telefono'))
    };
    if (odsStr) payload.codiceEsterno = odsStr;
    if (esistente) payload.id = esistente.id;

    var importoOdsRaw = valoreColonnaImport_(row, idx, 'Importo ODS');
    var importoOds = (importoOdsRaw === '' || importoOdsRaw === null || importoOdsRaw === undefined) ? NaN : parseFloat(importoOdsRaw);
    if (!isNaN(importoOds)) payload.ricavo = importoOds;

    var durataCalcolata = calcolaDurataAttivitaImport_(attivita, importoOdsRaw);
    if (durataCalcolata !== null) payload.durataMinuti = durataCalcolata;

    if (puoImpostarePianificazione) {
      var tecnicoNome = String(valoreColonnaImport_(row, idx, 'Tecnico') || '').trim();
      var dataApp = normalizzaDataImport_(valoreColonnaImport_(row, idx, 'Data App.'));
      var squadraMatch = tecnicoNome ? squadrePerNome[tecnicoNome.toLowerCase()] : null;
      payload.stato = classificaStatoEsterno_(statoEsterno, squadraMatch, dataApp);
      if (squadraMatch && dataApp) {
        payload.squadraId = squadraMatch.id;
        payload.dataPianificata = dataApp;
        payload.oraPianificata = normalizzaOraImport_(valoreColonnaImport_(row, idx, 'Ora App.'));
      }
      // Registra anche nello storico sospensioni (visibile nel tab Interventi), non solo nel
      // campo Note generico, così è distinguibile da eventuali sospensioni inserite a mano.
      if (isStatoSospeso_(payload.stato)) {
        payload.storiaSospensioni = aggiungiStoriaSospensione_(esistente, payload.stato,
          'Importato dal tracking esterno (Stato: ' + statoEsterno + ')');
      }
    }

    try {
      salvaIntervento(payload);
    } catch (e) {
      falliti++;
      dettagliFalliti.push('Riga ' + (r + 2) + ' (' + cliente + '): ' + e.message);
      continue; // non marcata: un run successivo la ritenterà (es. dopo aver corretto l'indirizzo)
    }
    if (!odsStr) sheet.getRange(r + 2, colonnaMarcatore + 1).setValue(new Date());
    if (esistente) aggiornati++; else creati++;
  }

  // Righe scomparse dal foglio esterno rispetto a un import precedente: gli Interventi con quel
  // Codice Esterno passano ad Annullato. Solo se questo run ha visto l'intero foglio (altrimenti,
  // con un'elaborazione interrotta per tempo, righe non ancora raggiunte sembrerebbero sparite
  // per errore).
  var annullatiRimossi = 0;
  if (!tempoScaduto) {
    readAll_('INTERVENTI').forEach(function (i) {
      if (i.codiceEsterno && !odsPresentiOra[String(i.codiceEsterno)] && i.stato !== STATO_INTERVENTO.ANNULLATO) {
        var notaAggiornata = [NOTA_ANNULLATO_AUTOMATICO_, i.note].filter(function (p) { return p; }).join(' | ');
        updateRowFields_('INTERVENTI', i._row, { stato: STATO_INTERVENTO.ANNULLATO, note: notaAggiornata });
        annullatiRimossi++;
      }
    });
  }

  return {
    creati: creati,
    aggiornati: aggiornati,
    giaImportati: giaImportati,
    annullatiRimossi: annullatiRimossi,
    saltati: saltati,
    falliti: falliti,
    dettagliSaltati: dettagliSaltati,
    dettagliFalliti: dettagliFalliti,
    tempoScaduto: tempoScaduto
  };
}
