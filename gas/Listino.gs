/**
 * CRUD Listino prezzi (voci concordate con Sicuritalia): usato lato Admin per comporre il
 * Ricavo (€) di un Intervento (vedi "Componi Ricavo" nel tab Interventi, JS.html).
 */

function listaListino() {
  richiedeAdmin_();
  return readAll_('LISTINO');
}

function salvaVoceListino(voce) {
  richiedeAdmin_();
  if (!voce.voce) throw new Error('La "Voce" del listino è obbligatoria.');
  return upsertRow_('LISTINO', voce);
}

function eliminaVoceListino(id, row) {
  richiedeAdmin_();
  return deleteRow_('LISTINO', id, row);
}
