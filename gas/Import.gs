/**
 * Import di Interventi da un foglio "grezzo" (tab ImportInterventi) con le stesse colonne
 * dell'export del sistema di tracking esterno del cliente: si incollano i dati in quella tab
 * (sovrascrivendo pure le righe di esempio) e si preme "Importa" nel tab Interventi della Web
 * App. Ogni riga con "Ods" valorizzato diventa (o aggiorna, se l'Ods è già stato importato in
 * precedenza) un Intervento, con l'indirizzo geocodificato automaticamente come nel salvataggio
 * manuale.
 */

/** Crea/ripara il foglio ImportInterventi con l'intestazione attesa (senza toccare eventuali dati già incollati). */
function ensureImportSheet_() {
  var sheet = getOrCreateSheet_(SHEET_NAMES.IMPORT_ESTERNO);
  var range = sheet.getRange(1, 1, 1, IMPORT_ESTERNO_HEADERS.length);
  var current = range.getValues()[0];
  var needsWrite = false;
  for (var i = 0; i < IMPORT_ESTERNO_HEADERS.length; i++) {
    if (current[i] !== IMPORT_ESTERNO_HEADERS[i]) { needsWrite = true; break; }
  }
  if (needsWrite) {
    range.setValues([IMPORT_ESTERNO_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
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
 * Legge il foglio ImportInterventi ed esegue l'import: per ogni riga con "Ods" valorizzato
 * crea (o aggiorna, se l'Ods corrisponde a un Intervento già importato in precedenza) una
 * riga su Interventi, geocodificando l'indirizzo (Indirizzo + Comune + Provincia).
 *
 * Se "Tecnico" corrisponde al nome di una squadra esistente E "Data App." è valorizzata,
 * l'intervento viene importato già "Pianificato" per quella squadra/data/ora — senza però
 * ricalcolare né inserire la tappa nel percorso ottimizzato di quella squadra/giorno: va
 * verificato a mano (o con "Riempi buco") che non si sovrapponga ad altri interventi già
 * confermati. Un intervento già portato dalla Web App oltre "Da pianificare" (pianificato,
 * completato, annullato) non viene mai retrocesso da un successivo re-import: solo i campi
 * anagrafici (cliente, indirizzo, priorità, date, note, telefono) vengono aggiornati.
 *
 * Guardrail di tempo (come in pianificaIntervallo): con un foglio molto grande l'esecuzione
 * potrebbe avvicinarsi al limite di Apps Script: se il tempo sta per scadere, si interrompe
 * l'elaborazione delle righe restanti restituendo comunque quanto già importato, invece di
 * rischiare un errore a metà senza alcun riscontro.
 */
function importaInterventiEsterni() {
  var sheet = ensureImportSheet_();
  var lastRow = sheet.getLastRow();
  var risultatoVuoto = { creati: 0, aggiornati: 0, saltati: 0, falliti: 0, dettagliSaltati: [], dettagliFalliti: [], tempoScaduto: false };
  if (lastRow < 2) return risultatoVuoto;

  var values = sheet.getRange(2, 1, lastRow - 1, IMPORT_ESTERNO_HEADERS.length).getValues();
  var idx = {};
  IMPORT_ESTERNO_HEADERS.forEach(function (h, i) { idx[h] = i; });

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

    var odsRaw = row[idx['Ods']];
    var odsStr = (odsRaw === null || odsRaw === undefined || odsRaw === '') ? '' : String(typeof odsRaw === 'number' ? Math.round(odsRaw) : odsRaw).trim();
    var cliente = String(row[idx['Nome Cliente']] || '').trim();
    var indirizzoBase = String(row[idx['Indirizzo']] || '').trim();
    var comune = String(row[idx['Comune']] || '').trim();
    var provincia = String(row[idx['Provincia']] || '').trim();

    if (!odsStr || !cliente || !indirizzoBase) {
      saltati++;
      dettagliSaltati.push('Riga ' + (r + 2) + (cliente ? ' (' + cliente + ')' : '') + ': Ods, Nome Cliente e Indirizzo sono tutti obbligatori.');
      continue;
    }

    var indirizzoCompleto = [indirizzoBase, comune, provincia].filter(function (p) { return p; }).join(', ');
    var noteParti = [];
    if (row[idx['Attività']]) noteParti.push('Attività: ' + row[idx['Attività']]);
    if (row[idx['Stato']]) noteParti.push('Stato tracking esterno: ' + row[idx['Stato']]);
    if (row[idx['Note Sicuritalia']]) noteParti.push('Note Sicuritalia: ' + row[idx['Note Sicuritalia']]);
    if (row[idx['Note Site']]) noteParti.push('Note Site: ' + row[idx['Note Site']]);

    var esistente = interventiPerCodice[odsStr];
    var puoImpostarePianificazione = !esistente || esistente.stato === STATO_INTERVENTO.DA_PIANIFICARE;

    var payload = {
      cliente: cliente,
      indirizzo: indirizzoCompleto,
      priorita: row[idx['Urgente']] === true ? PRIORITA.URGENTE : PRIORITA.NORMALE,
      dataRichiesta: normalizzaDataImport_(row[idx['Data Disp.']]),
      scadenza: normalizzaDataImport_(row[idx['Data Scadenza']]),
      note: noteParti.join(' | '),
      telefono: normalizzaTelefonoImport_(row[idx['Telefono']]),
      codiceEsterno: odsStr
    };
    if (esistente) payload.id = esistente.id;

    if (puoImpostarePianificazione) {
      var tecnicoNome = String(row[idx['Tecnico']] || '').trim();
      var dataApp = normalizzaDataImport_(row[idx['Data App.']]);
      var squadraMatch = tecnicoNome ? squadrePerNome[tecnicoNome.toLowerCase()] : null;
      if (squadraMatch && dataApp) {
        payload.stato = STATO_INTERVENTO.PIANIFICATO;
        payload.squadraId = squadraMatch.id;
        payload.dataPianificata = dataApp;
        payload.oraPianificata = normalizzaOraImport_(row[idx['Ora App.']]);
      } else if (!esistente) {
        payload.stato = STATO_INTERVENTO.DA_PIANIFICARE;
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
