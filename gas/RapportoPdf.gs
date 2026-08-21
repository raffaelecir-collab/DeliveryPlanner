/**
 * Generazione del PDF "Rapporto di Intervento", con la STESSA impaginazione del modulo cartaceo
 * SICURITALIA (logo e intestazione aziendale estratti dal modulo originale fornito dall'utente).
 * Costruito come HTML con tabelle/CSS e convertito in PDF (Utilities.newBlob(...).getAs(...)), poi
 * archiviato nella cartella Documenti Drive dell'intervento (vedi Documenti.gs, stessa cartella
 * visibile dal pulsante 📎 "Documenti" già esistente) — rigenerato e SOVRASCRITTO (il PDF
 * precedente viene cestinato) ad ogni salvataggio del Rapporto (salvaRapportoIntervento,
 * Interventions.gs), così esiste sempre un solo PDF aggiornato per intervento.
 *
 * Autocompilazione dei campi non gestiti dalla squadra (concordata con l'Admin):
 * - Tipo d'impianto = Cliente · Causale dell'intervento = Tipo Attività
 * - Richiesto da = "Cristiano Damiani" se Tipo Attività è SM01, altrimenti "Sara Baran"
 * - In data = Data Dispacciamento · N° ordine = Codice Esterno
 * - Regime dell'intervento: sempre "Ordinario" (unico regime gestito, per ora)
 * - Unità operativa = "SITE SPA" (fisso) · Cod. Tecnico = vuoto (dato non presente in anagrafica)
 * - Prov. = vuoto (nessun campo Provincia in anagrafica) · Test effettuati = nessuna casella barrata
 * Km/Tempo di trasferimento, N° tecnici aggiuntive e le caselle "tipo di intervento" in cima al
 * modulo sono invece compilati dalla squadra stessa (stessi campi del dialog "Rapporto di
 * Intervento" di JS.html).
 */

var TIPI_INTERVENTO_RAPPORTO_ = ['SOPRALLUOGO', 'INSTALLAZIONE', 'COLLAUDO', 'SMONTAGGIO', 'MANUTENZIONE PREVENTIVA', 'MANUTENZIONE CORRETTIVA'];
var RICHIESTO_DA_SM01_RAPPORTO_ = 'Cristiano Damiani';
var RICHIESTO_DA_ALTRI_RAPPORTO_ = 'Sara Baran';
var UNITA_OPERATIVA_RAPPORTO_ = 'SITE SPA';

/** Logo SICURITALIA (PNG), estratto direttamente dal modulo cartaceo originale allegato dall'utente. */
var LOGO_SICURITALIA_BASE64_ = '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';

/** Testo boilerplate "CONDIZIONI DI FORNITURA" — trascritto dal modulo cartaceo originale allegato. */
var CONDIZIONI_FORNITURA_RAPPORTO_ =
  '<b>CONDIZIONI DI FORNITURA</b> 1) (Accettazione) Il presente rapporto di servizio è firmato per accettazione dell\'attività prestata. ' +
  '2) (Responsabilità) La società non risponde di eventuali danni causati ad ambienti o cose derivanti dal mancato o difettoso funzionamento delle apparecchiature a seguito dell\'intervento effettuato, salvo il caso di dolo o colpa grave. ' +
  '3) (Reclami) Qualsiasi reclamo inerente al servizio reso dovrà essere inoltrato tramite R.R. alla società entro e non oltre 8 (otto) giorni dalla data del presente rapporto di servizio. ' +
  '4) (Responsabilità) Gli interventi in reperibilità, salvo diverso accordo contrattuale con il Cliente, sono sempre a pagamento. ' +
  '5) La presente condizioni di fornitura si applicano in quanto compatibili con le condizioni previste nel contratto o variate anche su richiesta del Cliente.';

var NOTA_ART_1341_RAPPORTO_ = 'Ai sensi e per gli effetti degli art. 1341 e 1342 del C.C., dichiarando di conoscere ed accettare specificatamente art. 2 (Responsabilità) e art. 4 (Responsabilità).';

function escapeHtmlPdf_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nlToBrPdf_(s) {
  return escapeHtmlPdf_(s).replace(/\n/g, '<br>');
}

function casellaPdf_(checked) {
  return '<span class="chk">' + (checked ? 'X' : '') + '</span>';
}

function firmaImgPdf_(dataUrl) {
  if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) return '';
  return '<img src="' + dataUrl + '">';
}

function richiestoDaRapporto_(intervento) {
  return intervento.tipoAttivita === 'SM01' ? RICHIESTO_DA_SM01_RAPPORTO_ : RICHIESTO_DA_ALTRI_RAPPORTO_;
}

/** Nome del file PDF: stesso schema dei nomi cartella Documenti (Documenti.gs), riconoscibile. */
function nomeFilePdfRapporto_(intervento) {
  var codice = intervento.codiceEsterno ? sanitizzaNomeCartella_(intervento.codiceEsterno) : 'SENZA-ODS';
  var cliente = sanitizzaNomeCartella_(intervento.cliente) || '(senza nome)';
  return 'Rapporto di Intervento - ' + codice + ' - ' + cliente + '.pdf';
}

/** Righe della tabella articoli: almeno 5 (come lo spazio del modulo cartaceo in bianco), o più se la squadra ne ha compilate di più. */
function righeArticoliPdf_(articoliJson) {
  var articoli = [];
  try { articoli = JSON.parse(articoliJson || '[]'); } catch (e) { articoli = []; }
  if (!Array.isArray(articoli)) articoli = [];
  var minimoRighe = 5;
  var righe = articoli.slice();
  while (righe.length < minimoRighe) righe.push({ codice: '', qta: '', consegnato: false, ritirato: false, descrizione: '' });
  return righe.map(function (a) {
    return '<tr>' +
      '<td>' + escapeHtmlPdf_(a.codice) + '</td>' +
      '<td>' + escapeHtmlPdf_(a.qta) + '</td>' +
      '<td>' + casellaPdf_(a.consegnato) + '</td>' +
      '<td>' + casellaPdf_(a.ritirato) + '</td>' +
      '<td class="testo-sx">' + escapeHtmlPdf_(a.descrizione) + '</td>' +
    '</tr>';
  }).join('');
}

/** Costruisce l'HTML del Rapporto di Intervento, con la stessa impaginazione del modulo cartaceo SICURITALIA. */
function generaHtmlRapportoIntervento_(intervento, squadra) {
  var tipiSelezionati = [];
  try { tipiSelezionati = JSON.parse(intervento.rapportoTipoIntervento || '[]'); } catch (e) { tipiSelezionati = []; }
  if (!Array.isArray(tipiSelezionati)) tipiSelezionati = [];

  var righeTipiIntervento = TIPI_INTERVENTO_RAPPORTO_.map(function (t) {
    return '<td class="tipo-cell">' + casellaPdf_(tipiSelezionati.indexOf(t) !== -1) + ' ' + t + '</td>';
  }).join('');

  var oggi = formatDateStr_(dataOggi_());
  var concluso = intervento.rapportoConcluso === 'Sì';

  var html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page { size: A4; margin: 10mm; }' +
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 8.3pt; color:#000; margin:0; }' +
    'table.foglio { width:100%; border-collapse:collapse; border:1.4pt solid #000; table-layout:fixed; }' +
    'table.foglio > tbody > tr > td { border:0.6pt solid #000; padding:3pt 5pt; vertical-align:top; }' +
    '.no-border, .no-border td { border:none !important; }' +
    'table.interna { width:100%; border-collapse:collapse; table-layout:fixed; }' +
    'table.interna td { border:0.6pt solid #000; padding:2.5pt 4pt; vertical-align:top; }' +
    '.header-cell { border:none !important; padding:2pt 6pt; }' +
    '.logo-cell img { height:30pt; }' +
    '.azienda-info { font-size:6.3pt; text-align:right; line-height:1.35; vertical-align:middle; }' +
    '.title-bar { background:#dbe7f5; text-align:center; font-size:12.5pt; font-weight:bold; padding:5pt; letter-spacing:0.6pt; }' +
    '.tipo-cell { font-size:7.6pt; padding:3pt 4pt; }' +
    '.section-header { background:#dbe7f5; font-weight:bold; text-align:center; font-size:8pt; padding:2.5pt; }' +
    '.section-header .nota { font-weight:normal; font-style:italic; font-size:6.8pt; }' +
    '.lbl { font-size:6pt; color:#333; display:block; margin-bottom:1pt; }' +
    '.val { font-size:9pt; font-weight:bold; min-height:10pt; }' +
    '.chk { display:inline-block; width:7.5pt; height:7.5pt; border:0.8pt solid #000; text-align:center; ' +
      'line-height:7pt; font-size:7pt; font-weight:bold; margin-right:2pt; vertical-align:middle; }' +
    'table.articoli { width:100%; border-collapse:collapse; table-layout:fixed; }' +
    'table.articoli th { font-size:6.6pt; background:#eef3fa; padding:2pt; border:0.6pt solid #000; }' +
    'table.articoli td { text-align:center; height:12pt; border:0.6pt solid #000; padding:2pt; font-size:8pt; }' +
    'table.articoli td.testo-sx { text-align:left; }' +
    '.note-box { min-height:46pt; font-size:8.3pt; }' +
    '.legal { font-size:5.6pt; line-height:1.3; color:#000; padding:3pt 5pt; }' +
    '.firma-cella { height:44pt; text-align:center; vertical-align:bottom; }' +
    '.firma-cella img { max-height:40pt; max-width:100%; }' +
    '.firma-lbl { font-size:7.5pt; text-align:right; padding-right:6pt; }' +
    '.small { font-size:6.3pt; color:#333; }' +
    '.side-strip { width:14pt; text-align:center; vertical-align:top; }' +
    '.side-text { writing-mode:vertical-rl; transform:rotate(180deg); font-size:6.3pt; white-space:nowrap; }' +
  '</style></head><body>' +
  '<table style="width:100%;border-collapse:collapse;"><tr><td style="vertical-align:top;">' +
  '<table class="foglio"><tbody>' +

  // riga 1: logo + intestazione azienda (nessun bordo tra le due celle)
  '<tr><td colspan="2" class="no-border"><table class="interna no-border"><tr>' +
    '<td class="header-cell logo-cell" style="width:35%;"><img src="data:image/png;base64,' + LOGO_SICURITALIA_BASE64_ + '"></td>' +
    '<td class="header-cell azienda-info">SICURITALIA S.p.A. - Divisione Impianti di Sicurezza<br>' +
      'Sede legale: via Belvedere, 27a - 22100 Como<br>' +
      'tel. +39 031 5887.1 - fax +39 031 5887.2 - assistenza@sicuritalia.it - www.sicuritalia.it<br>' +
      'C.F./P.I. 07897711003 - C.C.I.A.A. COMO - Capitale Sociale € 10.000.000 i.v.</td>' +
  '</tr></table></td></tr>' +

  // titolo
  '<tr><td colspan="2" class="title-bar">RAPPORTO DI INTERVENTO</td></tr>' +

  // tipo di intervento (checkbox compilate dalla squadra)
  '<tr><td colspan="2"><table class="interna"><tr>' + righeTipiIntervento + '</tr></table></td></tr>' +

  // dati identificativi
  '<tr><td colspan="2" class="section-header">DATI IDENTIFICATIVI DEL TECNICO INTERVENUTO E DEL CLIENTE</td></tr>' +
  '<tr><td colspan="2"><table class="interna">' +
    '<tr>' +
      '<td style="width:22%;"><span class="lbl">Unità operativa</span><span class="val">' + escapeHtmlPdf_(UNITA_OPERATIVA_RAPPORTO_) + '</span></td>' +
      '<td style="width:56%;"><span class="lbl">Tecnico (nome e cognome)</span><span class="val">' + escapeHtmlPdf_(squadra ? squadra.nome : '') + '</span></td>' +
      '<td style="width:22%;"><span class="lbl">Cod.</span><span class="val">&nbsp;</span></td>' +
    '</tr>' +
    '<tr>' +
      '<td colspan="2"><span class="lbl">Intervenuto presso il cliente</span><span class="val">' + escapeHtmlPdf_(intervento.cliente) + '</span></td>' +
      '<td><span class="lbl">Telefono</span><span class="val">' + escapeHtmlPdf_(intervento.telefono) + '</span></td>' +
    '</tr>' +
    '<tr>' +
      '<td colspan="2"><span class="lbl">Indirizzo dell\'ubicazione (via e n° civico)</span><span class="val">' + escapeHtmlPdf_(intervento.indirizzo) + '</span></td>' +
      '<td><span class="lbl">Comune</span><span class="val">' + escapeHtmlPdf_(intervento.comune) + '</span><span class="lbl" style="margin-top:2pt;">Prov.</span><span class="val">&nbsp;</span></td>' +
    '</tr>' +
  '</table></td></tr>' +

  // tipo impianto
  '<tr><td colspan="2" class="section-header">TIPO D\'IMPIANTO</td></tr>' +
  '<tr><td colspan="2"><table class="interna"><tr>' +
    '<td style="width:78%;"><span class="val">' + escapeHtmlPdf_(intervento.cliente) + '</span></td>' +
    '<td style="width:22%;"><span class="lbl">Cod. Equipment</span><span class="val">' + escapeHtmlPdf_(intervento.codEquipment) + '</span></td>' +
  '</tr></table></td></tr>' +

  // causale
  '<tr><td colspan="2" class="section-header">CAUSALE DELL\'INTERVENTO</td></tr>' +
  '<tr><td colspan="2"><span class="val">' + escapeHtmlPdf_(intervento.tipoAttivita) + '</span></td></tr>' +

  // richiesto da / in data / n ordine
  '<tr><td colspan="2"><table class="interna"><tr>' +
    '<td style="width:56%;"><span class="lbl">Richiesto da</span><span class="val">' + escapeHtmlPdf_(richiestoDaRapporto_(intervento)) + '</span></td>' +
    '<td style="width:22%;"><span class="lbl">In data</span><span class="val">' + escapeHtmlPdf_(intervento.dataDispacciamento) + '</span></td>' +
    '<td style="width:22%;"><span class="lbl">N° ordine</span><span class="val">' + escapeHtmlPdf_(intervento.codiceEsterno) + '</span></td>' +
  '</tr></table></td></tr>' +

  // regime dell'intervento
  '<tr><td colspan="2" class="section-header">REGIME DELL\'INTERVENTO <span class="nota">(da compilare solo in caso di manutenzione)</span></td></tr>' +
  '<tr><td colspan="2"><table class="interna"><tr>' +
    '<td>' + casellaPdf_(true) + ' Ordinario</td>' +
    '<td>' + casellaPdf_(false) + ' In reperibilità</td>' +
    '<td>' + casellaPdf_(false) + ' In garanzia</td>' +
    '<td>' + casellaPdf_(false) + ' A pagamento</td>' +
    '<td>' + casellaPdf_(false) + ' Contratto di assistenza</td>' +
  '</tr></table></td></tr>' +

  // risorse impiegate
  '<tr><td colspan="2" class="section-header">RISORSE IMPIEGATE NELL\'INTERVENTO</td></tr>' +
  '<tr><td colspan="2"><table class="interna"><tr>' +
    '<td style="width:26%;">' +
      '<span class="lbl">Km di trasferimento (andata / ritorno)</span>' +
      '<span class="val">' + escapeHtmlPdf_(intervento.rapportoKmAndata) + ' / ' + escapeHtmlPdf_(intervento.rapportoKmRitorno) + '</span>' +
      '<span class="lbl" style="margin-top:2pt;">Tempo di trasferimento (h / m)</span>' +
      '<span class="val">' + escapeHtmlPdf_(intervento.rapportoTempoTrasferimentoOre) + ' / ' + escapeHtmlPdf_(intervento.rapportoTempoTrasferimentoMinuti) + '</span>' +
    '</td>' +
    '<td style="width:37%;">' +
      '<span class="lbl">Durata dell\'intervento</span>' +
      '<span class="val">dalle ore ' + escapeHtmlPdf_(intervento.rapportoOraInizio) + ' &nbsp; alle ore ' + escapeHtmlPdf_(intervento.rapportoOraFine) + '</span>' +
    '</td>' +
    '<td style="width:37%;">' +
      '<span class="lbl">N° tecnici aggiuntive</span>' +
      '<span class="val">' + escapeHtmlPdf_(intervento.rapportoTecniciAggiuntivi) + '</span>' +
    '</td>' +
  '</tr></table></td></tr>' +

  // tabella articoli
  '<tr><td colspan="2"><table class="articoli"><thead><tr>' +
    '<th style="width:14%;">COD. ARTICOLO</th><th style="width:8%;">Q.TA</th><th style="width:12%;">CONSEGNATO</th>' +
    '<th style="width:10%;">RITIRATO</th><th>DESCRIZIONE ARTICOLO</th>' +
  '</tr></thead><tbody>' + righeArticoliPdf_(intervento.rapportoArticoli) + '</tbody></table></td></tr>' +

  // test effettuati
  '<tr><td colspan="2" class="section-header">TEST EFFETTUATI</td></tr>' +
  '<tr><td colspan="2"><table class="interna">' +
    '<tr><td>' + casellaPdf_(false) + ' Batteria centrale</td><td>' + casellaPdf_(false) + ' Batteria periferico</td>' +
      '<td>' + casellaPdf_(false) + ' Batteria sirena esterna</td><td>' + casellaPdf_(false) + ' Ricezione messaggio in C.O.</td></tr>' +
    '<tr><td>' + casellaPdf_(false) + ' Sensori</td><td colspan="3">' + casellaPdf_(false) + ' Antirapina</td></tr>' +
  '</table></td></tr>' +

  // descrizione e note + intervento concluso
  '<tr><td colspan="2" class="section-header">DESCRIZIONE DELL\'INTERVENTO E NOTE</td></tr>' +
  '<tr><td colspan="2"><div class="note-box">' + nlToBrPdf_(intervento.rapportoNote) + '</div>' +
    '<div style="text-align:right;">Intervento concluso &nbsp; ' + casellaPdf_(concluso) + ' Sì &nbsp;&nbsp; ' + casellaPdf_(!concluso && intervento.rapportoConcluso === 'No') + ' No</div>' +
  '</td></tr>' +

  // condizioni di fornitura
  '<tr><td colspan="2" class="legal">' + CONDIZIONI_FORNITURA_RAPPORTO_ + '</td></tr>' +

  // data/ora chiusura + firme
  '<tr><td colspan="2"><table class="interna"><tr>' +
    '<td style="width:26%;"><span class="lbl">Data e ora di chiusura del rapporto di servizio</span>' +
      '<span class="val">' + escapeHtmlPdf_(oggi) + ' &nbsp; ' + escapeHtmlPdf_(intervento.rapportoOraChiusura) + '</span></td>' +
    '<td class="firma-cella" style="width:37%;">' + firmaImgPdf_(intervento.rapportoFirmaTecnico) + '<div class="firma-lbl">Il Tecnico</div></td>' +
    '<td class="firma-cella" style="width:37%;">' + firmaImgPdf_(intervento.rapportoFirmaCliente) + '<div class="firma-lbl">Il Cliente<br><span class="small">timbro e firma</span></div></td>' +
  '</tr></table>' +
  '<div class="legal" style="text-align:center;">' + NOTA_ART_1341_RAPPORTO_ + '</div>' +
  '<table class="interna"><tr>' +
    '<td style="width:63%;"><table class="interna no-border"><tr>' +
      '<td class="small">Responsabile<br>Reparto<br>Manutenzione</td>' +
      '<td class="small">Responsabile<br>Reparto<br>Installazione</td>' +
    '</tr></table></td>' +
    '<td class="firma-cella" style="width:37%;">' + firmaImgPdf_(intervento.rapportoFirmaCliente) + '<div class="firma-lbl">Il Cliente<br><span class="small">timbro e firma</span></div></td>' +
  '</tr></table></td></tr>' +

  '</tbody></table>' +
  '</td><td class="side-strip"><div class="side-text">COPIA PER IL CLIENTE &nbsp;&nbsp;&nbsp; Il Rapporto di intervento prosegue su modulo n. ______</div></td></tr></table>' +
  '</body></html>';

  return html;
}

/**
 * Genera il PDF del Rapporto e lo salva/sovrascrive nella cartella Documenti Drive dell'intervento
 * (creata al bisogno, stessa cartella del pulsante 📎 "Documenti"): se esisteva già un PDF di un
 * salvataggio precedente (rapportoPdfFileId), viene cestinato prima di crearne uno nuovo, così ne
 * resta sempre e solo uno aggiornato. Ritorna { fileId, url } del nuovo PDF.
 */
function generaEsalvaPdfRapportoIntervento_(intervento) {
  var squadra = intervento.squadraId ? readAll_('SQUADRE').filter(function (s) { return s.id === intervento.squadraId; })[0] : null;
  var html = generaHtmlRapportoIntervento_(intervento, squadra);
  var nomeFile = nomeFilePdfRapporto_(intervento);
  var blobPdf = Utilities.newBlob(html, 'text/html', nomeFile).getAs('application/pdf');
  blobPdf.setName(nomeFile);

  var folder = otteniCartellaIntervento_(intervento, true);
  if (intervento.rapportoPdfFileId) {
    try { DriveApp.getFileById(intervento.rapportoPdfFileId).setTrashed(true); } catch (e) { /* già rimosso/non trovato: non bloccante */ }
  }
  var file = folder.createFile(blobPdf);
  updateRowFields_('INTERVENTI', intervento._row, { rapportoPdfFileId: file.getId() });
  return { fileId: file.getId(), url: file.getUrl ? file.getUrl() : '' };
}
