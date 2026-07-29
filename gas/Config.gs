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
  IMPORT_ESTERNO: 'ImportInterventi'
};

/**
 * Intestazioni del foglio "grezzo" ImportInterventi, nello stesso ordine e con lo stesso
 * testo dell'export del sistema di tracking esterno del cliente: si incollano i dati lì
 * (sovrascrivendo pure le righe di esempio) e si preme "Importa" nel tab Interventi della
 * Web App. Non è uno SCHEMA con CRUD proprio: è solo un'area di staging che Import.gs legge
 * per posizione di colonna.
 */
var IMPORT_ESTERNO_HEADERS = [
  'Ods', 'Attività', 'Nome Cliente', 'Data Disp.', 'Data Scadenza', 'Urgente',
  'Note Sicuritalia', 'Stato', 'Note Site', 'Data App.', 'Ora App.', 'Tecnico',
  'Indirizzo', 'Comune', 'Provincia', 'Telefono', 'Aging scaduto'
];

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

/** Abbreviazioni giorno della settimana indicizzate come Date.getDay() (0 = Domenica). */
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
      { key: 'competenze', label: 'Competenze (separate da virgola)', type: 'text', help: 'Es: elettrico,idraulico — vincolo rigido: alla squadra possono essere assegnati solo interventi la cui competenza richiesta è tra queste (vuoto = nessun vincolo, la squadra copre qualsiasi competenza).' },
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
      { key: 'produzioneTarget', label: 'Target Produzione Giornaliera (€)', type: 'number', help: 'Ricavo giornaliero che la squadra dovrebbe idealmente raggiungere. Le assegnazioni tengono conto del ricavo di ogni intervento (tra gli altri fattori) per avvicinarsi a questo valore, ma continuano comunque a riempire tutte le ore disponibili del turno anche oltre il target. Lascia vuoto se non vuoi tracciare un target per questa squadra.' }
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
      { key: 'motivoNonPianificato', label: 'Nota Pianificazione', type: 'text', readonly: true },
      { key: 'telefono', label: 'Telefono', type: 'text' },
      { key: 'ricavo', label: 'Ricavo (€)', type: 'number', default: 0, help: 'Usato per calcolare la produzione (ricavo totale) di ciascuna squadra rispetto al proprio target di produzione giornaliera.' },
      { key: 'codiceEsterno', label: 'Codice Esterno (Ods)', type: 'text', readonly: true, help: 'Identificativo dell\'intervento nel sistema di tracking esterno da cui è stato importato (tab ImportInterventi): re-importando lo stesso Ods, questo intervento viene aggiornato invece di duplicato.' }
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

/**
 * Valori di default delle regole del motore di ottimizzazione percorso (chiave/valore su
 * foglio Regole). Il campo `tipo` guida solo la resa del controllo nel form lato client
 * (numero vs selettore giorni della settimana): non viene salvato come colonna a sé sul
 * foglio, che resta un semplice elenco chiave/valore/descrizione.
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
  { chiave: 'pesoCompetenzaSpecifica', valore: '100', tipo: 'percentuale', descrizione: 'Priorità data agli interventi che richiedono esplicitamente una competenza posseduta dalla squadra, rispetto a quelli generici (competenza vuota, assegnabili a qualsiasi squadra), in percentuale (0-100): un tecnico specializzato riceve prima il lavoro della propria specializzazione, usando quello generico solo come riempitivo quando non ce n\'è (più) a sufficienza. 100% è l\'intensità raccomandata di default, 0% disattiva questa priorità (non ha comunque effetto sulle squadre senza competenze specifiche impostate).' }
];
