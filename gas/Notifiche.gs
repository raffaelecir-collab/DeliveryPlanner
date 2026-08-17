/**
 * Centro notifiche per la campanella lato Admin/Cliente: registra un evento avvenuto su un
 * intervento (nuova nota, cambio stato, riassegnazione squadra...) e lo rende disponibile a chi
 * deve saperlo. Un account Squadra non ha una campanella (vede solo la propria programmazione),
 * ma le sue azioni (completamento, nota) generano comunque notifiche per Admin e Cliente.
 *
 * "Letto"/"non letto" è per RUOLO, non per singolo indirizzo email: come il resto dell'app
 * (vedi RUOLO in Config.gs), Admin e Cliente sono account condivisi, non utenti singoli — aprire
 * la campanella segna come lette tutte le notifiche di quel ruolo per chiunque lo usi.
 */

/** Chi deve ricevere una notifica generata da un'azione di questo ruolo: mai lo stesso ruolo che l'ha causata; le azioni di un account Squadra (senza campanella) notificano sia Admin sia Cliente. */
function notificaDestinatariDiRuolo_(ruoloAttore) {
  if (ruoloAttore === RUOLO.ADMIN) return [RUOLO.CLIENTE];
  if (ruoloAttore === RUOLO.CLIENTE) return [RUOLO.ADMIN];
  return [RUOLO.ADMIN, RUOLO.CLIENTE];
}

function troncaTesto_(testo, maxLen) {
  var s = String(testo || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trim() + '…';
}

/**
 * Registra un evento su un intervento, una riga per ciascun ruolo destinatario. `ruoloAttore`
 * (di default il ruolo dell'utente che sta effettivamente chiamando) determina chi la riceve —
 * vedi notificaDestinatariDiRuolo_. Va chiamata SUBITO DOPO aver scritto la modifica sul foglio
 * (serve comunque `intervento` con i dati aggiornati solo per cliente/codiceEsterno/id/_row, che
 * non cambiano con l'evento).
 */
function creaNotificaIntervento_(intervento, evento, ruoloAttore) {
  var attore = ruoloAttore || ruoloUtenteCorrente_();
  var destinatari = notificaDestinatariDiRuolo_(attore);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  destinatari.forEach(function (ruolo) {
    upsertRow_('NOTIFICHE', {
      timestamp: timestamp,
      interventoId: intervento.id || '',
      interventoRow: intervento._row,
      codiceEsterno: intervento.codiceEsterno || '',
      cliente: intervento.cliente || '',
      evento: evento,
      destinatario: ruolo,
      letto: false
    });
  });
}

/**
 * Notifica SOLO l'Admin, anche quando l'attore dell'evento è l'Admin stesso: eccezione esplicita
 * alla regola generale "mai notificare lo stesso ruolo che ha causato l'evento" (vedi
 * notificaDestinatariDiRuolo_/creaNotificaIntervento_), usata per avvisi che l'Admin deve
 * ricevere a prescindere da chi/cosa ha innescato l'evento (es. Ricavo composto inferiore al
 * Prezzo importato dal tracking esterno — vedi Import.gs e "Componi Ricavo" in JS.html).
 */
function creaNotificaSoloAdmin_(intervento, evento) {
  upsertRow_('NOTIFICHE', {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    interventoId: intervento.id || '',
    interventoRow: intervento._row,
    codiceEsterno: intervento.codiceEsterno || '',
    cliente: intervento.cliente || '',
    evento: evento,
    destinatario: RUOLO.ADMIN,
    letto: false
  });
}

/**
 * Notifiche per il ruolo dell'utente corrente (solo Admin/Cliente hanno una campanella), più
 * recenti prima, limitate alle ultime 40 per non appesantire il payload. `nonLette` è il conteggio
 * REALE (non limitato alle 40 restituite) usato per il pallino sulla campanella.
 */
function getNotifiche() {
  var ctx = contestoUtenteCorrente_();
  if (ctx.ruolo !== RUOLO.ADMIN && ctx.ruolo !== RUOLO.CLIENTE) return { notifiche: [], nonLette: 0 };
  var mie = readAll_('NOTIFICHE').filter(function (n) { return n.destinatario === ctx.ruolo; });
  // L'ordine di inserimento (numero di riga fisica) coincide con l'ordine temporale: ogni
  // notifica viene sempre accodata, mai modificata se non per il flag "letto".
  mie.sort(function (a, b) { return b._row - a._row; });
  var nonLette = mie.filter(function (n) { return !n.letto; }).length;
  return {
    nonLette: nonLette,
    notifiche: mie.slice(0, 40).map(function (n) {
      return {
        id: n.id, timestamp: n.timestamp, interventoId: n.interventoId, interventoRow: n.interventoRow,
        codiceEsterno: n.codiceEsterno, cliente: n.cliente, evento: n.evento, letto: n.letto
      };
    })
  };
}

/** Segna come lette tutte le notifiche non lette del ruolo corrente: chiamata all'apertura della campanella. */
function segnaNotificheLette() {
  var ctx = contestoUtenteCorrente_();
  if (ctx.ruolo !== RUOLO.ADMIN && ctx.ruolo !== RUOLO.CLIENTE) return true;
  readAll_('NOTIFICHE').forEach(function (n) {
    if (n.destinatario === ctx.ruolo && !n.letto) updateRowFields_('NOTIFICHE', n._row, { letto: true });
  });
  return true;
}
