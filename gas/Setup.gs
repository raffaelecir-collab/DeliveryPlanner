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
    .addItem('Attiva geocodifica automatica su modifica foglio', 'installaTriggerGeocodificaDaMenu')
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
  SpreadsheetApp.getUi().alert('Struttura fogli pronta. Puoi ora usare "Carica dati di esempio" oppure iniziare a inserire Squadre e Interventi.');
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

/**
 * Popola squadre e interventi di esempio con indirizzi reali (zona Milano), usando
 * salvaSquadra/salvaIntervento in modo che vengano geocodificati automaticamente
 * come avverrebbe nell'uso normale dell'app.
 */
function caricaDatiDiEsempio() {
  inizializzaApp();

  var squadreEsistenti = readAll_('SQUADRE');
  if (squadreEsistenti.length === 0) {
    salvaSquadra({
      nome: 'Squadra Alfa', competenze: 'elettrico,idraulico',
      indirizzoPartenza: 'Piazzale Loreto, Milano', indirizzoRientro: '',
      oraInizio: '08:00', oraFine: '17:00', pausaPranzoInizio: '13:00', pausaPranzoFine: '14:00',
      colore: '#4285F4', attiva: true
    });
    salvaSquadra({
      nome: 'Squadra Beta', competenze: 'idraulico,climatizzazione',
      indirizzoPartenza: 'Piazza Duomo, Milano', indirizzoRientro: '',
      oraInizio: '08:00', oraFine: '17:00', pausaPranzoInizio: '13:00', pausaPranzoFine: '13:30',
      colore: '#EA4335', attiva: true
    });
    salvaSquadra({
      nome: 'Squadra Gamma', competenze: 'elettrico,climatizzazione',
      indirizzoPartenza: 'Piazza Ovidio, Milano', indirizzoRientro: '',
      oraInizio: '09:00', oraFine: '16:00', pausaPranzoInizio: '', pausaPranzoFine: '',
      colore: '#34A853', attiva: true
    });
  }

  var interventiEsistenti = readAll_('INTERVENTI');
  if (interventiEsistenti.length === 0) {
    var oggi = new Date();
    var domani = new Date(oggi.getTime() + 24 * 3600 * 1000);
    var dopodomani = new Date(oggi.getTime() + 48 * 3600 * 1000);
    var fmt = function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy'); };

    salvaIntervento({ cliente: 'Rossi SpA', indirizzo: 'Via Padova 100, Milano', competenza: 'elettrico', priorita: 'Urgente', durataMinuti: 90, finestraInizio: '08:00', finestraFine: '12:00', dataRichiesta: fmt(oggi), scadenza: fmt(domani), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Bianchi Srl', indirizzo: 'Corso Buenos Aires 50, Milano', competenza: 'idraulico', priorita: 'Normale', durataMinuti: 60, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), scadenza: fmt(dopodomani), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Verdi & Co', indirizzo: 'Via Torino 20, Milano', competenza: 'idraulico', priorita: 'Alta', durataMinuti: 45, finestraInizio: '09:00', finestraFine: '13:00', dataRichiesta: fmt(oggi), scadenza: fmt(domani), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Neri Impianti', indirizzo: 'Viale Papiniano 30, Milano', competenza: 'climatizzazione', priorita: 'Normale', durataMinuti: 120, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), scadenza: fmt(dopodomani), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Gialli Retail', indirizzo: 'Via Ripamonti 80, Milano', competenza: 'elettrico', priorita: 'Bassa', durataMinuti: 60, finestraInizio: '10:00', finestraFine: '16:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
  }
}
