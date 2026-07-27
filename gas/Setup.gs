/**
 * Inizializzazione dello spreadsheet: crea i fogli con le intestazioni corrette,
 * popola le regole di default e (opzionalmente) dati di esempio.
 * Eseguire una sola volta la funzione `inizializzaApp` dal menu personalizzato
 * o dall'editor Apps Script dopo aver collegato lo script a un Google Sheet.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Delivery Planner')
    .addItem('Inizializza / Ripara struttura fogli', 'inizializzaAppDaMenu')
    .addItem('Carica dati di esempio', 'caricaDatiDiEsempioDaMenu')
    .addItem('Apri Web App', 'mostraUrlWebApp')
    .addToUi();
}

/**
 * Crea/ripara la struttura dei fogli. Non mostra alcun dialogo: viene chiamata
 * anche dalla Web App (getBootstrapData) dove SpreadsheetApp.getUi() non è
 * disponibile, quindi deve restare priva di interazioni con l'interfaccia dello
 * spreadsheet.
 */
function inizializzaApp() {
  Object.keys(SCHEMA).forEach(function (key) {
    ensureHeader_(SCHEMA[key]);
  });
  inizializzaRegoleDefault_();
}

/** Wrapper per il menu del foglio: esegue l'inizializzazione e mostra un alert. */
function inizializzaAppDaMenu() {
  inizializzaApp();
  SpreadsheetApp.getUi().alert('Struttura fogli pronta. Puoi ora usare "Carica dati di esempio" oppure iniziare a inserire Squadre, Zone e Interventi.');
}

function inizializzaRegoleDefault_() {
  var esistenti = readAll_('REGOLE');
  var chiaviEsistenti = esistenti.map(function (r) { return r.chiave; });
  REGOLE_DEFAULT.forEach(function (regola) {
    if (chiaviEsistenti.indexOf(regola.chiave) === -1) {
      upsertRow_('REGOLE', regola);
    }
  });
}

function mostraUrlWebApp() {
  var url = ScriptApp.getService().getUrl();
  var msg = url
    ? 'URL Web App:\n' + url
    : 'Nessuna distribuzione attiva. Usa Distribuisci > Nuova distribuzione > Applicazione web dall\'editor Apps Script.';
  SpreadsheetApp.getUi().alert(msg);
}

/** Wrapper per il menu del foglio: carica i dati di esempio e mostra un alert. */
function caricaDatiDiEsempioDaMenu() {
  caricaDatiDiEsempio();
  SpreadsheetApp.getUi().alert('Dati di esempio caricati. Vai sulla Web App e premi "Esegui pianificazione".');
}

function caricaDatiDiEsempio() {
  inizializzaApp();

  var zoneEsistenti = readAll_('ZONE');
  if (zoneEsistenti.length === 0) {
    upsertRow_('ZONE', { nome: 'Nord', lat: 45.4642, lng: 9.1900, note: 'Quadrante nord città' });
    upsertRow_('ZONE', { nome: 'Centro', lat: 45.4641, lng: 9.1919, note: 'Centro storico' });
    upsertRow_('ZONE', { nome: 'Sud', lat: 45.4408, lng: 9.1996, note: 'Quadrante sud città' });
  }

  var squadreEsistenti = readAll_('SQUADRE');
  if (squadreEsistenti.length === 0) {
    upsertRow_('SQUADRE', {
      nome: 'Squadra Alfa', competenze: 'elettrico,idraulico', zoneCoperte: 'Nord,Centro',
      capacitaMinuti: 480, oraInizio: '08:00', oraFine: '17:00',
      latBase: 45.4830, lngBase: 9.2000, colore: '#4285F4', attiva: true
    });
    upsertRow_('SQUADRE', {
      nome: 'Squadra Beta', competenze: 'idraulico,climatizzazione', zoneCoperte: 'Centro,Sud',
      capacitaMinuti: 480, oraInizio: '08:00', oraFine: '17:00',
      latBase: 45.4600, lngBase: 9.1950, colore: '#EA4335', attiva: true
    });
    upsertRow_('SQUADRE', {
      nome: 'Squadra Gamma', competenze: 'elettrico,climatizzazione', zoneCoperte: 'Sud',
      capacitaMinuti: 420, oraInizio: '09:00', oraFine: '16:00',
      latBase: 45.4300, lngBase: 9.2050, colore: '#34A853', attiva: true
    });
  }

  var interventiEsistenti = readAll_('INTERVENTI');
  if (interventiEsistenti.length === 0) {
    var oggi = new Date();
    var domani = new Date(oggi.getTime() + 24 * 3600 * 1000);
    var dopodomani = new Date(oggi.getTime() + 48 * 3600 * 1000);
    var fmt = function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy'); };

    upsertRow_('INTERVENTI', { cliente: 'Rossi SpA', indirizzo: 'Via Roma 1', zona: 'Nord', lat: 45.4850, lng: 9.2010, competenza: 'elettrico', priorita: 'Urgente', durataMinuti: 90, finestraInizio: '08:00', finestraFine: '12:00', dataRichiesta: fmt(oggi), scadenza: fmt(domani), stato: 'Da pianificare' });
    upsertRow_('INTERVENTI', { cliente: 'Bianchi Srl', indirizzo: 'Via Milano 10', zona: 'Nord', lat: 45.4700, lng: 9.1850, competenza: 'idraulico', priorita: 'Normale', durataMinuti: 60, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), scadenza: fmt(dopodomani), stato: 'Da pianificare' });
    upsertRow_('INTERVENTI', { cliente: 'Verdi & Co', indirizzo: 'Corso Centro 5', zona: 'Centro', lat: 45.4635, lng: 9.1900, competenza: 'idraulico', priorita: 'Alta', durataMinuti: 45, finestraInizio: '09:00', finestraFine: '13:00', dataRichiesta: fmt(oggi), scadenza: fmt(domani), stato: 'Da pianificare' });
    upsertRow_('INTERVENTI', { cliente: 'Neri Impianti', indirizzo: 'Via Sud 22', zona: 'Sud', lat: 45.4350, lng: 9.2000, competenza: 'climatizzazione', priorita: 'Normale', durataMinuti: 120, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), scadenza: fmt(dopodomani), stato: 'Da pianificare' });
    upsertRow_('INTERVENTI', { cliente: 'Gialli Retail', indirizzo: 'Via Sud 40', zona: 'Sud', lat: 45.4280, lng: 9.2100, competenza: 'elettrico', priorita: 'Bassa', durataMinuti: 60, finestraInizio: '10:00', finestraFine: '16:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
  }
}
