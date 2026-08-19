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
    .addItem('Attiva aggiornamento giornaliero priorità automatiche', 'installaTriggerAggiornaPrioritaDaMenu')
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
  forzaFormatoTestoUnaVoltaSola_();
  inizializzaRegoleDefault_();
  inizializzaListinoDefault_();
  // Rinfresca le Priorità automatiche (vedi aggiornaPrioritaAutomaticheGiornaliero_ in
  // Interventions.gs) ad ogni apertura della Web App: garantisce che restino aggiornate anche
  // senza installare il trigger giornaliero opzionale (menu del foglio), a costo di un confronto
  // in più (nessuna chiamata di rete) su ogni bootstrap — le scritture avvengono solo per le
  // righe davvero cambiate.
  aggiornaPrioritaAutomaticheGiornaliero_();
}

/**
 * Forza, UNA VOLTA SOLA per questo foglio Google, il formato testo semplice ("@") sulle colonne
 * "testo"/"data" di tutti gli schemi (vedi formattaColonneComeTesto_ in SheetService.gs).
 * Necessaria per i fogli GIÀ ESISTENTI: la loro intestazione è già corretta, quindi non passano
 * mai più dal ramo di ensureHeader_ che applica questo formato (pensato per la creazione/
 * riparazione dell'intestazione, non per ogni apertura). Senza questa protezione, Google Sheets
 * può reinterpretare come NUMERO un valore testuale numerico appena scritto (es. Codice Esterno,
 * o un'Operazione con zeri iniziali come "0010" che diventa 10), rompendo silenziosamente il
 * confronto usato per riconoscere un intervento già importato a un import successivo. Usa una
 * proprietà del documento (non una Regola: è un marcatore interno, non deve comparire nel tab
 * Regole) per non ripetere l'operazione, non gratuita, ad ogni apertura della Web App.
 */
function forzaFormatoTestoUnaVoltaSola_() {
  var proprieta = PropertiesService.getDocumentProperties();
  if (proprieta.getProperty('formatoTestoApplicato') === '1') return;
  Object.keys(SCHEMA).forEach(function (key) {
    var schemaDef = SCHEMA[key];
    formattaColonneComeTesto_(getOrCreateSheet_(schemaDef.sheetName), schemaDef);
  });
  proprieta.setProperty('formatoTestoApplicato', '1');
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

/** Seed iniziale del listino (vedi LISTINO_DEFAULT in Config.gs): non tocca voci già presenti. */
function inizializzaListinoDefault_() {
  var esistenti = readAll_('LISTINO');
  var vociEsistenti = esistenti.map(function (r) { return r.voce; });
  LISTINO_DEFAULT.forEach(function (voce) {
    if (vociEsistenti.indexOf(voce.voce) === -1) {
      upsertRow_('LISTINO', voce);
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
      nome: 'Squadra Alfa', competenze: 'SM01,SM02',
      indirizzoPartenza: 'Piazzale Loreto, Milano', indirizzoRientro: '',
      oraInizio: '08:00', oraFine: '17:00', pausaPranzoInizio: '13:00', pausaPranzoFine: '14:00',
      colore: '#4285F4', attiva: true
    });
    salvaSquadra({
      nome: 'Squadra Beta', competenze: 'SM02,SM03',
      indirizzoPartenza: 'Piazza Duomo, Milano', indirizzoRientro: '',
      oraInizio: '08:00', oraFine: '17:00', pausaPranzoInizio: '13:00', pausaPranzoFine: '13:30',
      colore: '#EA4335', attiva: true
    });
    salvaSquadra({
      nome: 'Squadra Gamma', competenze: 'SM01,SM04',
      indirizzoPartenza: 'Piazza Ovidio, Milano', indirizzoRientro: '',
      oraInizio: '09:00', oraFine: '16:00', pausaPranzoInizio: '', pausaPranzoFine: '',
      colore: '#34A853', attiva: true
    });
  }

  var interventiEsistenti = readAll_('INTERVENTI');
  if (interventiEsistenti.length === 0) {
    var oggi = new Date();
    var domani = new Date(oggi.getTime() + 24 * 3600 * 1000);
    var fmt = function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy'); };

    // Scadenza e Priorità di SM01/SM02/SM04 vengono comunque sempre ricalcolate in automatico da
    // salvaIntervento (vedi calcolaScadenzaAutomatica_/calcolaPrioritaAutomatica_ in questo file):
    // non serve indicarle qui. Per SM03 la Scadenza esplicita sotto è invece rispettata (è solo un
    // default), ma la Priorità resta comunque automatica come per gli altri Tipi Attività noti.
    salvaIntervento({ cliente: 'Rossi SpA', indirizzo: 'Via Padova 100, Milano', tipoAttivita: 'SM01', durataMinuti: 90, finestraInizio: '08:00', finestraFine: '12:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Bianchi Srl', indirizzo: 'Corso Buenos Aires 50, Milano', tipoAttivita: 'SM02', durataMinuti: 60, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Verdi & Co', indirizzo: 'Via Torino 20, Milano', tipoAttivita: 'SM03', durataMinuti: 45, finestraInizio: '09:00', finestraFine: '13:00', dataRichiesta: fmt(oggi), scadenza: fmt(domani), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Neri Impianti', indirizzo: 'Viale Papiniano 30, Milano', tipoAttivita: 'SM04', durataMinuti: 120, finestraInizio: '08:00', finestraFine: '17:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
    salvaIntervento({ cliente: 'Gialli Retail', indirizzo: 'Via Ripamonti 80, Milano', priorita: 'Bassa', durataMinuti: 60, finestraInizio: '10:00', finestraFine: '16:00', dataRichiesta: fmt(oggi), stato: 'Da pianificare' });
  }
}
