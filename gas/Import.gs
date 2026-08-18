/**
 * Import di Interventi da un file Excel (.xlsx) esterno, il file di tracking Sicuritalia
 * caricato dal browser (mai da un foglio Google esterno: vedi JS.html per la lettura via
 * SheetJS, la selezione delle regioni da importare e il chunking in batch). Ogni chiamata a
 * importaRigheEsterne elabora UN batch già pronto, così una singola esecuzione resta ben entro il
 * limite di 6 minuti di Apps Script anche per i file da migliaia di righe: il client ripete la
 * chiamata batch per batch (e, se un batch scade per tempo, anche sullo stesso batch a partire da
 * `prossimoIndice`).
 *
 * Le colonne vengono lette per POSIZIONE fissa dal file Excel (non per nome intestazione, a
 * differenza del vecchio meccanismo da foglio Google): l'estrazione avviene lato client, che
 * passa a questa funzione oggetti già con le chiavi elencate in elaboraRigaEsterna_.
 *
 * Il Codice Esterno mostrato/salvato sull'Intervento è SOLO l'Ordine (colonna C), esattamente
 * come compare nel file Excel. La riconciliazione con un import successivo, però, usa dietro le
 * quinte la coppia Ordine+Operazione (colonne C e D): la sola colonna Ordine NON è univoca nel
 * file (righe con più Operazioni sullo stesso Ordine, indirizzo identico ma date/prezzi diversi),
 * la coppia sì — vedi chiaveRiconciliazioneImport_. L'Operazione resta comunque visibile a parte
 * nel campo "Op.".
 *
 * A differenza del vecchio import da foglio Google, QUI NON ESISTE alcun annullamento automatico
 * per Ods assente: un Ods non presente in un batch/import (es. perché si sta importando solo
 * alcune regioni, o solo un sottoinsieme di file) non implica che l'intervento corrispondente
 * debba essere annullato — sarebbe pericoloso proprio perché l'import è tipicamente parziale
 * (regione per regione). Un Intervento importato in precedenza e non più presente nel file resta
 * quindi semplicemente inalterato finché non viene toccato a mano.
 *
 * Un Ods già presente su un Intervento esistente aggiorna quell'Intervento (cliente, indirizzo,
 * comune, tipo attività, durata stimata, dataDispacciamento, richiestaAcquisto, codCliente,
 * codEquipment, prezzo, operatore) SENZA MAI toccare stato/squadra/data pianificata/ordine
 * tappa/ricavo/voci di listino: questi campi restano sempre sotto controllo esclusivo della Web
 * App (pianificazione, "Componi Ricavo"), un re-import non li retrocede né li azzera mai. Un Ods
 * non ancora presente crea un nuovo Intervento in stato "Da pianificare" (default di schema).
 *
 * Se il Prezzo importato per un Intervento già esistente supera il Ricavo già composto per quello
 * stesso Intervento, viene generata una notifica SOLO per l'Admin (creaNotificaSoloAdmin_,
 * eccezione alla regola generale delle notifiche) per segnalare che il Ricavo andrebbe adeguato.
 */

/** Normalizza una data (Date object o testo) in stringa gg/mm/aaaa, come il resto dell'app. */
function normalizzaDataImport_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(raw).trim();
}

/**
 * Durata stimata (minuti) per una riga del tracking esterno, in base al Tipo Attività (codice
 * SM01-SM05) e, solo per SM01, al Prezzo (colonna R): SM01 fino a 120€ -> 120 min, fino a 240€ ->
 * 240 min, fino a 350€ -> 360 min, oltre 350€ -> 480 min; SM02/SM03/SM04/SM05 sempre 60 minuti,
 * a prescindere dal prezzo. Un Prezzo mancante su SM01 ricade sulla fascia più bassa (120 min).
 * Restituisce null per "Altro" (tipo non riconosciuto): il chiamante lascia la durata invariata
 * (resta il default dello schema, 60 minuti).
 */
function calcolaDurataSM_(tipoAttivita, prezzo) {
  if (tipoAttivita === 'SM01') {
    if (prezzo === null || isNaN(prezzo)) return 120;
    if (prezzo <= 120) return 120;
    if (prezzo <= 240) return 240;
    if (prezzo <= 350) return 360;
    return 480;
  }
  if (tipoAttivita === 'SM02' || tipoAttivita === 'SM03' || tipoAttivita === 'SM04' || tipoAttivita === 'SM05') return 60;
  return null;
}

/**
 * Forma canonica di un valore che sembra un numero (tutte cifre), usata SOLO per il confronto di
 * riconciliazione, mai per i valori mostrati/salvati: Google Sheets può reinterpretare in
 * automatico come numero un valore scritto con zeri iniziali (es. l'Operazione "0010" diventa
 * 10 non appena la riga viene scritta sul foglio, a meno che la colonna non sia già formattata
 * come testo semplice), perdendo gli zeri. Questa normalizzazione rende il confronto tollerante:
 * "0010" (appena letto dal file Excel) e "10" (già "corretto" dal foglio in un import
 * precedente) riconciliano comunque come lo stesso valore. Un valore non puramente numerico resta
 * invariato (confrontato così com'è, dopo trim).
 */
function normalizzaValoreNumericoPerConfronto_(valore) {
  var v = String(valore === null || valore === undefined ? '' : valore).trim();
  return /^\d+$/.test(v) ? String(parseInt(v, 10)) : v;
}

/**
 * Chiave di riconciliazione univoca "Ordine|Operazione" usata SOLO internamente per riconoscere
 * un Intervento già importato (mai la sola colonna Ordine, che nel file non è univoca — vedi il
 * commento in cima al file): il Codice Esterno sull'Intervento resta comunque solo l'Ordine.
 * Normalizza anche il vecchio formato combinato "Ordine-Operazione" salvato in Codice Esterno da
 * una versione precedente di questo import (prima che l'Operazione diventasse un campo a parte):
 * se il valore termina con "-" + Operazione, usa solo la parte Ordine — così le righe già
 * importate in passato continuano a riconciliare correttamente, e il loro Codice Esterno si
 * "ripulisce" da solo (torna al solo Ordine) al prossimo import che le tocca. Ordine e Operazione
 * vengono infine normalizzati con normalizzaValoreNumericoPerConfronto_ (vedi sopra) per tollerare
 * l'eventuale perdita di zeri iniziali lato Google Sheets.
 */
function chiaveRiconciliazioneImport_(codiceEsterno, operazione) {
  var ordine = String(codiceEsterno || '').trim();
  var op = String(operazione || '').trim();
  var suffisso = op ? ('-' + op) : '';
  if (suffisso && ordine.length > suffisso.length && ordine.slice(-suffisso.length) === suffisso) {
    ordine = ordine.slice(0, ordine.length - suffisso.length);
  }
  return normalizzaValoreNumericoPerConfronto_(ordine) + '|' + normalizzaValoreNumericoPerConfronto_(op);
}

/**
 * Elabora una singola riga già estratta dal client (chiavi corrispondenti alle colonne del file
 * Excel — vedi JS.html):
 * - ordine (C): diventa il Codice Esterno dell'Intervento, così com'è nel file.
 * - operazione (D): campo "Op.", usata anche (insieme a ordine) per la riconciliazione.
 * - dataDispacciamento (N), richiestaAcquisto (M), prezzo (R).
 * - cliente (U), via (V), localita (W), codCliente (X), provincia (Y, sigla), codEquipment (Z).
 * - tipoOrdine (B): codice SM01-SM05.
 * Restituisce 'creato' o 'aggiornato'. Lancia un errore (catturato dal chiamante) se manca
 * Ordine, Cliente o l'intero indirizzo (via e località entrambe vuote).
 */
function elaboraRigaEsterna_(riga, interventiPerCodice) {
  var ordine = String(riga.ordine || '').trim();
  var operazione = String(riga.operazione || '').trim();
  if (!ordine) throw new Error('Colonna "Ordine" (C) mancante.');

  var cliente = String(riga.cliente || '').trim();
  var via = String(riga.via || '').trim();
  var localita = String(riga.localita || '').trim();
  var provincia = String(riga.provincia || '').trim();
  if (!cliente) throw new Error('Colonna "Nome lista" (U, Cliente) mancante.');
  if (!via && !localita) throw new Error('Indirizzo mancante (colonne V/W entrambe vuote).');

  var indirizzo = [via, localita, provincia].filter(function (p) { return p; }).join(', ');
  var esistente = interventiPerCodice[chiaveRiconciliazioneImport_(ordine, operazione)] || null;

  var tipoOrdine = String(riga.tipoOrdine || '').trim().toUpperCase();
  var tipoAttivita = TIPI_ATTIVITA_NOTI.indexOf(tipoOrdine) !== -1 ? tipoOrdine : TIPO_ATTIVITA_ALTRO;

  var prezzo = (riga.prezzo === '' || riga.prezzo === null || riga.prezzo === undefined) ? null : parseFloat(riga.prezzo);
  if (prezzo !== null && isNaN(prezzo)) prezzo = null;
  var durataMinuti = calcolaDurataSM_(tipoAttivita, prezzo);

  var payload = {
    cliente: cliente,
    indirizzo: indirizzo,
    comune: localita,
    codiceEsterno: ordine,
    operatore: operazione,
    richiestaAcquisto: riga.richiestaAcquisto === null || riga.richiestaAcquisto === undefined ? '' : String(riga.richiestaAcquisto).trim(),
    codCliente: riga.codCliente === null || riga.codCliente === undefined ? '' : String(riga.codCliente).trim(),
    codEquipment: riga.codEquipment === null || riga.codEquipment === undefined ? '' : String(riga.codEquipment).trim(),
    tipoAttivita: tipoAttivita
  };
  if (prezzo !== null) payload.prezzo = prezzo;
  if (durataMinuti !== null) payload.durataMinuti = durataMinuti;
  var dataDisp = normalizzaDataImport_(riga.dataDispacciamento);
  if (dataDisp) payload.dataDispacciamento = dataDisp;
  if (esistente) payload.id = esistente.id;

  // Il Prezzo importato ha superato il Ricavo già composto: avvisa SOLO l'Admin (un Intervento
  // appena creato non ha ancora un Ricavo, quindi il controllo riguarda solo i re-import).
  if (esistente && prezzo !== null && (esistente.prezzo !== prezzo) && (esistente.ricavo || 0) < prezzo) {
    creaNotificaSoloAdmin_(esistente, 'Prezzo importato (' + prezzo.toFixed(2) + '€) superiore al Ricavo composto (' +
      (esistente.ricavo || 0).toFixed(2) + '€): adeguare il Ricavo.');
  }

  salvaIntervento(payload);
  return esistente ? 'aggiornato' : 'creato';
}

/**
 * Elabora un batch di righe già estratte dal client (vedi elaboraRigaEsterna_ per il formato di
 * ciascuna). Guardrail di tempo come nel resto dell'app (pianificaIntervallo): se sta per scadere
 * si interrompe, restituendo `prossimoIndice` (indice, 0-based, della prima riga del batch NON
 * ancora elaborata) così il client può richiamare la funzione sullo stesso batch da lì, invece di
 * perdere le righe restanti.
 */
function importaRigheEsterne(righe) {
  richiedeAdmin_();
  if (!righe || !righe.length) {
    return { creati: 0, aggiornati: 0, falliti: 0, dettagliFalliti: [], prossimoIndice: 0, tempoScaduto: false };
  }

  var interventiPerCodice = {};
  readAll_('INTERVENTI').forEach(function (i) {
    if (!i.codiceEsterno) return;
    interventiPerCodice[chiaveRiconciliazioneImport_(i.codiceEsterno, i.operatore)] = i;
  });

  var TEMPO_MASSIMO_MS = 4.5 * 60 * 1000;
  var inizioEsecuzione = new Date().getTime();
  var tempoScaduto = false;

  var creati = 0, aggiornati = 0, falliti = 0;
  var dettagliFalliti = [];
  var prossimoIndice = righe.length;

  for (var r = 0; r < righe.length; r++) {
    if (new Date().getTime() - inizioEsecuzione > TEMPO_MASSIMO_MS) { tempoScaduto = true; prossimoIndice = r; break; }
    var riga = righe[r];
    try {
      var esito = elaboraRigaEsterna_(riga, interventiPerCodice);
      if (esito === 'creato') creati++; else aggiornati++;
    } catch (e) {
      falliti++;
      dettagliFalliti.push('Riga ' + (r + 1) + (riga && riga.cliente ? ' (' + riga.cliente + ')' : '') + ': ' + e.message);
    }
  }

  return {
    creati: creati,
    aggiornati: aggiornati,
    falliti: falliti,
    dettagliFalliti: dettagliFalliti,
    prossimoIndice: prossimoIndice,
    tempoScaduto: tempoScaduto
  };
}
