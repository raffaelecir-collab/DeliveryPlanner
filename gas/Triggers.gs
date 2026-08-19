/**
 * Geocodifica automatica quando una riga viene inserita o modificata direttamente
 * sul Google Sheet (senza passare dai form della Web App). Richiede un trigger
 * installabile "on edit" perché la geocodifica chiama servizi esterni (Google
 * Maps / OpenStreetMap tramite UrlFetchApp), cosa che un trigger semplice
 * (la funzione onEdit(e) automatica) non è autorizzato a fare.
 *
 * Attivazione: dal menu "Delivery Planner" del foglio, voce "Attiva geocodifica
 * automatica su modifica foglio" (una tantum: richiede di autorizzare lo script,
 * come già avviene per inizializzaApp).
 */

var NOME_HANDLER_TRIGGER_GEOCODIFICA = 'geocodificaSuModificaSheet';

/** Crea il trigger installabile, se non è già presente (evita duplicati a esecuzioni ripetute). */
function installaTriggerGeocodifica() {
  var giaPresente = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === NOME_HANDLER_TRIGGER_GEOCODIFICA;
  });
  if (giaPresente) return false;
  ScriptApp.newTrigger(NOME_HANDLER_TRIGGER_GEOCODIFICA)
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  return true;
}

/** Wrapper per il menu del foglio: installa il trigger (se assente) e mostra un alert. */
function installaTriggerGeocodificaDaMenu() {
  var creato = installaTriggerGeocodifica();
  SpreadsheetApp.getUi().alert(creato
    ? 'Geocodifica automatica attivata: da ora, scrivendo o incollando un indirizzo direttamente sul foglio (Squadre o Interventi), le coordinate verranno calcolate in automatico.'
    : 'La geocodifica automatica era già attiva su questo foglio.');
}

var NOME_HANDLER_TRIGGER_PRIORITA_ = 'aggiornaPrioritaTriggerHandler_';

/**
 * Crea un trigger a orario (una volta al giorno, verso le 5 del mattino) che rinfresca le
 * Priorità automatiche (vedi aggiornaPrioritaAutomaticheGiornaliero_ in Interventions.gs) e
 * termina le sospensioni "Cliente chiede dopo" la cui Data "Non Prima Del" è stata raggiunta (vedi
 * terminaSospensioniPerDataRichiestaScaduta_ in Interventions.gs), se non già presente.
 * Facoltativo: inizializzaApp (Setup.gs) chiama comunque le stesse funzioni ad ogni apertura della
 * Web App, quindi questo trigger serve solo a tenerle aggiornate anche nei giorni in cui nessuno
 * apre la Web App (utile prima di una pianificazione automatica mattutina).
 */
function installaTriggerAggiornaPriorita_() {
  var giaPresente = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === NOME_HANDLER_TRIGGER_PRIORITA_;
  });
  if (giaPresente) return false;
  ScriptApp.newTrigger(NOME_HANDLER_TRIGGER_PRIORITA_)
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
  return true;
}

/** Wrapper per il menu del foglio: installa il trigger (se assente) e mostra un alert. */
function installaTriggerAggiornaPrioritaDaMenu() {
  var creato = installaTriggerAggiornaPriorita_();
  SpreadsheetApp.getUi().alert(creato
    ? 'Aggiornamento giornaliero attivato: ogni notte verso le 5 le Priorità automatiche (Tipi Attività SM01-SM05) verranno rinfrescate in base alla Scadenza, e le sospensioni "Cliente chiede dopo" la cui Data "Non Prima Del" è stata raggiunta torneranno "Da pianificare". Vengono comunque aggiornate anche ad ogni apertura della Web App, indipendentemente da questo trigger.'
    : 'Il trigger di aggiornamento giornaliero era già attivo su questo foglio.');
}

/** Funzione richiamata dal trigger a orario installato da installaTriggerAggiornaPriorita_. */
function aggiornaPrioritaTriggerHandler_() {
  aggiornaPrioritaAutomaticheGiornaliero_();
  terminaSospensioniPerDataRichiestaScaduta_();
}

/**
 * Elenco { field, colIndex, latColIndex, lngColIndex } dei campi indirizzo di uno
 * schema (quelli con mapPreview/mapCoordFields in Config.gs), con le posizioni di
 * colonna (1-based) già risolte.
 */
function campiIndirizzoConColonne_(schemaDef) {
  return schemaDef.fields
    .map(function (field, idx) { return { field: field, colIndex: idx + 1 }; })
    .filter(function (voce) { return voce.field.mapPreview && voce.field.mapCoordFields; })
    .map(function (voce) {
      var latIdx = schemaDef.fields.findIndex(function (f) { return f.key === voce.field.mapCoordFields[0]; });
      var lngIdx = schemaDef.fields.findIndex(function (f) { return f.key === voce.field.mapCoordFields[1]; });
      return { field: voce.field, colIndex: voce.colIndex, latColIndex: latIdx + 1, lngColIndex: lngIdx + 1 };
    });
}

/**
 * Trigger installabile "on edit": se la modifica ha toccato una colonna indirizzo
 * di Squadre o Interventi, geocodifica il testo corrente di quella cella e scrive
 * lat/lng nelle colonne corrispondenti, per ciascuna riga coinvolta (gestisce
 * anche incolla multi-riga/multi-cella, es. import in blocco).
 */
function geocodificaSuModificaSheet(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var nomeFoglio = sheet.getName();

  var schemaKey = null;
  if (nomeFoglio === SHEET_NAMES.SQUADRE) schemaKey = 'SQUADRE';
  else if (nomeFoglio === SHEET_NAMES.INTERVENTI) schemaKey = 'INTERVENTI';
  if (!schemaKey) return;

  var startRow = e.range.getRow();
  if (startRow < 2) return; // riga di intestazione

  var schemaDef = SCHEMA[schemaKey];
  var campiIndirizzo = campiIndirizzoConColonne_(schemaDef);
  var startCol = e.range.getColumn();
  var numCols = e.range.getNumColumns();
  var campiToccati = campiIndirizzo.filter(function (c) {
    return c.colIndex >= startCol && c.colIndex < startCol + numCols;
  });
  if (campiToccati.length === 0) return;

  var numRows = e.range.getNumRows();
  for (var r = 0; r < numRows; r++) {
    var riga = startRow + r;
    campiToccati.forEach(function (c) {
      var indirizzo = sheet.getRange(riga, c.colIndex).getValue();
      if (!indirizzo) return;
      var coord = geocodifica_(indirizzo);
      if (!coord) return; // non trovato: le celle lat/lng restano invariate, si vedrà l'errore aprendo la Web App
      sheet.getRange(riga, c.latColIndex).setValue(coord.lat);
      sheet.getRange(riga, c.lngColIndex).setValue(coord.lng);
    });
  }
}
