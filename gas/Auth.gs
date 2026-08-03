/**
 * Ruolo (Admin/Cliente/Squadra) dell'account Google che esegue la Web App e guardie usate dalle
 * funzioni riservate. Non richiede login separato: Apps Script autentica già l'account Google in
 * base alle impostazioni di distribuzione (vedi Code.gs).
 *
 * Precedenza quando un'email comparisse per errore in più elenchi: Squadra prima di Cliente,
 * altrimenti Admin — Squadra è il ruolo più specifico/ristretto, quindi vince in caso di dubbio.
 */

/**
 * Determina ruolo (ed eventuale squadra) dell'account corrente. Legge REGOLE e SQUADRE
 * direttamente (non tramite listaRegole_/listaSquadre, protette da richiedeAdmin_): altrimenti la
 * determinazione del ruolo richiamerebbe se stessa all'infinito ogni volta che una funzione
 * Admin-only viene chiamata da un account non Admin.
 */
function contestoUtenteCorrente_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return { ruolo: RUOLO.ADMIN, squadraId: null };

  var squadraMatch = readAll_('SQUADRE').filter(function (s) {
    return splitList_(s.emailSquadra).map(function (e) { return e.toLowerCase(); }).indexOf(email) !== -1;
  })[0];
  if (squadraMatch) return { ruolo: RUOLO.SQUADRA, squadraId: squadraMatch.id };

  if (emailClientiConfigurate_().indexOf(email) !== -1) return { ruolo: RUOLO.CLIENTE, squadraId: null };

  return { ruolo: RUOLO.ADMIN, squadraId: null };
}

/**
 * Elenco email (minuscolo) configurate nella regola "emailClienti", letta direttamente dal
 * foglio (non tramite listaRegole_/getRegoleMappa_) per lo stesso motivo di contestoUtenteCorrente_.
 * Riusata anche da Documenti.gs per condividere le cartelle documenti con l'account Cliente.
 */
function emailClientiConfigurate_() {
  var riga = readAll_('REGOLE').filter(function (r) { return r.chiave === 'emailClienti'; })[0];
  return splitList_(riga ? riga.valore : '').map(function (e) { return e.toLowerCase(); });
}

/** Chi non compare in nessun elenco (emailClienti, emailSquadra di una Squadra) resta Admin:
 *  comportamento invariato per tutti gli account esistenti finché non si aggiunge esplicitamente
 *  un'email cliente/squadra. */
function ruoloUtenteCorrente_() {
  return contestoUtenteCorrente_().ruolo;
}

/** Da chiamare come prima riga delle funzioni riservate all'Admin (CRUD Squadre/Regole, import, pianificazione). */
function richiedeAdmin_() {
  if (ruoloUtenteCorrente_() !== RUOLO.ADMIN) throw new Error('Operazione non consentita per il tuo account.');
}

/** Da chiamare nelle funzioni NON consentite all'account Squadra (es. sospendi/annulla, riservate ad Admin/Cliente). */
function richiedeNonSquadra_() {
  if (ruoloUtenteCorrente_() === RUOLO.SQUADRA) throw new Error('Operazione non consentita per l\'account Squadra.');
}

/** Restituisce l'id della Squadra dell'account corrente, o lancia se non è un account Squadra. */
function contestoSquadraCorrente_() {
  var ctx = contestoUtenteCorrente_();
  if (ctx.ruolo !== RUOLO.SQUADRA || !ctx.squadraId) throw new Error('Operazione consentita solo agli account Squadra.');
  return ctx.squadraId;
}

/**
 * Se l'account corrente è una Squadra, verifica che l'intervento le sia assegnato (altrimenti
 * lancia): usata dalle funzioni condivise con Admin/Cliente (es. aggiungiNotaIntervento) per
 * impedire a un account Squadra di toccare interventi di un'altra squadra. Per Admin/Cliente non
 * fa nulla (restano senza questa restrizione, come prima).
 */
function verificaAccessoSquadraIntervento_(intervento) {
  var ctx = contestoUtenteCorrente_();
  if (ctx.ruolo === RUOLO.SQUADRA && intervento.squadraId !== ctx.squadraId) {
    throw new Error('Operazione non consentita: intervento non assegnato alla tua squadra.');
  }
}
