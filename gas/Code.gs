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
  var ruolo = ruoloUtenteCorrente_();
  var schemaClient = {};
  Object.keys(SCHEMA).forEach(function (k) {
    if (ruolo === RUOLO.CLIENTE && k !== 'INTERVENTI') return;
    schemaClient[k] = { label: SCHEMA[k].label, fields: SCHEMA[k].fields };
  });
  return {
    schema: schemaClient,
    squadre: readAll_('SQUADRE'),
    utente: Session.getActiveUser().getEmail() || '',
    ruolo: ruolo
  };
}

function getLogPianificazioni() {
  richiedeAdmin_();
  var log = readAll_('LOG');
  return log.slice().reverse().slice(0, 20);
}
