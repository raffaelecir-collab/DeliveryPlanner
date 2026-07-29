/**
 * Import di Interventi direttamente dalla prima tab di un foglio Google esterno (il sistema di
 * tracking del cliente), il cui ID è configurato nella regola "foglioImportEsternoId" (tab
 * Regole). Si preme "Importa" nel tab Interventi della Web App: ogni riga con "Ods" valorizzato
 * diventa (o aggiorna, se l'Ods è già stato importato in precedenza) un Intervento, con
 * l'indirizzo geocodificato automaticamente come nel salvataggio manuale. Le colonne vengono
 * lette per NOME dall'intestazione del foglio esterno (non per posizione), quindi il loro
 * ordine lì può differire da IMPORT_ESTERNO_HEADERS.
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
 * Mappa lo stato testuale del tracking esterno (libero, non standardizzato: es. "Appuntamentato
 * - yn", "Giacente - nessun blocco") sui 4 stati dell'Intervento, per parola contenuta invece che
 * per corrispondenza esatta — così regge anche valori non ancora visti, senza dover conoscere
 * l'elenco completo usato nel foglio esterno:
 * - contiene "annullat"/"revocat"/"disdett"/"cancellat" -> Annullato;
 * - contiene "complet"/"chius"/"eseguit"/"risolt" -> Completato;
 * - altrimenti, se "Tecnico" corrisponde a una squadra e "Data App." è valorizzata (un
 *   appuntamento è di fatto fissato, qualunque sia la dicitura esatta dello stato, es.
 *   "Appuntamentato") -> Pianificato;
 * - in ogni altro caso (es. "Giacente") -> Da pianificare.
 */
function classificaStatoEsterno_(statoEsternoRaw, squadraMatch, dataApp) {
  var s = String(statoEsternoRaw || '').trim().toLowerCase();
  if (/annullat|revocat|disdett|cancellat/.test(s)) return STATO_INTERVENTO.ANNULLATO;
  if (/complet|chius|eseguit|risolt/.test(s)) return STATO_INTERVENTO.COMPLETATO;
  if (squadraMatch && dataApp) return STATO_INTERVENTO.PIANIFICATO;
  return STATO_INTERVENTO.DA_PIANIFICARE;
}

/**
 * Apre il foglio esterno configurato in Regole (chiave "foglioImportEsternoId") e ne restituisce
 * la prima tab, con un errore chiaro se l'ID manca o se il foglio non è raggiungibile/condiviso
 * con l'account che esegue la Web App.
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
      'e che il foglio sia condiviso almeno in lettura con l\'account Google che esegue la Web App.');
  }
  var sheet = ssEsterno.getSheets()[0];
  if (!sheet) throw new Error('Il foglio esterno (ID "' + foglioId + '") non ha nessuna tab.');
  return sheet;
}

/**
 * Legge la prima tab del foglio esterno configurato ed esegue l'import: per ogni riga con "Ods"
 * valorizzato crea (o aggiorna, se l'Ods corrisponde a un Intervento già importato in
 * precedenza) una riga su Interventi, geocodificando l'indirizzo (Indirizzo + Comune +
 * Provincia).
 *
 * Lo stato (colonna "Stato" del foglio esterno, testo libero non standardizzato) viene mappato
 * sui 4 stati dell'Intervento da classificaStatoEsterno_ (vedi lì per le parole chiave
 * riconosciute). In particolare, quando risulta un appuntamento fissato (Tecnico corrisponde al
 * nome di una squadra esistente e "Data App." è valorizzata), l'intervento viene importato già
 * "Pianificato" per quella squadra/data/ora: da quel momento è un Intervento pianificato a
 * tutti gli effetti — compare nel tab Programmazione, si può rimuovere/completare/annullare o
 * spostare su un'altra squadra/giorno dalla mappa di selezione, esattamente come una
 * pianificazione fatta dalla Web App — con l'unica differenza che l'import NON ricalcola né
 * inserisce la tappa nel percorso ottimizzato di quella squadra/giorno: va verificato a mano (o
 * con "Riempi buco") che non si sovrapponga ad altri interventi già confermati. Un intervento
 * già portato dalla Web App oltre "Da pianificare" (pianificato, completato, annullato) non
 * viene mai retrocesso da un successivo re-import: solo i campi anagrafici (cliente, indirizzo,
 * priorità, date, note, telefono) vengono aggiornati.
 *
 * Guardrail di tempo (come in pianificaIntervallo): con un foglio molto grande l'esecuzione
 * potrebbe avvicinarsi al limite di Apps Script: se il tempo sta per scadere, si interrompe
 * l'elaborazione delle righe restanti restituendo comunque quanto già importato, invece di
 * rischiare un errore a metà senza alcun riscontro.
 */
function importaInterventiEsterni() {
  var sheet = apriFoglioImportEsterno_();
  var lastRow = sheet.getLastRow();
  var risultatoVuoto = { creati: 0, aggiornati: 0, saltati: 0, falliti: 0, dettagliSaltati: [], dettagliFalliti: [], tempoScaduto: false };
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

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var squadrePerNome = {};
  readAll_('SQUADRE').forEach(function (s) { squadrePerNome[String(s.nome || '').trim().toLowerCase()] = s; });

  var interventiPerCodice = {};
  readAll_('INTERVENTI').forEach(function (i) { if (i.codiceEsterno) interventiPerCodice[String(i.codiceEsterno)] = i; });

  var TEMPO_MASSIMO_MS = 4.5 * 60 * 1000;
  var inizioEsecuzione = new Date().getTime();
  var tempoScaduto = false;

  var creati = 0, aggiornati = 0, saltati = 0, falliti = 0;
  var dettagliSaltati = [], dettagliFalliti = [];

  for (var r = 0; r < values.length; r++) {
    if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; break; }
    var row = values[r];
    var isEmpty = row.every(function (v) { return v === '' || v === null || v === undefined; });
    if (isEmpty) continue;

    var odsRaw = valoreColonnaImport_(row, idx, 'Ods');
    var odsStr = (odsRaw === null || odsRaw === undefined || odsRaw === '') ? '' : String(typeof odsRaw === 'number' ? Math.round(odsRaw) : odsRaw).trim();
    var cliente = String(valoreColonnaImport_(row, idx, 'Nome Cliente') || '').trim();
    var indirizzoBase = String(valoreColonnaImport_(row, idx, 'Indirizzo') || '').trim();
    var comune = String(valoreColonnaImport_(row, idx, 'Comune') || '').trim();
    var provincia = String(valoreColonnaImport_(row, idx, 'Provincia') || '').trim();

    if (!odsStr || !cliente || !indirizzoBase) {
      saltati++;
      dettagliSaltati.push('Riga ' + (r + 2) + (cliente ? ' (' + cliente + ')' : '') + ': Ods, Nome Cliente e Indirizzo sono tutti obbligatori.');
      continue;
    }

    var indirizzoCompleto = [indirizzoBase, comune, provincia].filter(function (p) { return p; }).join(', ');
    var noteParti = [];
    var attivita = valoreColonnaImport_(row, idx, 'Attività');
    var statoEsterno = valoreColonnaImport_(row, idx, 'Stato');
    var noteSicuritalia = valoreColonnaImport_(row, idx, 'Note Sicuritalia');
    var noteSite = valoreColonnaImport_(row, idx, 'Note Site');
    if (attivita) noteParti.push('Attività: ' + attivita);
    if (statoEsterno) noteParti.push('Stato tracking esterno: ' + statoEsterno);
    if (noteSicuritalia) noteParti.push('Note Sicuritalia: ' + noteSicuritalia);
    if (noteSite) noteParti.push('Note Site: ' + noteSite);

    var esistente = interventiPerCodice[odsStr];
    var puoImpostarePianificazione = !esistente || esistente.stato === STATO_INTERVENTO.DA_PIANIFICARE;

    var payload = {
      cliente: cliente,
      indirizzo: indirizzoCompleto,
      priorita: valoreColonnaImport_(row, idx, 'Urgente') === true ? PRIORITA.URGENTE : PRIORITA.NORMALE,
      dataRichiesta: normalizzaDataImport_(valoreColonnaImport_(row, idx, 'Data Disp.')),
      scadenza: normalizzaDataImport_(valoreColonnaImport_(row, idx, 'Data Scadenza')),
      note: noteParti.join(' | '),
      telefono: normalizzaTelefonoImport_(valoreColonnaImport_(row, idx, 'Telefono')),
      codiceEsterno: odsStr
    };
    if (esistente) payload.id = esistente.id;

    if (puoImpostarePianificazione) {
      var tecnicoNome = String(valoreColonnaImport_(row, idx, 'Tecnico') || '').trim();
      var dataApp = normalizzaDataImport_(valoreColonnaImport_(row, idx, 'Data App.'));
      var squadraMatch = tecnicoNome ? squadrePerNome[tecnicoNome.toLowerCase()] : null;
      // Lo stato (Pianificato/Completato/Annullato/Da pianificare) viene dedotto sia dal testo
      // di "Stato" sia da Tecnico/Data App.; se un tecnico e una data risultano comunque
      // riconosciuti li riportiamo sempre (squadra/data/ora), indipendentemente dallo stato
      // risultante, così anche un intervento importato come Completato/Annullato mantiene
      // traccia di chi e quando l'ha eseguito — esattamente come fanno "Completa"/"Annulla"
      // nella Web App, che non toccano mai squadra/data/ora già presenti.
      payload.stato = classificaStatoEsterno_(statoEsterno, squadraMatch, dataApp);
      if (squadraMatch && dataApp) {
        payload.squadraId = squadraMatch.id;
        payload.dataPianificata = dataApp;
        payload.oraPianificata = normalizzaOraImport_(valoreColonnaImport_(row, idx, 'Ora App.'));
      }
    }

    try {
      salvaIntervento(payload);
    } catch (e) {
      falliti++;
      dettagliFalliti.push('Riga ' + (r + 2) + ' (' + cliente + '): ' + e.message);
      continue;
    }
    if (esistente) aggiornati++; else creati++;
  }

  return { creati: creati, aggiornati: aggiornati, saltati: saltati, falliti: falliti, dettagliSaltati: dettagliSaltati, dettagliFalliti: dettagliFalliti, tempoScaduto: tempoScaduto };
}
