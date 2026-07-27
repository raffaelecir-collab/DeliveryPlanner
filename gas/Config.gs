/**
 * Configurazione centrale: nomi fogli, schema colonne, costanti applicative.
 * Lo SCHEMA guida sia la creazione dei fogli (Setup.gs) sia la lettura/scrittura
 * generica (SheetService.gs) sia la generazione automatica dei form lato client.
 */

var SHEET_NAMES = {
  SQUADRE: 'Squadre',
  ZONE: 'Zone',
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
  ANNULLATO: 'Annullato',
  NON_PIANIFICABILE: 'Non pianificabile'
};

var GIORNI_SETTIMANA = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

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
      { key: 'competenze', label: 'Competenze (separate da virgola)', type: 'text', help: 'Es: elettrico,idraulico' },
      { key: 'zoneCoperte', label: 'Zone Coperte (nomi separati da virgola)', type: 'text', help: 'Es: Nord,Centro' },
      { key: 'capacitaMinuti', label: 'Capacità Giornaliera (minuti)', type: 'number', default: 480 },
      { key: 'oraInizio', label: 'Ora Inizio (HH:mm)', type: 'text', default: '08:00' },
      { key: 'oraFine', label: 'Ora Fine (HH:mm)', type: 'text', default: '17:00' },
      { key: 'latBase', label: 'Lat Base (opzionale)', type: 'number' },
      { key: 'lngBase', label: 'Lng Base (opzionale)', type: 'number' },
      { key: 'colore', label: 'Colore', type: 'color', default: '#4285F4' },
      { key: 'attiva', label: 'Attiva', type: 'checkbox', default: true }
    ]
  },
  ZONE: {
    sheetName: SHEET_NAMES.ZONE,
    key: 'ZONE',
    label: 'Zone',
    idPrefix: 'ZN',
    fields: [
      { key: 'id', label: 'ID', type: 'text', readonly: true },
      { key: 'nome', label: 'Nome Zona', type: 'text', required: true },
      { key: 'lat', label: 'Lat Centro (opzionale)', type: 'number' },
      { key: 'lng', label: 'Lng Centro (opzionale)', type: 'number' },
      { key: 'note', label: 'Note', type: 'text' }
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
      { key: 'indirizzo', label: 'Indirizzo', type: 'text' },
      { key: 'zona', label: 'Zona', type: 'select', optionsFrom: 'ZONE', required: true },
      { key: 'lat', label: 'Lat (opzionale)', type: 'number' },
      { key: 'lng', label: 'Lng (opzionale)', type: 'number' },
      { key: 'competenza', label: 'Competenza Richiesta', type: 'text', help: 'Vuoto = qualsiasi squadra' },
      { key: 'priorita', label: 'Priorità', type: 'select', options: [PRIORITA.URGENTE, PRIORITA.ALTA, PRIORITA.NORMALE, PRIORITA.BASSA], default: PRIORITA.NORMALE },
      { key: 'durataMinuti', label: 'Durata Stimata (minuti)', type: 'number', default: 60 },
      { key: 'finestraInizio', label: 'Finestra Oraria - Inizio (HH:mm)', type: 'text', default: '00:00' },
      { key: 'finestraFine', label: 'Finestra Oraria - Fine (HH:mm)', type: 'text', default: '23:59' },
      { key: 'dataRichiesta', label: 'Non Prima Del (gg/mm/aaaa)', type: 'date' },
      { key: 'scadenza', label: 'Scadenza (gg/mm/aaaa)', type: 'date' },
      { key: 'stato', label: 'Stato', type: 'select', options: [STATO_INTERVENTO.DA_PIANIFICARE, STATO_INTERVENTO.PIANIFICATO, STATO_INTERVENTO.COMPLETATO, STATO_INTERVENTO.ANNULLATO, STATO_INTERVENTO.NON_PIANIFICABILE], default: STATO_INTERVENTO.DA_PIANIFICARE, readonly: true },
      { key: 'squadraId', label: 'Squadra Assegnata', type: 'select', optionsFrom: 'SQUADRE', readonly: true },
      { key: 'dataPianificata', label: 'Data Pianificata', type: 'date', readonly: true },
      { key: 'oraPianificata', label: 'Ora Pianificata', type: 'text', readonly: true },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'motivoNonPianificato', label: 'Motivo Mancata Pianificazione', type: 'text', readonly: true }
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
      { key: 'pianificati', label: 'Interventi Pianificati', type: 'number' },
      { key: 'nonPianificabili', label: 'Interventi Non Pianificabili', type: 'number' },
      { key: 'dettagli', label: 'Dettagli', type: 'text' }
    ]
  }
};

/** Valori di default delle regole di pianificazione (chiave/valore su foglio Regole). */
var REGOLE_DEFAULT = [
  { chiave: 'orizzonteGiorni', valore: '7', descrizione: 'Quanti giorni in avanti considerare quando si pianifica (a partire da oggi se non specificato un intervallo).' },
  { chiave: 'bufferViaggioMinuti', valore: '15', descrizione: 'Minuti di viaggio/setup stimati tra due interventi quando non sono note le coordinate.' },
  { chiave: 'velocitaMediaKmH', valore: '30', descrizione: 'Velocità media (km/h) usata per stimare il tempo di viaggio quando sono note le coordinate (per il clustering geografico).' },
  { chiave: 'pesoPrioritaUrgente', valore: '1000', descrizione: 'Peso assegnato alla priorità Urgente nella scelta dell\'ordine di pianificazione.' },
  { chiave: 'pesoPrioritaAlta', valore: '100', descrizione: 'Peso assegnato alla priorità Alta.' },
  { chiave: 'pesoPrioritaNormale', valore: '10', descrizione: 'Peso assegnato alla priorità Normale.' },
  { chiave: 'pesoPrioritaBassa', valore: '1', descrizione: 'Peso assegnato alla priorità Bassa.' },
  { chiave: 'giorniLavorativi', valore: 'Lun,Mar,Mer,Gio,Ven', descrizione: 'Giorni della settimana in cui è possibile pianificare interventi.' }
];
