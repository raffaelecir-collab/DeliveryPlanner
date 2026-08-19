/**
 * Configurazione centrale: nomi fogli, schema colonne, costanti applicative.
 * Lo SCHEMA guida sia la creazione dei fogli (Setup.gs) sia la lettura/scrittura
 * generica (SheetService.gs) sia la generazione automatica dei form lato client.
 */

var SHEET_NAMES = {
  SQUADRE: 'Squadre',
  INTERVENTI: 'Interventi',
  REGOLE: 'Regole',
  LOG: 'LogPianificazione',
  NOTIFICHE: 'Notifiche',
  LISTINO: 'Listino'
};

var PRIORITA = {
  URGENTE: 'Urgente',
  ALTA: 'Alta',
  NORMALE: 'Normale',
  BASSA: 'Bassa'
};

/**
 * Ruoli account: Admin ha accesso completo; Cliente vede solo il tab Interventi e può solo
 * aggiungere note, sospendere o annullare gli interventi (mai crearli/modificarli/eliminarli/
 * pianificarli/importarli); Squadra vede solo la PROPRIA programmazione (elenco/agenda/mappa) e
 * può solo aggiungere note o segnare un proprio intervento come completato. Il ruolo si determina
 * dall'email dell'account Google che esegue la Web App: confrontata con la regola "emailClienti"
 * per il Cliente, con il campo "emailSquadra" di ciascuna Squadra per il ruolo Squadra (vedi
 * Auth.gs).
 */
var RUOLO = { ADMIN: 'Admin', CLIENTE: 'Cliente', SQUADRA: 'Squadra' };

var STATO_INTERVENTO = {
  DA_PIANIFICARE: 'Da pianificare',
  PIANIFICATO: 'Pianificato',
  COMPLETATO: 'Completato',
  ANNULLATO: 'Annullato',
  SOSPESO_YS: 'Sospeso - ys',
  SOSPESO_ZP: 'Sospeso - zp',
  SOSPESO_ZC: 'Sospeso - zc'
};

/** I tre stati di sospensione: un intervento in uno di questi non viene mai proposto dalla
 *  pianificazione automatica né dalla selezione manuale (solo "Da pianificare" è candidabile). */
var STATI_SOSPENSIONE = [STATO_INTERVENTO.SOSPESO_YS, STATO_INTERVENTO.SOSPESO_ZP, STATO_INTERVENTO.SOSPESO_ZC];
function isStatoSospeso_(stato) { return STATI_SOSPENSIONE.indexOf(stato) !== -1; }

/** Abbreviazioni giorno della settimana indicizzate come Date.getDay() (0 = Domenica). */
var GIORNI_SETTIMANA = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

/**
 * Tipi di attività riconosciuti (codici Sicuritalia, colonna "Tipo di ordine" del tracking
 * esterno importato — vedi Import.gs): usati come opzioni del campo "Tipo Attività" sugli
 * Interventi e per raggruppare le metriche del tab Analysis. Una riga importata il cui codice non
 * corrisponde a nessuno di questi diventa "Altro". Il significato di ciascun codice è in
 * LEGENDA_TIPO_ATTIVITA_, mostrato lato client da un pulsante "Legenda" accanto al campo.
 */
var TIPI_ATTIVITA_NOTI = ['SM01', 'SM02', 'SM03', 'SM04', 'SM05'];
var TIPO_ATTIVITA_VUOTO = 'Intervento a vuoto';
var TIPO_ATTIVITA_ALTRO = 'Altro';

/** Significato esteso di ciascun codice Tipo Attività, mostrato in una legenda lato client. */
var LEGENDA_TIPO_ATTIVITA_ = {
  SM01: 'Installazione',
  SM02: 'Manutenzione Correttiva',
  SM03: 'Manutenzione Predittiva',
  SM04: 'Smontaggio',
  SM05: 'Sopralluogo'
};

/**
 * Giorni lavorativi aggiunti a "Data Dispacciamento" per calcolare la Scadenza automatica di un
 * Intervento (vedi calcolaScadenzaAutomatica_ in Interventions.gs), per Tipo Attività: SM01/SM04/
 * SM05 e SM03 sono qui solo per riferimento, la differenza di comportamento (SM03 è solo un
 * DEFAULT, mai più ricalcolato una volta impostato/modificato) è in calcolaScadenzaAutomatica_
 * stesso, non in questa mappa. "Altro", "Intervento a vuoto" e nessun tipo scelto non compaiono
 * qui: per quelli la Scadenza resta sempre interamente manuale.
 */
var GIORNI_LAVORATIVI_SCADENZA_ = { SM01: 7, SM02: 3, SM03: 90, SM04: 7, SM05: 7 };

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
      { key: 'competenze', label: 'Competenze (Tipi Attività)', type: 'tipiAttivita', options: TIPI_ATTIVITA_NOTI, help: 'Tipi Attività (SM01-SM05) per cui la squadra è competente: vincolo rigido, come per la vecchia "Competenza Richiesta" testuale — alla squadra vengono assegnati (a mano o in automatico) solo interventi di uno di questi tipi. Gli interventi "Intervento a vuoto", "Altro" o senza Tipo Attività scelto restano invece assegnabili a QUALSIASI squadra, indipendentemente da questa selezione. Nessuna selezione = nessun vincolo, la squadra copre qualsiasi Tipo Attività.' },
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
      { key: 'attiva', label: 'Attiva', type: 'checkbox', default: true },
      { key: 'giorniIndisponibili', label: 'Giorni Settimanali Non Disponibili', type: 'giorni', help: 'Oltre ai giorni lavorativi generali (impostati in Regole), seleziona eventuali giorni della settimana in cui QUESTA squadra in particolare non è disponibile (es. part-time). Nessuna selezione = segue il calendario standard.' },
      { key: 'feriePeriodi', label: 'Periodi di Ferie/Assenza', type: 'ferie', help: 'Intervalli di date (Dal/Al) in cui la squadra è completamente non disponibile: durante questi periodi non le viene assegnato alcun intervento, né manualmente né nella pianificazione automatica.' },
      { key: 'produzioneTarget', label: 'Target Produzione Giornaliera (€)', type: 'number', help: 'Ricavo giornaliero che la squadra dovrebbe idealmente raggiungere. Le assegnazioni tengono conto del ricavo di ogni intervento (tra gli altri fattori) per avvicinarsi a questo valore, ma continuano comunque a riempire tutte le ore disponibili del turno anche oltre il target. Lascia vuoto se non vuoi tracciare un target per questa squadra.' },
      { key: 'emailSquadra', label: 'Email Account Squadra', type: 'text', help: 'Email (una o più, separate da virgola) dell\'account/i Google autorizzati a vedere SOLO la programmazione di QUESTA squadra (tab dedicato, elenco/agenda/mappa): può aggiungere note e segnare i propri interventi come completati, nient\'altro. Lascia vuoto per non dare accesso a nessuno con questo ruolo per questa squadra.' }
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
      { key: 'competenza', label: 'Competenza Richiesta (legacy)', type: 'text', help: 'Campo libero, non più usato per vincolare l\'assegnazione alle squadre: quel vincolo ora si basa sul Tipo Attività (vedi campo "Competenze" della Squadra). Lasciato per compatibilità con note già inserite in passato.' },
      { key: 'priorita', label: 'Priorità', type: 'select', options: [PRIORITA.URGENTE, PRIORITA.ALTA, PRIORITA.NORMALE, PRIORITA.BASSA], default: PRIORITA.NORMALE, help: 'Per i Tipi Attività SM01-SM05 con una Scadenza si aggiorna da sola in base ai giorni lavorativi rimanenti (scaduta o ≤1gg: Urgente · ≤3gg: Alta · ≤7gg: Normale · oltre: Bassa): puoi comunque forzarla qui a un valore diverso, da quel momento resta quella scelta e non viene più sovrascritta in automatico.' },
      { key: 'prioritaManuale', label: 'Priorità Manuale', type: 'checkbox', default: false, readonly: true, help: 'Impostato automaticamente non appena la Priorità viene cambiata a mano su un intervento altrimenti automatico: da quel momento non viene più ricalcolata in automatico.' },
      { key: 'durataMinuti', label: 'Durata Stimata (minuti)', type: 'number', default: 60 },
      { key: 'finestraInizio', label: 'Finestra Oraria - Inizio (HH:mm)', type: 'text', default: '00:00' },
      { key: 'finestraFine', label: 'Finestra Oraria - Fine (HH:mm)', type: 'text', default: '23:59' },
      { key: 'dataRichiesta', label: 'Non Prima Del (gg/mm/aaaa)', type: 'date', help: 'Impostarla (o cambiarla) sospende automaticamente l\'intervento in stato "Sospeso - zc" con una nota "Cliente chiede dopo <data>" (libera l\'eventuale squadra/data/ora già assegnate): la sospensione termina da sola, tornando "Da pianificare", non appena questa data viene raggiunta — oppure subito se il campo viene svuotato a mano.' },
      { key: 'scadenza', label: 'Scadenza (gg/mm/aaaa)', type: 'date', help: 'SM01/SM04/SM05: Data Dispacciamento + 7 giorni lavorativi · SM02: +3 giorni lavorativi — calcolate in automatico, non modificabili qui. SM03: +90 giorni lavorativi di default, ma modificabile liberamente (una volta impostata, un successivo import non la sovrascrive più). Per "Altro", "Intervento a vuoto" o nessun Tipo Attività scelto resta interamente manuale/facoltativa.' },
      { key: 'stato', label: 'Stato', type: 'select', options: [STATO_INTERVENTO.DA_PIANIFICARE, STATO_INTERVENTO.PIANIFICATO, STATO_INTERVENTO.COMPLETATO, STATO_INTERVENTO.ANNULLATO, STATO_INTERVENTO.SOSPESO_YS, STATO_INTERVENTO.SOSPESO_ZP, STATO_INTERVENTO.SOSPESO_ZC], default: STATO_INTERVENTO.DA_PIANIFICARE, readonly: true },
      { key: 'squadraId', label: 'Squadra Assegnata', type: 'select', optionsFrom: 'SQUADRE', allowEmptyOption: true, help: 'Cambiare squadra qui sposta l\'intervento senza ricalcolare automaticamente l\'ordine/orario del percorso: verificare poi la programmazione della nuova squadra.' },
      { key: 'dataPianificata', label: 'Data Pianificata', type: 'date', readonly: true },
      { key: 'oraPianificata', label: 'Ora Pianificata', type: 'text', readonly: true },
      { key: 'ordineTappa', label: 'Ordine nel Percorso', type: 'number', readonly: true },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'motivoNonPianificato', label: 'Nota Pianificazione', type: 'text', readonly: true },
      { key: 'telefono', label: 'Telefono', type: 'text' },
      { key: 'ricavo', label: 'Ricavo (€)', type: 'number', default: 0, readonly: true, mostraInForm: true, help: 'Somma delle voci di listino selezionate: si modifica solo con "Componi Ricavo" (pulsante nell\'elenco Interventi), non da qui. Usato per calcolare la produzione (ricavo totale) di ciascuna squadra rispetto al proprio target di produzione giornaliera.' },
      { key: 'vociListino', label: 'Voci Listino Selezionate', type: 'text', readonly: true, help: 'Elenco (voce e quantità) delle righe di listino scelte per comporre il Ricavo di questo intervento. Si modifica solo tramite "Componi Ricavo", non da qui.' },
      { key: 'codiceEsterno', label: 'Codice Esterno (Ods)', type: 'text', help: 'Colonna "Ordine" del file Excel da cui è stato importato l\'intervento. La riconciliazione con un import successivo usa anche il campo "Op." (Operazione): re-importando la stessa coppia Ordine+Operazione, questo intervento viene aggiornato invece di duplicato. Modificabile anche a mano.' },
      { key: 'richiestaAcquisto', label: 'Richiesta d\'Acquisto', type: 'text', readonly: true, mostraInForm: true, help: 'Colonna "Richiesta d\'acquisto" del file Excel importato.' },
      { key: 'codCliente', label: 'Cod. Cliente', type: 'text', readonly: true, mostraInForm: true, help: 'Codice cliente del file Excel importato.' },
      { key: 'codEquipment', label: 'Cod. Equipment', type: 'text', readonly: true, mostraInForm: true, help: 'Codice equipment del file Excel importato.' },
      { key: 'prezzo', label: 'Prezzo Importato (€)', type: 'number', readonly: true, mostraInForm: true, help: 'Prezzo (colonna "Prezzo") del file Excel importato: se il Ricavo composto è inferiore a questo valore, viene generata una notifica all\'Admin per richiedere l\'adeguamento del prezzo di listino.' },
      { key: 'nonAutomatizzabileData', label: 'Escluso da pianificazione automatica per il', type: 'date', readonly: true, help: 'Impostato automaticamente da "Rimuovi" (tab Programmazione): per questa data, l\'intervento non viene riproposto da "Riempi buco" o dalla pianificazione automatica su intervallo — resta comunque pianificabile a mano, anche per la stessa data. Si azzera da solo non appena l\'intervento viene ripianificato (a mano o in automatico).' },
      { key: 'storiaSospensioni', label: 'Storico Note e Sospensioni', type: 'text', readonly: true, help: 'Cronologia (data, autore Admin/Cliente, eventuale stato, nota) di ogni nota libera o sospensione/annullamento registrata su questo intervento, a mano (da Admin o da Cliente) o da import.' },
      { key: 'operatore', label: 'Op.', type: 'text', help: 'Sigla o nome dell\'operatore, per uso libero.' },
      { key: 'dataDispacciamento', label: 'Data Dispacciamento', type: 'date', help: 'Data in cui l\'intervento è stato ricevuto/dispacciato: per gli interventi importati è la "Data Disp." del tracking esterno; per quelli creati a mano nella Web App viene impostata di default alla data odierna al primo salvataggio (modificabile). Usata come base per le metriche del tab Analysis (tempi di lavorazione, nuovi interventi dispacciati nel tempo).' },
      { key: 'tipoAttivita', label: 'Tipo Attività', type: 'select', options: TIPI_ATTIVITA_NOTI.concat([TIPO_ATTIVITA_VUOTO, TIPO_ATTIVITA_ALTRO]), allowEmptyOption: true, help: 'Categoria dell\'intervento (SM01-SM05, vedi pulsante Legenda): per quelli importati viene dedotta automaticamente dalla colonna "Tipo di ordine" del tracking esterno; per quelli creati a mano va scelta qui (facoltativo). Determina anche il calcolo automatico di Scadenza e Priorità (vedi quei campi). Usata per raggruppare le metriche del tab Analysis.' },
      { key: 'comune', label: 'Comune', type: 'text', help: 'Comune dell\'indirizzo (per gli interventi importati, dedotto dalla colonna "Località" del tracking esterno): usato per la distribuzione geografica nel tab Analysis. Per gli interventi creati a mano è facoltativo.' },
      { key: 'primoEventoData', label: 'Data Primo Evento', type: 'date', readonly: true, help: 'Impostata automaticamente la prima volta che succede qualcosa su questo intervento dopo la creazione (nota, sospensione, cambio stato...): usata per calcolare il "Tempo di prima lavorazione" nel tab Analysis.' },
      { key: 'dataPrimoPianificato', label: 'Data Primo Pianificato', type: 'date', readonly: true, help: 'Impostata automaticamente la prima volta che l\'intervento passa a stato "Pianificato": usata per calcolare il "Tempo di lavorazione medio" nel tab Analysis.' },
      { key: 'dataCompletamento', label: 'Data Completamento', type: 'date', readonly: true, help: 'Impostata automaticamente quando l\'intervento viene segnato come "Completato": usata per calcolare il "Tempo di completamento" nel tab Analysis.' },
      { key: 'driveFolderId', label: 'ID Cartella Documenti', type: 'text', readonly: true, help: 'ID della sottocartella Google Drive (dentro la cartella configurata in Regole) dove sono archiviati i documenti allegati a questo intervento. Creata e gestita automaticamente al primo caricamento di un documento.' },
      { key: 'chiaveSecondariaImport', label: 'Chiave Secondaria Import', type: 'text', readonly: true, help: 'Usata solo internamente per riconoscere una riga già importata da fonti esterne il cui Codice Esterno da solo non è univoco (es. import Google Sheet Veneto, ImportVeneto.gs: colonna T). Nessun altro significato, non modificabile.' }
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
  },
  /**
   * Log interno (non un tab dell'interfaccia) che alimenta la campanella notifiche lato
   * Admin/Cliente (Notifiche.gs): una riga per ciascun destinatario di ciascun evento su un
   * intervento (nuova nota, cambio stato, riassegnazione squadra...). Non esposto nello
   * schemaClient generico (vedi Code.gs) perché non ha un form di modifica dedicato.
   */
  NOTIFICHE: {
    sheetName: SHEET_NAMES.NOTIFICHE,
    key: 'NOTIFICHE',
    label: 'Notifiche',
    idPrefix: 'NF',
    fields: [
      { key: 'id', label: 'ID', type: 'text', readonly: true },
      { key: 'timestamp', label: 'Data/Ora', type: 'text' },
      { key: 'interventoId', label: 'Intervento ID', type: 'text' },
      { key: 'interventoRow', label: 'Intervento Riga', type: 'number' },
      { key: 'codiceEsterno', label: 'Ods', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'text' },
      { key: 'evento', label: 'Evento', type: 'text' },
      { key: 'destinatario', label: 'Destinatario', type: 'text' },
      { key: 'letto', label: 'Letto', type: 'checkbox', default: false }
    ]
  },
  /**
   * Listino prezzi concordato (Sicuritalia): usato lato Admin per comporre il Ricavo (€) di un
   * Intervento selezionando una o più voci con quantità (vedi "Componi Ricavo" nel tab
   * Interventi). Chiave naturale "voce" (nessun id auto-generato), come per REGOLE.
   */
  LISTINO: {
    sheetName: SHEET_NAMES.LISTINO,
    key: 'LISTINO',
    label: 'Listino',
    fields: [
      { key: 'voce', label: 'Voce', type: 'text', required: true },
      { key: 'descrizione', label: 'Descrizione', type: 'text' },
      { key: 'prezzo', label: 'Ricavo (€)', type: 'number', default: 0 }
    ]
  }
};

/**
 * Seed iniziale del foglio Listino (rev.01 concordata con Sicuritalia), inserito automaticamente
 * da inizializzaListinoDefault_() (Setup.gs) solo se il foglio è vuoto. Modificabile liberamente
 * in seguito dal tab Listino: questa costante non viene più riletta dopo il primo avvio.
 */
var LISTINO_DEFAULT = [
  { voce: 'CO-RE-10', descrizione: 'Sost. batterie (tutti i tipi) da 1 a 10', prezzo: 50 },
  { voce: 'CO-RE-15', descrizione: 'Sost. batterie (tutti i tipi) da 11 a Oltre', prezzo: 60 },
  { voce: 'CO-RE-20', descrizione: 'Prove di funzionamento/ Regolazione sensori /Cambio codici ed eventuali', prezzo: 50 },
  { voce: 'CO-RE-30', descrizione: 'Regolazione telecamere / Scarico e salvataggio immagini da sistemi TVCC', prezzo: 60 },
  { voce: 'CO-RE-40', descrizione: 'Sost., ricablaggio o riposizionamento sensori, tastiere, router, hd, centrali wireless/cablate e periferiche', prezzo: 70 },
  { voce: 'CO-RE-50', descrizione: 'Sost., ricablaggio o riposizionamento barriere interne ed esterne, telecamere fisse o mobili (dome) con altezza sup. 3 mt (IMPIEGO DI 2 PERSONE)', prezzo: 120 },
  { voce: 'E-KM01', descrizione: 'Rimborso chilometrico (Max 100KM A+R nella provincia di assegnazione)', prezzo: 0.5 },
  { voce: 'EMAT-1', descrizione: 'Noleggio piattaforme aeree e/o forniture materiali', prezzo: 1 },
  { voce: 'E-ORE01', descrizione: 'Ore di lavoro / viaggio tecnico Senior (08:00 - 18:00 da lun a ven)', prezzo: 26 },
  { voce: 'E-ORE02', descrizione: 'Ore di lavoro / viaggio tecnico Junior (08:00 - 18:00 da lun a ven)', prezzo: 20 },
  { voce: 'E-ORE03', descrizione: 'Ore di lavoro / viaggio tecnico Senior (18:00 - 22:00 da lun. a ven. e sab. tutto il giorno)', prezzo: 31.2 },
  { voce: 'E-ORE04', descrizione: 'Ore di lavoro / viaggio tecnico Junior (18:00 - 22:00 da lun. a ven. e sab. tutto il giorno)', prezzo: 24 },
  { voce: 'E-ORE05', descrizione: 'Ore di lavoro / viaggio tecnico Senior (22:00 - 08:00 da lun. a sab.)', prezzo: 33.8 },
  { voce: 'E-ORE06', descrizione: 'Ore di lavoro / viaggio tecnico Junior (22:00 - 08:00 da lun. a sab.)', prezzo: 26 },
  { voce: 'E-ORE07', descrizione: 'Ore di lavoro / viaggio tecnico Senior (00:00 - 24:00 domenica e festivi)', prezzo: 39 },
  { voce: 'E-ORE08', descrizione: 'Ore di lavoro / viaggio tecnico Junior (00:00 - 24:00 domenica e festivi)', prezzo: 30 },
  { voce: 'E-SQ-GG-10', descrizione: 'Squadra a giornata: (1 Senior e 1 Junior)', prezzo: 390 },
  { voce: 'E-TEC-GG-20', descrizione: 'Tecnico Senior a giornata', prezzo: 240 },
  { voce: 'E-VUOTO', descrizione: 'Intervento a vuoto', prezzo: 35 },
  { voce: 'MP-00-10', descrizione: 'Manutenzione Preventiva 0-10 componenti', prezzo: 50 },
  { voce: 'MP-11-20', descrizione: 'Manutenzione Preventiva 11-20 componenti', prezzo: 60 },
  { voce: 'MP-21-30', descrizione: 'Manutenzione Preventiva 21-30 componenti', prezzo: 70 },
  { voce: 'NU-IN-10', descrizione: 'Nuove inst. - Periferica nuova: ponte radio / combinatore Digitale / combinatore GPRS/LAN', prezzo: 90 },
  { voce: 'SAP.10000134', descrizione: 'Inst. Tag di prossimità 13,56MHz (1 pezzo)', prezzo: 2.5 },
  { voce: 'SAP.10004246', descrizione: 'Inst. Sirena interna radio bidi 868 Risco', prezzo: 15 },
  { voce: 'SAP.10004379', descrizione: 'Inst. Rivelatore PIR pet radio bidi Risco', prezzo: 15 },
  { voce: 'SAP.10004380', descrizione: 'Inst. Sensore PIR doppia tecnologia anti mask', prezzo: 15 },
  { voce: 'SAP.10004381', descrizione: 'Inst. Contatto magnetico radio bidi bianco Risco', prezzo: 15 },
  { voce: 'SAP.10004384', descrizione: 'Inst. Sensore fumo radio', prezzo: 15 },
  { voce: 'SAP.10004387', descrizione: 'Inst. Sensore allagamento radio', prezzo: 15 },
  { voce: 'SAP.10004860', descrizione: 'Inst. Rivelatore PIR con foto pet radio Risco', prezzo: 15 },
  { voce: 'SAP.10005201', descrizione: 'Inst. Sensore sismico radio con contatto monodirezionale', prezzo: 20 },
  { voce: 'SAP.10006533', descrizione: 'Inst. Telecomando bidi 4 tasti r.c. 868mhz', prezzo: 6 },
  { voce: 'SAP.10006861', descrizione: 'Inst. Sensore tenda radio da esterno', prezzo: 20 },
  { voce: 'SAP.10008273', descrizione: 'Inst. Ricevitore radio 32 zone e/canale video', prezzo: 20 },
  { voce: 'SAP.10008425', descrizione: 'Inst. Sensore PIR radio Piccolo', prezzo: 12 },
  { voce: 'SAP.10008656', descrizione: 'Inst. Wicomm pro tastiera panda radio + prox', prezzo: 20 },
  { voce: 'SAP.10009146', descrizione: 'Inst. Wicomm pro modulo wi-fi', prezzo: 10 },
  { voce: 'SAP.10009147', descrizione: 'Inst. Wicomm pro modulo gsm 4g', prezzo: 20 },
  { voce: 'SAP.10009149', descrizione: 'Inst. Ripetitore bidirezionale', prezzo: 20 },
  { voce: 'SAP.10009202', descrizione: 'Inst. Kit gusci marroni per trasmettitori X73', prezzo: 2 },
  { voce: 'SAP.10009209', descrizione: 'Inst. Sirena esterna lumin8 radio bidi', prezzo: 40 },
  { voce: 'SAP.10009465', descrizione: 'Inst. Contatto magnetico radio bidi Slim bianco', prezzo: 12 },
  { voce: 'SAP.10009466', descrizione: 'Inst. Kit gusci marroni per trasmettitori x78', prezzo: 2 },
  { voce: 'SAP.10009467', descrizione: 'Inst. Wicomm pro centrale 868mhz con batt tamp', prezzo: 100 },
  { voce: 'SAP.10009468', descrizione: 'Inst. Tags di prossimità 13,56mhz (2 pezzi)', prezzo: 5 },
  { voce: 'SAP.10010938', descrizione: 'Inst. LightSYS Air tastiera Panda radio con lettore prossimità', prezzo: 20 },
  { voce: 'SAP.10011428', descrizione: 'Inst. LightSYS Air centrale 868MHz con batteria tampone', prezzo: 100 },
  { voce: 'SAP.10011429', descrizione: 'Inst. LightSYS Air modulo GSM 4G', prezzo: 20 },
  { voce: 'SAP.20000161', descrizione: 'Inst. Contatto magnetico radio bidi marrone', prezzo: 17 },
  { voce: 'SAP.20000165', descrizione: 'Inst. Kit Wicomm pro Wifi 4g (centrale tastiera 2 PIR/PIR cam pet interno 4 tag)', prezzo: 170 },
  { voce: 'SAP.20000168', descrizione: 'Inst. Contatto magnetico radio bidi Slim marrone', prezzo: 14 },
  { voce: 'SAP.20000170', descrizione: 'Inst. Rivelatore DT radio da esterno con fotocamera', prezzo: 25 },
  { voce: 'SAP.20000196', descrizione: 'Inst. Kit antintrusione radio residenziale (centrale, tastiera, 2 tag, 1 sismico con cm, 1 PIR cam Pet interno, 1 telecamera Wi-Fi)', prezzo: 222 },
  { voce: 'SM-10', descrizione: 'Smontaggio Impianto Wireless o Cablato con massimo 10 componenti *', prezzo: 50 },
  { voce: 'SM-20', descrizione: 'Smontaggio Impianto Wireless o Cablato con oltre 11 componenti *', prezzo: 60 },
  { voce: 'SURVEY', descrizione: 'Sopralluogo', prezzo: 50 }
];

/** Etichetta della sezione (vedi campo `categoria` sotto) sotto cui compaiono nel tab Regole le
 *  liste email della mail automatica "è stato pianificato" (vedi inviaMailPianificazione in
 *  Interventions.gs). */
var CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_ = 'Mail "intervento pianificato" (SICURITALIA)';

/**
 * Valori di default delle regole del motore di ottimizzazione percorso (chiave/valore su
 * foglio Regole). Il campo `tipo` guida solo la resa del controllo nel form lato client
 * (numero vs selettore giorni della settimana): non viene salvato come colonna a sé sul
 * foglio, che resta un semplice elenco chiave/valore/descrizione. Il campo facoltativo
 * `categoria`, quando presente, raggruppa visivamente più regole sotto un'intestazione comune
 * nel tab Regole (vedi listaRegole in Rules.gs e renderRegole in JS.html) — anch'esso non
 * persistito come colonna sul foglio.
 */
var REGOLE_DEFAULT = [
  { chiave: 'giorniLavorativi', valore: 'Lun,Mar,Mer,Gio,Ven', tipo: 'giorni', descrizione: 'Giorni della settimana in cui la pianificazione automatica su intervallo può assegnare interventi (i giorni non selezionati vengono saltati).' },
  { chiave: 'bufferSetupMinuti', valore: '10', tipo: 'numero', descrizione: 'Minuti fissi di parcheggio/setup aggiunti ad ogni spostamento tra due tappe, oltre al tempo di viaggio.' },
  { chiave: 'pausaTolleranzaMinuti', valore: '15', tipo: 'numero', descrizione: 'Minuti di sconfinamento nella pausa pranzo tollerati per un intervento già in corso quando inizia la pausa: entro questa soglia l\'intervento prosegue senza interruzioni. Oltre la soglia, la pausa viene inserita per intero (il tecnico si ferma e il completamento dell\'intervento, e delle tappe successive, slitta in avanti di conseguenza). Con 0, qualunque sconfinamento inserisce subito la pausa.' },
  { chiave: 'velocitaMediaKmH', valore: '30', tipo: 'numero', descrizione: 'Velocità media (km/h) usata per stimare il tempo di viaggio quando il calcolo reale (Google Maps) non è disponibile.' },
  { chiave: 'tempoViaggioMassimoMinuti', valore: '90', tipo: 'numero', descrizione: 'Minuti massimi di viaggio TRA le tappe (non conta il tragitto dalla partenza alla prima tappa né quello dall\'ultima tappa al rientro) ammessi in una singola giornata per una squadra: superata questa soglia, un intervento altrimenti raggiungibile viene comunque escluso da quella giornata, per evitare percorsi che mescolano zone troppo lontane tra loro (es. Cortina d\'Ampezzo e Vicenza nello stesso giro) solo per riempire ore o inseguire il ricavo. Con 0 non c\'è alcun limite.' },
  { chiave: 'pesoPrioritaUrgente', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la priorità Urgente nella scelta di quali interventi includere per primi, in percentuale (0-100): 100% è l\'intensità raccomandata di default, 0% disattiva completamente questo fattore per la priorità Urgente.' },
  { chiave: 'pesoPrioritaAlta', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la priorità Alta, in percentuale (0-100): 100% è l\'intensità raccomandata di default, 0% la disattiva.' },
  { chiave: 'pesoPrioritaNormale', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la priorità Normale, in percentuale (0-100): 100% è l\'intensità raccomandata di default, 0% la disattiva.' },
  { chiave: 'pesoPrioritaBassa', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la priorità Bassa, in percentuale (0-100): 100% è l\'intensità raccomandata di default, 0% la disattiva.' },
  { chiave: 'densitaRaggioMinuti', valore: '8', tipo: 'numero', descrizione: 'Entro quanti minuti di viaggio due interventi sono considerati "nella stessa area" ai fini del punteggio di densità.' },
  { chiave: 'pesoDensita', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la densità di un\'area (numero di altri interventi vicini) nello scegliere da quale zona iniziare il percorso, in percentuale (0-100): aree con più interventi vicini vengono preferite per massimizzare quanti interventi si riescono a completare. 100% è l\'intensità raccomandata di default, 0% disattiva questo fattore.' },
  { chiave: 'pesoProssimitaBase', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa la vicinanza alla base della squadra nello scegliere da dove iniziare il percorso, a parità di priorità/densità, in percentuale (0-100). 100% è l\'intensità raccomandata di default, 0% disattiva questo fattore.' },
  { chiave: 'pesoRicavo', valore: '100', tipo: 'percentuale', descrizione: 'Quanto pesa il ricavo (€) di un intervento nella scelta di quali interventi assegnare, in percentuale (0-100): fa preferire gli interventi più redditizi, senza mai bloccare il riempimento delle ore disponibili del turno (il target resta un indicatore, non un limite che ferma le assegnazioni). Questo peso viene rafforzato automaticamente (fino a 5 volte) quando la produzione della squadra è ancora lontana dal proprio target giornaliero, e torna al valore impostato qui avvicinandosi/superando il target. 100% è l\'intensità raccomandata di default, 0% disattiva completamente il fattore ricavo.' },
  { chiave: 'pesoCompetenzaSpecifica', valore: '100', tipo: 'percentuale', descrizione: 'Priorità data agli interventi che richiedono esplicitamente una competenza posseduta dalla squadra, rispetto a quelli generici (competenza vuota, assegnabili a qualsiasi squadra), in percentuale (0-100): un tecnico specializzato riceve prima il lavoro della propria specializzazione, usando quello generico solo come riempitivo quando non ce n\'è (più) a sufficienza. 100% è l\'intensità raccomandata di default, 0% disattiva questa priorità (non ha comunque effetto sulle squadre senza competenze specifiche impostate).' },
  { chiave: 'emailClienti', valore: '', tipo: 'testo', descrizione: 'Elenco email (separate da virgola) degli account Google trattati come "Cliente": vedono solo il tab Interventi e possono solo aggiungere note, sospendere o annullare gli interventi (mai crearli, modificarli, eliminarli, pianificarli o importarli). Tutti gli account non in elenco restano Admin con accesso completo. Lascia vuoto per non avere nessun account Cliente.' },
  { chiave: 'driveCartellaRadiceId', valore: '1gE8eD2SbCN5Uect2zLQkaf_RGi9W2yzW', tipo: 'testo', descrizione: 'ID della cartella Google Drive dentro cui vengono create le sottocartelle documenti di ogni intervento (una per intervento, nominata "yyyyMMdd_ODS_Cliente"). Si trova nell\'URL della cartella: drive.google.com/drive/folders/QUESTO-ID. L\'account che esegue la Web App deve avere accesso in scrittura a questa cartella.' },
  { chiave: 'emailPianificazioneSM01To', valore: '', tipo: 'testo', categoria: CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_, descrizione: 'Destinatari (A), separati da virgola, della mail automatica "è stato pianificato" (pulsante ✉ nella Dashboard) per gli interventi di Tipo Attività SM01. Se vuoto, il pulsante segnala un errore invece di inviare senza destinatario.' },
  { chiave: 'emailPianificazioneSM01Cc', valore: '', tipo: 'testo', categoria: CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_, descrizione: 'Destinatari in copia (Cc), separati da virgola, della stessa mail per gli interventi SM01. Facoltativo.' },
  { chiave: 'emailPianificazioneAltriTo', valore: '', tipo: 'testo', categoria: CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_, descrizione: 'Destinatari (A), separati da virgola, della stessa mail per tutti i Tipi Attività diversi da SM01 (SM02-SM05, "Intervento a vuoto", "Altro" o nessun Tipo Attività scelto). Se vuoto, il pulsante segnala un errore invece di inviare senza destinatario.' },
  { chiave: 'emailPianificazioneAltriCc', valore: '', tipo: 'testo', categoria: CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_, descrizione: 'Destinatari in copia (Cc), separati da virgola, della stessa mail per tutti i Tipi Attività diversi da SM01. Facoltativo.' },
  { chiave: 'emailPianificazioneFirma', valore: '', tipo: 'testoLungo', categoria: CATEGORIA_REGOLE_EMAIL_PIANIFICAZIONE_, descrizione: 'Firma appesa in fondo al corpo della mail "è stato pianificato" (separata da una riga vuota), uguale per SM01 e per tutti gli altri Tipi Attività. Le mail inviate da Apps Script NON includono mai in automatico la firma configurata nelle impostazioni di Gmail: se ne vuoi una, scrivila qui. Lascia vuoto per nessuna firma.' }
];
