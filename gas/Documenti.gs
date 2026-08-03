/**
 * Documenti allegati agli Interventi, archiviati su Google Drive: una sottocartella per
 * intervento dentro la cartella radice configurata (regola "driveCartellaRadiceId"), nominata
 * "yyyyMMdd_ODS_Cliente" (yyyyMMdd = Data Dispacciamento, o oggi se assente; ODS = Codice
 * Esterno, o "SENZA-ODS" se non ancora valorizzato — la cartella viene rinominata da sola non
 * appena il Codice Esterno viene inserito). L'account che esegue la Web App (impostazioni di
 * distribuzione, "Esegui come") deve avere accesso in scrittura alla cartella radice.
 *
 * Visibilità: Admin e Cliente possono caricare ed eliminare documenti di qualunque intervento;
 * un account Squadra può solo VISUALIZZARE quelli della propria squadra (mai caricare/eliminare).
 * La cartella di ogni intervento viene condivisa in visualizzazione con l'elenco email Cliente
 * (regola "emailClienti") e con le email della squadra assegnata (campo "emailSquadra" della
 * Squadra), invece di un link pubblico: la condivisione viene ricontrollata/aggiornata ad ogni
 * accesso, così un cambio di squadra o un aggiornamento degli elenchi email si riflette da solo.
 */

/**
 * Legge la regola "driveCartellaRadiceId" direttamente dal foglio (non tramite
 * listaRegole_/getRegoleMappa_, che sono protette da richiedeAdmin_): questa funzione deve poter
 * essere chiamata anche da account Cliente/Squadra per vedere/caricare i documenti, quindi non
 * può passare da una funzione riservata all'Admin — stesso motivo di emailClientiConfigurate_
 * in Auth.gs.
 */
function cartellaRadiceDocumenti_() {
  var riga = readAll_('REGOLE').filter(function (r) { return r.chiave === 'driveCartellaRadiceId'; })[0];
  var id = riga && riga.valore ? String(riga.valore).trim() : '';
  if (!id) throw new Error('Nessuna cartella Drive configurata per i documenti (regola "driveCartellaRadiceId", tab Regole).');
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('Impossibile aprire la cartella Drive configurata (ID "' + id + '"): ' + e.message +
      '. Verifica che l\'account che esegue la Web App abbia accesso in scrittura a quella cartella.');
  }
}

/** Rimuove caratteri problematici in un nome di cartella/file Drive e normalizza gli spazi. */
function sanitizzaNomeCartella_(s) {
  return String(s || '').replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim();
}

function formatoDataCompatta_(dataStr) {
  var d = dataStr ? parseDateStr_(dataStr) : null;
  if (!d) d = dataOggi_();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyyMMdd');
}

/** "yyyyMMdd_ODS_Cliente" per la sottocartella documenti di un intervento. */
function nomeCartellaIntervento_(intervento) {
  var dataCompatta = formatoDataCompatta_(intervento.dataDispacciamento);
  var codice = intervento.codiceEsterno ? sanitizzaNomeCartella_(intervento.codiceEsterno) : 'SENZA-ODS';
  var cliente = sanitizzaNomeCartella_(intervento.cliente) || '(senza nome)';
  return dataCompatta + '_' + codice + '_' + cliente;
}

/**
 * Condivide la cartella (in sola visualizzazione) con l'elenco Cliente e con la squadra
 * assegnata all'intervento, senza duplicare chi ha già accesso. Un'email non valida o non
 * condivisibile (es. dominio con condivisione esterna disattivata) viene ignorata: non deve
 * bloccare l'operazione per cui è stata chiamata (caricare/vedere un documento).
 */
function condividiCartellaConAutorizzati_(folder, intervento) {
  var email = emailClientiConfigurate_().slice();
  if (intervento.squadraId) {
    var squadra = readAll_('SQUADRE').filter(function (s) { return s.id === intervento.squadraId; })[0];
    if (squadra && squadra.emailSquadra) email = email.concat(splitList_(squadra.emailSquadra));
  }
  var giaCondivisi = {};
  try {
    folder.getViewers().concat(folder.getEditors()).forEach(function (u) {
      giaCondivisi[u.getEmail().toLowerCase()] = true;
    });
  } catch (e) { /* se non leggibili, si prova comunque ad aggiungere sotto */ }
  email.forEach(function (e) {
    var trimmed = String(e || '').trim();
    if (!trimmed || giaCondivisi[trimmed.toLowerCase()]) return;
    try { folder.addViewer(trimmed); } catch (err) { /* email non valida/non condivisibile: non bloccante */ }
  });
}

/**
 * Recupera (e se serve rinomina/ri-condivide) la sottocartella documenti di un intervento; se
 * non esiste ancora, la crea solo se `creaSeMancante` (evita cartelle vuote per interventi mai
 * documentati). Salva l'id su driveFolderId al primo utilizzo.
 */
function otteniCartellaIntervento_(intervento, creaSeMancante) {
  var folder = null;
  if (intervento.driveFolderId) {
    try { folder = DriveApp.getFolderById(intervento.driveFolderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    if (!creaSeMancante) return null;
    var radice = cartellaRadiceDocumenti_();
    folder = radice.createFolder(nomeCartellaIntervento_(intervento));
    updateRowFields_('INTERVENTI', intervento._row, { driveFolderId: folder.getId() });
  } else {
    var nomeAtteso = nomeCartellaIntervento_(intervento);
    if (folder.getName() !== nomeAtteso) {
      try { folder.setName(nomeAtteso); } catch (e) { /* non bloccante */ }
    }
  }
  condividiCartellaConAutorizzati_(folder, intervento);
  return folder;
}

function elencoFileCartella_(folder) {
  var out = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    out.push({
      id: f.getId(),
      nome: f.getName(),
      url: f.getUrl(),
      dataCreazione: Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      mimeType: f.getMimeType()
    });
  }
  out.sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1; });
  return out;
}

/** Elenco documenti di un intervento. Un account Squadra può vederli solo per la propria squadra. */
function listaDocumentiIntervento(id, row) {
  var intervento = trovaInterventoPerIdORiga_(id, row);
  if (!intervento) throw new Error('Intervento non trovato.');
  verificaAccessoSquadraIntervento_(intervento);
  var folder = otteniCartellaIntervento_(intervento, false);
  return folder ? elencoFileCartella_(folder) : [];
}

/** Carica un documento sulla cartella dell'intervento (Admin/Cliente). Ritorna l'elenco aggiornato. */
function caricaDocumentoIntervento(id, row, nomeFile, mimeType, contenutoBase64) {
  richiedeNonSquadra_();
  var intervento = trovaInterventoPerIdORiga_(id, row);
  if (!intervento) throw new Error('Intervento non trovato.');
  if (!nomeFile || !contenutoBase64) throw new Error('Seleziona un file valido.');
  var folder = otteniCartellaIntervento_(intervento, true);
  var bytes = Utilities.base64Decode(contenutoBase64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', nomeFile);
  folder.createFile(blob);
  return elencoFileCartella_(folder);
}

/** Elimina (cestina) un documento dell'intervento (Admin/Cliente). Ritorna l'elenco aggiornato. */
function eliminaDocumentoIntervento(id, row, fileId) {
  richiedeNonSquadra_();
  var intervento = trovaInterventoPerIdORiga_(id, row);
  if (!intervento) throw new Error('Intervento non trovato.');
  var folder = otteniCartellaIntervento_(intervento, false);
  if (!folder) throw new Error('Nessun documento per questo intervento.');
  // Verifica che il file appartenga davvero alla cartella di QUESTO intervento (mai un id arbitrario).
  var files = folder.getFiles();
  var appartiene = false;
  while (files.hasNext()) { if (files.next().getId() === fileId) { appartiene = true; break; } }
  if (!appartiene) throw new Error('Documento non trovato per questo intervento.');
  DriveApp.getFileById(fileId).setTrashed(true);
  return elencoFileCartella_(folder);
}
