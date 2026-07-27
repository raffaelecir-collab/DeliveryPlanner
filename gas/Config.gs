/**
 * Configurazione centrale: nomi fogli, schema colonne, costanti applicative.
 * Lo SCHEMA guida sia la creazione dei fogli (Setup.gs) sia la lettura/scrittura
 * generica (SheetService.gs) sia la generazione automatica dei form lato client.
 */

var SHEET_NAMES = {
  SQUADRE: 'Squadre',
  INTERVENTI: 'Interventi',
  REGOLE: 'Regole',
  LOG: 'LogPianificazione'
};

var PRIORITA = {
  URGENTE: 'Urgente',
  ALTA: 'Alta',
  NORMALE: 'Normale',
  BASSA: 'Bassa'
};

var STATO_INTERVENTO = {
  DA_PIANIFICARE: 'Da pianificare',
  PIANIFICATO: 'Pianificato',
  COMPLETATO: 'Completato',
  ANNULLATO: 'Annullato'
};

/**
 * Definizione campi per ciascun foglio. L'ordine dei campi determina
 * l'ordine delle colonne nel foglio (a partire dalla colonna A).
 */
var SCHEMA = {
  SQUADRE: {
    sheetName: SHEET_NAMES.SQUADRE,
    key: 'SQUADRE',
    label: 'Squadre',
    idPrefix: 'SQ',
    fields: [
      { key: 'id', label: 'ID', type: 'text', readonly: true },
      { key: 'nome', label: 'Nome Squadra', type: 'text', required: true },
      { key: 'competenze', label: 'Competenze (separate da virgola)', type: 'text', help: 'Es: elettrico,idraulico — usato solo come promemoria in fase di selezione.' },
      { key: 'indirizzoPartenza', label: 'Indirizzo di Partenza (inizio turno)', type: 'text', required: true, mapPreview: true, mapCoordFields: ['latPartenza', 'lngPartenza'] },
      { key: 'indirizzoRientro', label: 'Indirizzo di Rientro (fine turno)', type: 'text', help: 'Lascia vuoto se coincide con la partenza.', mapPreview: true, mapCoordFields: ['latRientro', 'lngRientro'] },
      { key: 'latPartenza', label: 'Lat Partenza', type: 'number', readonly: true },
      { key: 'lngPartenza', label: 'Lng Partenza', type: 'number', readonly: true },
      { key: 'latRientro', label: 'Lat Rientro', type: 'number', readonly: true },
      { key: 'lngRientro', label: 'Lng Rientro', type: 'number', readonly: true },
      { key: 'oraInizio', label: 'Ora Inizio Turno (HH:mm)', type: 'text', default: '08:00', help: 'Il viaggio dalla partenza alla prima tappa non è conteggiato in questo orario.' },
      { key: 'oraFine', label: 'Ora Fine Turno (HH:mm)', type: 'text', default: '17:00', help: 'Il viaggio dall\'ultima tappa al rientro non è conteggiato in questo orario.' },
      { key: 'pausaPranzoInizio', label: 'Pausa Pranzo - Inizio (HH:mm)', type: 'text', help: 'Lascia vuoto se la squadra non ha una pausa fissa.' },
      { key: 'pausaPranzoFine', label: 'Pausa Pranzo - Fine (HH:mm)', type: 'text' },
      { key: 'colore', label: 'Colore', type: 'color', default: '#4285F4' },
      { key: 'attiva', label: 'Attiva', type: 'checkbox', default: true }
    ]
  },
  INTERVENTI: {
    sheetName: SHEET_NAMES.INTERVENTI,
    key: 'INTERVENTI',
    label: 'Interventi',
    idPrefix: 'IN',
    fields: [
      { key: 'id', label: 'ID', type: 'text', readonly: true },
      { key: 'cliente', label: 'Cliente', type: 'text', required: true },
      { key: 'indirizzo', label: 'Indirizzo', type: 'text', required: true, mapPreview: true, mapCoordFields: ['lat', 'lng'] },
      { key: 'lat', label: 'Lat', type: 'number', readonly: true },
      { key: 'lng', label: 'Lng', type: 'number', readonly: true },
      { key: 'competenza', label: 'Competenza Richiesta', type: 'text', help: 'Vuoto = qualsiasi squadra' },
      { key: 'priorita', label: 'Priorità', type: 'select', options: [PRIORITA.URGENTE, PRIORITA.ALTA, PRIORITA.NORMALE, PRIORITA.BASSA], default: PRIORITA.NORMALE },
      { key: 'durataMinuti', label: 'Durata Stimata (minuti)', type: 'number', default: 60 },
      { key: 'finestraInizio', label: 'Finestra Oraria - Inizio (HH:mm)', type: 'text', default: '00:00' },
      { key: 'finestraFine', label: 'Finestra Oraria - Fine (HH:mm)', type: 'text', default: '23:59' },
      { key: 'dataRichiesta', label: 'Non Prima Del (gg/mm/aaaa)', type: 'date' },
      { key: 'scadenza', label: 'Scadenza (gg/mm/aaaa)', type: 'date' },
      { key: 'stato', label: 'Stato', type: 'select', options: [STATO_INTERVENTO.DA_PIANIFICARE, STATO_INTERVENTO.PIANIFICATO, STATO_INTERVENTO.COMPLETATO, STATO_INTERVENTO.ANNULLATO], default: STATO_INTERVENTO.DA_PIANIFICARE, readonly: true },
      { key: 'squadraId', label: 'Squadra Assegnata', type: 'select', optionsFrom: 'SQUADRE', readonly: true },
      { key: 'dataPianificata', label: 'Data Pianificata', type: 'date', readonly: true },
      { key: 'oraPianificata', label: 'Ora Pianificata', type: 'text', readonly: true },
      { key: 'ordineTappa', label: 'Ordine nel Percorso', type: 'number', readonly: true },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'motivoNonPianificato', label: 'Nota Pianificazione', type: 'text', readonly: true }
    ]
  },
  REGOLE: {
    sheetName: SHEET_NAMES.REGOLE,
    key: 'REGOLE',
    label: 'Regole',
    fields: [
      { key: 'chiave', label: 'Chiave', type: 'text' },
      { key: 'valore', label: 'Valore', type: 'text' },
      { key: 'descrizione', label: 'Descrizione', type: 'text' }
    ]
  },
  LOG: {
    sheetName: SHEET_NAMES.LOG,
    key: 'LOG',
    label: 'Log Pianificazione',
    fields: [
      { key: 'timestamp', label: 'Data/Ora Esecuzione', type: 'text' },
      { key: 'utente', label: 'Utente', type: 'text' },
      { key: 'squadra', label: 'Squadra', type: 'text' },
      { key: 'giorno', label: 'Giorno Pianificato', type: 'text' },
      { key: 'tappe', label: 'Numero Tappe', type: 'number' },
      { key: 'dettagli', label: 'Dettagli', type: 'text' }
    ]
  }
};

/** Valori di default delle regole del motore di ottimizzazione percorso (chiave/valore su foglio Regole). */
var REGOLE_DEFAULT = [
  { chiave: 'bufferSetupMinuti', valore: '10', descrizione: 'Minuti fissi di parcheggio/setup aggiunti ad ogni spostamento tra due tappe, oltre al tempo di viaggio.' },
  { chiave: 'velocitaMediaKmH', valore: '30', descrizione: 'Velocità media (km/h) usata per stimare il tempo di viaggio quando il calcolo reale (Google Maps) non è disponibile.' },
  { chiave: 'pesoPrioritaUrgente', valore: '1000', descrizione: 'Peso della priorità Urgente, usato come criterio secondario nella costruzione iniziale del percorso.' },
  { chiave: 'pesoPrioritaAlta', valore: '100', descrizione: 'Peso della priorità Alta.' },
  { chiave: 'pesoPrioritaNormale', valore: '10', descrizione: 'Peso della priorità Normale.' },
  { chiave: 'pesoPrioritaBassa', valore: '1', descrizione: 'Peso della priorità Bassa.' }
];
