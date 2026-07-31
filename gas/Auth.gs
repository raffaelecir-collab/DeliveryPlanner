/**
 * Ruolo (Admin/Cliente) dell'account Google che esegue la Web App e guardia usata dalle
 * funzioni riservate all'Admin. Non richiede login separato: Apps Script autentica già
 * l'account Google in base alle impostazioni di distribuzione (vedi Code.gs).
 */

/**
 * Chi non compare nella regola "emailClienti" resta Admin: comportamento invariato per tutti
 * gli account esistenti finché non si aggiunge esplicitamente un'email cliente in Regole.
 */
function ruoloUtenteCorrente_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return RUOLO.ADMIN;
  // Lettura diretta del foglio (non tramite listaRegole/getRegoleMappa_, che sono a loro volta
  // protette da richiedeAdmin_): altrimenti la determinazione del ruolo richiamerebbe se stessa
  // all'infinito ogni volta che una funzione Admin-only viene chiamata da un account Cliente.
  var riga = readAll_('REGOLE').filter(function (r) { return r.chiave === 'emailClienti'; })[0];
  var clienti = splitList_(riga ? riga.valore : '').map(function (e) { return e.toLowerCase(); });
  return clienti.indexOf(email) !== -1 ? RUOLO.CLIENTE : RUOLO.ADMIN;
}

/** Da chiamare come prima riga delle funzioni riservate all'Admin (CRUD Squadre/Regole, import, pianificazione). */
function richiedeAdmin_() {
  if (ruoloUtenteCorrente_() !== RUOLO.ADMIN) throw new Error('Operazione non consentita per l\'account Cliente.');
}
