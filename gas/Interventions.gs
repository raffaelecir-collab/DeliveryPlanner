/**
 * CRUD Interventi + utilità di filtro usate dalla dashboard.
 */

function listaInterventi(filtri) {
  var tutti = readAll_('INTERVENTI');
  if (!filtri) return tutti;
  return tutti.filter(function (i) {
    if (filtri.stato && i.stato !== filtri.stato) return false;
    if (filtri.zona && i.zona !== filtri.zona) return false;
    if (filtri.squadraId && i.squadraId !== filtri.squadraId) return false;
    return true;
  });
}

function salvaIntervento(intervento) {
  if (!intervento.cliente) throw new Error('Il cliente è obbligatorio.');
  if (!intervento.zona) throw new Error('La zona è obbligatoria.');
  // Se l'utente modifica manualmente un intervento già pianificato, lo si riporta
  // in "Da pianificare" a meno che non stia solo aggiornando stato/assegnazione esplicitamente.
  return upsertRow_('INTERVENTI', intervento);
}

function eliminaIntervento(id) {
  return deleteRow_('INTERVENTI', id);
}

/** Riporta un intervento allo stato "Da pianificare", liberando squadra/data/ora assegnate. */
function ripianificaIntervento(id) {
  var esistente = readAll_('INTERVENTI').filter(function (i) { return i.id === id; })[0];
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, {
    stato: STATO_INTERVENTO.DA_PIANIFICARE,
    squadraId: '',
    dataPianificata: '',
    oraPianificata: '',
    motivoNonPianificato: ''
  });
  return true;
}

function segnaCompletato(id) {
  var esistente = readAll_('INTERVENTI').filter(function (i) { return i.id === id; })[0];
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.COMPLETATO });
  return true;
}

function annullaIntervento(id) {
  var esistente = readAll_('INTERVENTI').filter(function (i) { return i.id === id; })[0];
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.ANNULLATO });
  return true;
}
