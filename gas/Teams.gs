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

  var esistente = squadra.id
    ? readAll_('SQUADRE').filter(function (s) { return s.id === squadra.id; })[0]
    : (squadra._row ? readAll_('SQUADRE').filter(function (s) { return s._row === squadra._row; })[0] : null);

  // Ri-geocodifica non solo se l'indirizzo è cambiato, ma anche se le coordinate sono
  // ancora mancanti (riga creata a mano, o salvata prima che esistesse la geocodifica):
  // altrimenti risalvare senza toccare il testo dell'indirizzo non risolverebbe nulla.
  var partenzaDaGeocodificare = !esistente || esistente.indirizzoPartenza !== squadra.indirizzoPartenza ||
    !isNum_(esistente.latPartenza) || !isNum_(esistente.lngPartenza);
  if (partenzaDaGeocodificare) {
    var coordPartenza = geocodifica_(squadra.indirizzoPartenza);
    if (!coordPartenza) throw new Error('Indirizzo di partenza non trovato (provato sia con Google Maps sia con OpenStreetMap): "' + squadra.indirizzoPartenza + '". Verifica che sia corretto e completo (via, numero civico, città).');
    squadra.latPartenza = coordPartenza.lat;
    squadra.lngPartenza = coordPartenza.lng;
  }

  var indirizzoRientro = squadra.indirizzoRientro || squadra.indirizzoPartenza;
  var rientroDaGeocodificare = !esistente || esistente.indirizzoRientro !== squadra.indirizzoRientro ||
    esistente.indirizzoPartenza !== squadra.indirizzoPartenza || !isNum_(esistente.latRientro) || !isNum_(esistente.lngRientro);
  if (rientroDaGeocodificare) {
    var coordRientro = geocodifica_(indirizzoRientro);
    if (!coordRientro) throw new Error('Indirizzo di rientro non trovato (provato sia con Google Maps sia con OpenStreetMap): "' + indirizzoRientro + '". Verifica che sia corretto e completo (via, numero civico, città).');
    squadra.latRientro = coordRientro.lat;
    squadra.lngRientro = coordRientro.lng;
  }

  return upsertRow_('SQUADRE', squadra);
}

function eliminaSquadra(id, row) {
  return deleteRow_('SQUADRE', id, row);
}
