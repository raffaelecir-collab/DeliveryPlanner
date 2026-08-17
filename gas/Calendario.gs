/**
 * Calendario dei giorni lavorativi usato dal tab Analysis (solo per le metriche di tempo, non per
 * la pianificazione, che continua a usare la regola configurabile "giorniLavorativi"): calendario
 * FISSO Lun-Ven, con le festività nazionali italiane escluse, indipendentemente dalle regole di
 * pianificazione impostate in Regole.
 */

/** Domenica di Pasqua per un anno (algoritmo di Gauss/Meeus, calendario gregoriano). */
function pasquaAnno_(anno) {
  var a = anno % 19;
  var b = Math.floor(anno / 100);
  var c = anno % 100;
  var d = Math.floor(b / 4);
  var e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4);
  var k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mese = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzo, 4 = aprile
  var giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anno, mese - 1, giorno);
}

var CACHE_FESTIVITA_ANNO_ = {};

/** Mappa 'dd/MM/yyyy' -> true delle festività nazionali italiane fisse + mobili di un anno. */
function festivitaAnno_(anno) {
  if (CACHE_FESTIVITA_ANNO_[anno]) return CACHE_FESTIVITA_ANNO_[anno];
  var pasqua = pasquaAnno_(anno);
  var pasquetta = addDays_(pasqua, 1);
  var fisse = [
    new Date(anno, 0, 1),   // Capodanno
    new Date(anno, 0, 6),   // Epifania
    pasquetta,               // Lunedì dell'Angelo
    new Date(anno, 3, 25),  // Liberazione
    new Date(anno, 4, 1),   // Festa dei Lavoratori
    new Date(anno, 5, 2),   // Festa della Repubblica
    new Date(anno, 7, 15),  // Ferragosto
    new Date(anno, 10, 1),  // Ognissanti
    new Date(anno, 11, 8),  // Immacolata
    new Date(anno, 11, 25), // Natale
    new Date(anno, 11, 26)  // Santo Stefano
  ];
  var mappa = {};
  fisse.forEach(function (d) { mappa[formatDateStr_(d)] = true; });
  CACHE_FESTIVITA_ANNO_[anno] = mappa;
  return mappa;
}

/** Lun-Ven e non festività nazionale italiana (calendario fisso, non configurabile). */
function isGiornoLavorativoAnalisi_(date) {
  var giorno = date.getDay();
  if (giorno === 0 || giorno === 6) return false;
  return !festivitaAnno_(date.getFullYear())[formatDateStr_(date)];
}

/**
 * Aggiunge N giorni lavorativi (stesso calendario fisso Lun-Ven + festività italiane escluse di
 * isGiornoLavorativoAnalisi_) a una data 'dd/MM/yyyy': usata per calcolare automaticamente la
 * Scadenza di un Intervento da "Data Dispacciamento" (vedi calcolaScadenzaAutomatica_ in
 * Interventions.gs). Il giorno di partenza (dataStr) stesso non viene mai contato, anche se
 * lavorativo: si parte sempre a contare dal giorno successivo.
 */
function aggiungiGiorniLavorativi_(dataStr, n) {
  var d = parseDateStr_(dataStr);
  if (!d) return '';
  var rimanenti = n;
  while (rimanenti > 0) {
    d = addDays_(d, 1);
    if (isGiornoLavorativoAnalisi_(d)) rimanenti--;
  }
  return formatDateStr_(d);
}

/**
 * Conta i giorni lavorativi nell'intervallo [dataInizio, dataFine) (fine esclusa), escludendo
 * anche i giorni ricadenti in uno degli `intervalliEsclusi` (es. i periodi di sospensione di un
 * intervento — vedi intervalliSospensione_ in Interventions.gs), ciascuno nella forma
 * { dal: 'dd/MM/yyyy', al: 'dd/MM/yyyy' } (anch'essi con `al` escluso).
 */
function giorniLavorativiTra_(dataInizioStr, dataFineStr, intervalliEsclusi) {
  var inizio = parseDateStr_(dataInizioStr), fine = parseDateStr_(dataFineStr);
  if (!inizio || !fine || fine <= inizio) return 0;
  var esclusi = intervalliEsclusi || [];
  var conteggio = 0;
  var cursore = inizio;
  while (cursore < fine) {
    var giornoFmt = formatDateStr_(cursore);
    var sospeso = esclusi.some(function (iv) { return giornoFmt >= iv.dal && giornoFmt < iv.al; });
    if (!sospeso && isGiornoLavorativoAnalisi_(cursore)) conteggio++;
    cursore = addDays_(cursore, 1);
  }
  return conteggio;
}
