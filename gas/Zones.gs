/**
 * CRUD Zone (territorio).
 */

function listaZone() {
  return readAll_('ZONE');
}

function salvaZona(zona) {
  if (!zona.nome) throw new Error('Il nome della zona è obbligatorio.');
  return upsertRow_('ZONE', zona);
}

function eliminaZona(id) {
  return deleteRow_('ZONE', id);
}
