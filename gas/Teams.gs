/**
 * CRUD Squadre (Teams). Al salvataggio, indirizzo di partenza e di rientro
 * vengono geocodificati automaticamente (solo se cambiati, per non consumare
 * inutilmente la quota del servizio Maps).
 */

function listaSquadre() {
  return readAll_('SQUADRE');
}

function salvaSquadra(squadra) {
  if (!squadra.nome) throw new Error('Il nome della squadra è obbligatorio.');
  if (!squadra.indirizzoPartenza) throw new Error('L\'indirizzo di partenza è obbligatorio.');

  var esistente = squadra.id ? readAll_('SQUADRE').filter(function (s) { return s.id === squadra.id; })[0] : null;

  if (!esistente || esistente.indirizzoPartenza !== squadra.indirizzoPartenza) {
    var coordPartenza = geocodifica_(squadra.indirizzoPartenza);
    if (!coordPartenza) throw new Error('Indirizzo di partenza non trovato: "' + squadra.indirizzoPartenza + '". Verifica che sia corretto e completo (via, città).');
    squadra.latPartenza = coordPartenza.lat;
    squadra.lngPartenza = coordPartenza.lng;
  }

  var indirizzoRientro = squadra.indirizzoRientro || squadra.indirizzoPartenza;
  if (!esistente || esistente.indirizzoRientro !== squadra.indirizzoRientro || esistente.indirizzoPartenza !== squadra.indirizzoPartenza) {
    var coordRientro = geocodifica_(indirizzoRientro);
    if (!coordRientro) throw new Error('Indirizzo di rientro non trovato: "' + indirizzoRientro + '". Verifica che sia corretto e completo (via, città).');
    squadra.latRientro = coordRientro.lat;
    squadra.lngRientro = coordRientro.lng;
  }

  return upsertRow_('SQUADRE', squadra);
}

function eliminaSquadra(id) {
  return deleteRow_('SQUADRE', id);
}
