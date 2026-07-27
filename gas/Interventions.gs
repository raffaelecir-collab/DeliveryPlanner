/**
 * CRUD Interventi + utilità di filtro usate dalla dashboard.
 */

function listaInterventi(filtri) {
  var tutti = readAll_('INTERVENTI');
  if (!filtri) return tutti;
  return tutti.filter(function (i) {
    if (filtri.stato && i.stato !== filtri.stato) return false;
    if (filtri.squadraId && i.squadraId !== filtri.squadraId) return false;
    return true;
  });
}

function salvaIntervento(intervento) {
  if (!intervento.cliente) throw new Error('Il cliente è obbligatorio.');
  if (!intervento.indirizzo) throw new Error('L\'indirizzo è obbligatorio.');

  var esistente = intervento.id
    ? readAll_('INTERVENTI').filter(function (i) { return i.id === intervento.id; })[0]
    : (intervento._row ? readAll_('INTERVENTI').filter(function (i) { return i._row === intervento._row; })[0] : null);
  if (!esistente || esistente.indirizzo !== intervento.indirizzo) {
    var coord = geocodifica_(intervento.indirizzo);
    if (!coord) throw new Error('Indirizzo non trovato: "' + intervento.indirizzo + '". Verifica che sia corretto e completo (via, città).');
    intervento.lat = coord.lat;
    intervento.lng = coord.lng;
  }

  return upsertRow_('INTERVENTI', intervento);
}

/** Trova una riga per id, con fallback sul numero di riga fisica se l'id è assente (riga inserita a mano). */
function trovaInterventoPerIdORiga_(id, row) {
  var tutti = readAll_('INTERVENTI');
  var trovato = id ? tutti.filter(function (i) { return i.id === id; })[0] : null;
  if (!trovato && row) trovato = tutti.filter(function (i) { return i._row === row; })[0];
  return trovato;
}

function eliminaIntervento(id, row) {
  return deleteRow_('INTERVENTI', id, row);
}

/** Riporta un intervento allo stato "Da pianificare", liberando squadra/data/ora assegnate. */
function ripianificaIntervento(id, row) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, {
    stato: STATO_INTERVENTO.DA_PIANIFICARE,
    squadraId: '',
    dataPianificata: '',
    oraPianificata: '',
    ordineTappa: '',
    motivoNonPianificato: ''
  });
  return true;
}

function segnaCompletato(id, row) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.COMPLETATO });
  return true;
}

function annullaIntervento(id, row) {
  var esistente = trovaInterventoPerIdORiga_(id, row);
  if (!esistente) throw new Error('Intervento non trovato.');
  updateRowFields_('INTERVENTI', esistente._row, { stato: STATO_INTERVENTO.ANNULLATO });
  return true;
}
