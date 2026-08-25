/**
 * Vista dedicata all'account Squadra (autorizzato via "emailSquadra" su una Squadra, vedi
 * Auth.gs): la propria programmazione, e nient'altro — mai i dati di un'altra squadra.
 */

/**
 * Elenco degli interventi Pianificati o Completati della PROPRIA squadra in [dal, al] (incluse
 * entrambe le estremità), per le tre viste elenco/agenda/mappa del tab Squadra. Il Ricavo (€) è
 * volutamente escluso dalla forma restituita: dato economico non necessario sul campo. La
 * squadra può tornare indietro nel tempo quanto vuole (nessun limite sulla data), per rivedere
 * il lavoro già completato.
 */
function getProgrammazioneSquadraPropria(dataInizioStr, dataFineStr) {
  var squadraId = contestoSquadraCorrente_();
  var dataInizio = parseDateStr_(dataInizioStr);
  var dataFine = parseDateStr_(dataFineStr);
  if (!dataInizio || !dataFine) throw new Error('Intervallo di date non valido.');

  var squadra = readAll_('SQUADRE').filter(function (s) { return s.id === squadraId; })[0];
  if (!squadra) throw new Error('Squadra non trovata.');

  var righe = readAll_('INTERVENTI').filter(function (i) {
    if (i.squadraId !== squadraId) return false;
    if (i.stato !== STATO_INTERVENTO.PIANIFICATO && i.stato !== STATO_INTERVENTO.COMPLETATO) return false;
    var d = parseDateStr_(i.dataPianificata);
    return d && d >= dataInizio && d <= dataFine;
  }).sort(function (a, b) {
    if (a.dataPianificata !== b.dataPianificata) return a.dataPianificata < b.dataPianificata ? -1 : 1;
    return timeToMinutes_(a.oraPianificata) - timeToMinutes_(b.oraPianificata);
  });

  return {
    squadra: { id: squadra.id, nome: squadra.nome, colore: squadra.colore },
    interventi: righe.map(function (i) {
      return {
        id: i.id, _row: i._row, cliente: i.cliente, indirizzo: i.indirizzo, lat: i.lat, lng: i.lng,
        telefono: i.telefono, competenza: i.competenza, priorita: i.priorita, durataMinuti: i.durataMinuti,
        dataPianificata: i.dataPianificata, oraPianificata: i.oraPianificata, ordineTappa: i.ordineTappa,
        stato: i.stato, storiaSospensioni: i.storiaSospensioni, note: i.note,
        comune: i.comune, codEquipment: i.codEquipment, codiceEsterno: i.codiceEsterno,
        dataDispacciamento: i.dataDispacciamento, tipoAttivita: i.tipoAttivita,
        rapportoOraInizio: i.rapportoOraInizio, rapportoOraFine: i.rapportoOraFine,
        rapportoArticoli: i.rapportoArticoli, rapportoNote: i.rapportoNote, rapportoConcluso: i.rapportoConcluso,
        rapportoOraChiusura: i.rapportoOraChiusura, rapportoFirmaTecnico: i.rapportoFirmaTecnico,
        rapportoFirmaCliente: i.rapportoFirmaCliente, rapportoCompilatoIl: i.rapportoCompilatoIl,
        rapportoTipoIntervento: i.rapportoTipoIntervento, rapportoKmAndata: i.rapportoKmAndata,
        rapportoKmRitorno: i.rapportoKmRitorno, rapportoTempoTrasferimentoOre: i.rapportoTempoTrasferimentoOre,
        rapportoTempoTrasferimentoMinuti: i.rapportoTempoTrasferimentoMinuti,
        rapportoTempoTrasferimentoRitornoOre: i.rapportoTempoTrasferimentoRitornoOre,
        rapportoTempoTrasferimentoRitornoMinuti: i.rapportoTempoTrasferimentoRitornoMinuti,
        rapportoTecniciAggiuntivi: i.rapportoTecniciAggiuntivi,
        rapportoTecnicoNome: i.rapportoTecnicoNome, rapportoTecnicoCod: i.rapportoTecnicoCod,
        rapportoCliente: i.rapportoCliente, rapportoTelefono: i.rapportoTelefono,
        rapportoIndirizzo: i.rapportoIndirizzo, rapportoComune: i.rapportoComune,
        rapportoProvincia: i.rapportoProvincia, rapportoTipoImpianto: i.rapportoTipoImpianto,
        rapportoCodEquipment: i.rapportoCodEquipment, rapportoCausale: i.rapportoCausale,
        rapportoRichiestoDa: i.rapportoRichiestoDa, rapportoInData: i.rapportoInData,
        rapportoNumeroOrdine: i.rapportoNumeroOrdine, rapportoRegime: i.rapportoRegime
      };
    })
  };
}
