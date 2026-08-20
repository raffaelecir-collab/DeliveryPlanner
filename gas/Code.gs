/**
 * Entry point della Web App e facciata delle API esposte al client via google.script.run.
 * L'accesso alla web app è regolato dalle impostazioni di distribuzione di Apps Script
 * (Esegui come.../Chi ha accesso...), quindi non è necessario un login separato:
 * Apps Script richiede già l'autenticazione con account Google in base a come viene distribuita.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Delivery Planner - Pianificazione Territoriale')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Utility per includere partial HTML (CSS/JS) nel template Index.html. */
function include(nomeFile) {
  return HtmlService.createHtmlOutputFromFile(nomeFile).getContent();
}

/**
 * Dati iniziali necessari all'app client: schema campi (per generare i form),
 * elenco squadre/zone (per le select) e utente corrente.
 */
function getBootstrapData() {
  inizializzaApp();
  var ctx = contestoUtenteCorrente_();
  var ruolo = ctx.ruolo;
  var schemaClient = {};
  if (ruolo === RUOLO.ADMIN || ruolo === RUOLO.CLIENTE) {
    Object.keys(SCHEMA).forEach(function (k) {
      // NOTIFICHE è un log interno per la campanella (Notifiche.gs), senza un form di modifica
      // dedicato: non ha senso esporlo nello schema generico usato per generare i form.
      if (k === 'NOTIFICHE') return;
      if (ruolo === RUOLO.CLIENTE && k !== 'INTERVENTI') return;
      schemaClient[k] = { label: SCHEMA[k].label, fields: SCHEMA[k].fields };
    });
  }
  // Un account Squadra non vede l'elenco squadre (nemmeno la propria, a parte id/nome/colore già
  // restituiti da getProgrammazioneSquadraPropria): niente indirizzi/email/competenze di NESSUNA
  // squadra, incluse le altre, nel payload iniziale.
  var squadre = ruolo === RUOLO.SQUADRA ? [] : readAll_('SQUADRE');
  return {
    schema: schemaClient,
    squadre: squadre,
    utente: Session.getActiveUser().getEmail() || '',
    ruolo: ruolo,
    squadraId: ctx.squadraId || '',
    legendaTipoAttivita: LEGENDA_TIPO_ATTIVITA_,
    // Serve alla Dashboard (lato client) per calcolare i giorni effettivamente lavorabili di una
    // squadra su un intervallo (target di produzione, "giorni programmati/giorni totali") — vedi
    // giornoLavorativoRegolaGeneraleClient_ in JS.html. Letta senza il controllo Admin di
    // listaRegole (valoreRegolaPubblica_, Rules.gs) perché getBootstrapData serve anche account
    // Cliente/Squadra, che non vedono comunque la Dashboard ma ricevono comunque questo valore
    // non sensibile.
    giorniLavorativi: valoreRegolaPubblica_('giorniLavorativi', 'Lun,Mar,Mer,Gio,Ven')
  };
}

function getLogPianificazioni() {
  richiedeAdmin_();
  var log = readAll_('LOG');
  return log.slice().reverse().slice(0, 20);
}
