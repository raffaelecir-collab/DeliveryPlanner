/**
 * Import di Interventi da un foglio Google Sheet ESTERNO letto direttamente dal server (non un
 * file caricato dal browser come in Import.gs): il foglio deve quindi essere condiviso almeno in
 * LETTURA con l'account Google che esegue la Web App ("Esegui come" della distribuzione),
 * altrimenti importaGoogleSheetVeneto segnala un errore chiaro.
 *
 * Sorgente attuale: la tab "Veneto" (TAB_VENETO_) del foglio Google con ID ID_FOGLIO_VENETO_. Le
 * colonne sono lette per POSIZIONE fissa (non per nome di intestazione):
 * - S: Cliente.
 * - T, B, C (in quest'ordine, concatenate): Indirizzo.
 * - D: Codice Esterno (Ods) — da solo NON è univoco in questo foglio (può ripetersi su più
 *   righe): la riconciliazione con un import successivo usa anche la colonna T, memorizzata
 *   internamente sul campo "Chiave Secondaria Import" (mai mostrata/modificabile a mano), esattamente
 *   come Operazione affianca Ordine nell'import Excel Sicuritalia (vedi chiaveRiconciliazioneImport_
 *   in Import.gs) — stessa logica, chiave diversa. Può anche essere mancante (riga senza Ods ancora
 *   assegnato): viene comunque importata, con Codice Esterno vuoto da compilare poi a mano; la
 *   riconciliazione in quel caso usa solo la colonna T.
 * - H: Data Dispacciamento.
 * - G: Tipo Attività, testo libero mappato sui codici SM01-SM05/Intervento a vuoto secondo
 *   MAPPA_TIPO_ATTIVITA_VENETO_; un testo non riconosciuto diventa "Altro".
 * - N: Prezzo Importato (usato, come nell'import Excel, per calcolare la Durata Stimata di SM01 —
 *   vedi calcolaDurataSM_ in Import.gs).
 * - C: Comune (la stessa colonna usata anche per comporre l'Indirizzo).
 * - L: Telefono.
 *
 * Solo le righe la cui colonna M vale "Giacente" (case-insensitive, dopo trim) vengono
 * importate/aggiornate; le altre sono ignorate (né create né toccate). Come
 * per l'import Excel, QUI NON ESISTE alcun annullamento automatico per righe non più presenti o
 * non più in uno di questi tre stati, e un re-import non tocca mai stato/squadra/data
 * pianificata/ordine tappa/ricavo di un Intervento già esistente (solo i campi anagrafici sopra
 * vengono aggiornati). La durata stimata e la Scadenza/Priorità automatiche (SM01-SM05) seguono
 * le stesse regole già centralizzate in Import.gs/Interventions.gs, senza bisogno di duplicarle
 * qui.
 */

var ID_FOGLIO_VENETO_ = '1Lou7tcXd7_8fBpwIns-oZQjqceV5MKb1vQfej0LpD1M';
var TAB_VENETO_ = 'Veneto';

/** I soli valori di colonna M che rendono una riga importabile/aggiornabile (case-insensitive). */
var STATI_IMPORTABILI_VENETO_ = ['giacente'];

/** Mappa il testo libero di "Tipo Attività" (colonna G) sui codici SM01-SM05/Intervento a vuoto. */
var MAPPA_TIPO_ATTIVITA_VENETO_ = {
  'integrazione impianto': 'SM01',
  'installazione filare': 'SM01',
  'installazione periferica': 'SM01',
  'installazione wicomm': 'SM01',
  'manutenzione correttiva': 'SM02',
  'manutenzione ispettiva': 'SM03',
  'smontaggio': 'SM04',
  'sopralluogo': 'SM05',
  'intervento a vuoto': TIPO_ATTIVITA_VUOTO
};

function mappaTipoAttivitaVeneto_(testoGrezzo) {
  var chiave = String(testoGrezzo || '').trim().toLowerCase();
  return MAPPA_TIPO_ATTIVITA_VENETO_[chiave] || TIPO_ATTIVITA_ALTRO;
}

/**
 * Chiave di riconciliazione univoca Ods+colonna T per questa fonte (vedi il commento in cima al
 * file). Riusa normalizzaValoreNumericoPerConfronto_ (Import.gs) per tollerare l'eventuale
 * perdita di zeri iniziali da parte di Google Sheets su un valore numerico-come-testo, stesso
 * problema già risolto per l'import Excel.
 */
function chiaveRiconciliazioneVeneto_(ods, colonnaT) {
  return normalizzaValoreNumericoPerConfronto_(ods) + '|' + normalizzaValoreNumericoPerConfronto_(colonnaT);
}

/**
 * Elabora una singola riga (array di valori di cella, 0-based, colonna A = indice 0) già filtrata
 * per stato (colonna M). Restituisce 'creato' o 'aggiornato'. Lancia un errore (catturato dal
 * chiamante) se manca il Cliente o l'intero indirizzo (il Codice Esterno può invece mancare: la
 * riga viene importata comunque, per essere compilata a mano in seguito).
 */
function elaboraRigaVeneto_(row, interventiPerCodice) {
  var ods = String(row[3] || '').trim(); // D — può essere mancante, vedi commento in cima al file
  var colonnaT = String(row[19] || '').trim(); // T

  var cliente = String(row[18] || '').trim(); // S
  var colB = String(row[1] || '').trim(); // B
  var comune = String(row[2] || '').trim(); // C
  var telefono = String(row[11] || '').trim(); // L
  if (!cliente) throw new Error('Colonna "Cliente" (S) mancante.');
  if (!colonnaT && !colB && !comune) throw new Error('Indirizzo mancante (colonne T/B/C tutte vuote).');

  var indirizzo = [colonnaT, colB, comune].filter(function (p) { return p; }).join(', ');
  var chiave = chiaveRiconciliazioneVeneto_(ods, colonnaT);
  var esistente = interventiPerCodice[chiave] || null;

  var tipoAttivita = mappaTipoAttivitaVeneto_(row[6]); // G
  var prezzo = parseFloat(row[13]); // N
  if (isNaN(prezzo)) prezzo = null;
  var durataMinuti = calcolaDurataSM_(tipoAttivita, prezzo);

  var payload = {
    cliente: cliente,
    indirizzo: indirizzo,
    comune: comune,
    telefono: telefono,
    codiceEsterno: ods,
    chiaveSecondariaImport: colonnaT,
    tipoAttivita: tipoAttivita
  };
  if (durataMinuti !== null) payload.durataMinuti = durataMinuti;
  if (prezzo !== null) payload.prezzo = prezzo;
  var dataDisp = normalizzaDataImport_(row[7]); // H — stessa utility dell'import Excel (Import.gs)
  if (dataDisp) payload.dataDispacciamento = dataDisp;
  if (esistente) payload.id = esistente.id;

  salvaIntervento(payload);
  return esistente ? 'aggiornato' : 'creato';
}

/**
 * Legge la tab "Veneto" del foglio esterno ed elabora le righe da `prossimoIndiceIniziale` in poi
 * (0-based, indice nell'array di righe dati — la riga 2 del foglio è indice 0). Guardrail di
 * tempo come nel resto dell'app (importaRigheEsterne, pianificaIntervallo): se sta per scadere si
 * interrompe, restituendo `prossimoIndice` così il client può richiamare la funzione da lì
 * invece di ripartire da capo o perdere le righe restanti. Righe completamente vuote vengono
 * saltate silenziosamente (non contano né come scartate né come fallite).
 */
function importaGoogleSheetVeneto(prossimoIndiceIniziale) {
  richiedeAdmin_();

  var ss;
  try {
    ss = SpreadsheetApp.openById(ID_FOGLIO_VENETO_);
  } catch (e) {
    throw new Error('Impossibile aprire il foglio Google esterno (ID "' + ID_FOGLIO_VENETO_ + '"): ' + e.message +
      '. Verifica che sia condiviso (almeno in lettura) con l\'account Google che esegue la Web App.');
  }
  var sheet = ss.getSheetByName(TAB_VENETO_);
  if (!sheet) throw new Error('Il foglio esterno non ha una tab chiamata "' + TAB_VENETO_ + '".');

  var lastRow = sheet.getLastRow();
  var risultatoVuoto = { creati: 0, aggiornati: 0, falliti: 0, scartatiPerStato: 0, dettagliFalliti: [], prossimoIndice: 0, tempoScaduto: false, totaleRighe: 0 };
  if (lastRow < 2) return risultatoVuoto;

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var interventiPerCodice = {};
  readAll_('INTERVENTI').forEach(function (iv) {
    if (!iv.codiceEsterno && !iv.chiaveSecondariaImport) return; // mai toccato da questo import
    interventiPerCodice[chiaveRiconciliazioneVeneto_(iv.codiceEsterno, iv.chiaveSecondariaImport)] = iv;
  });

  var TEMPO_MASSIMO_MS = 4.5 * 60 * 1000;
  var inizioEsecuzione = new Date().getTime();
  var tempoScaduto = false;

  var creati = 0, aggiornati = 0, falliti = 0, scartatiPerStato = 0;
  var dettagliFalliti = [];
  var startIdx = prossimoIndiceIniziale || 0;
  var prossimoIndice = values.length;

  for (var r = startIdx; r < values.length; r++) {
    if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; prossimoIndice = r; break; }
    var row = values[r];
    var isEmpty = row.every(function (v) { return v === '' || v === null || v === undefined; });
    if (isEmpty) continue;

    var statoRiga = String(row[12] || '').trim().toLowerCase(); // M
    if (STATI_IMPORTABILI_VENETO_.indexOf(statoRiga) === -1) { scartatiPerStato++; continue; }

    try {
      var esito = elaboraRigaVeneto_(row, interventiPerCodice);
      if (esito === 'creato') creati++; else aggiornati++;
    } catch (e) {
      falliti++;
      dettagliFalliti.push('Riga ' + (r + 2) + ': ' + e.message);
    }
  }

  return {
    creati: creati,
    aggiornati: aggiornati,
    falliti: falliti,
    scartatiPerStato: scartatiPerStato,
    dettagliFalliti: dettagliFalliti,
    prossimoIndice: prossimoIndice,
    tempoScaduto: tempoScaduto,
    totaleRighe: values.length
  };
}
