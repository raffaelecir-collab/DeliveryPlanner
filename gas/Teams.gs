/**
 * CRUD Squadre (Teams). Funzioni esposte al client tramite google.script.run
 * (vedi anche Code.gs per i wrapper con validazione errori uniforme).
 */

function listaSquadre() {
  return readAll_('SQUADRE');
}

function salvaSquadra(squadra) {
  if (!squadra.nome) throw new Error('Il nome della squadra è obbligatorio.');
  return upsertRow_('SQUADRE', squadra);
}

function eliminaSquadra(id) {
  return deleteRow_('SQUADRE', id);
}
