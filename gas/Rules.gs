/**
 * Lettura/scrittura delle regole di pianificazione (foglio "Regole", coppie chiave/valore).
 */

/** Elenco regole con `tipo` e `categoria` allegati (da REGOLE_DEFAULT) per guidare il rendering
 *  del form lato client (tipo di controllo, e raggruppamento visivo per categoria — vedi
 *  renderRegole in JS.html). Nessuno dei due è persistito come colonna sul foglio Regole. */
function listaRegole() {
  richiedeAdmin_();
  inizializzaRegoleDefault_();
  var tipoPerChiave = {};
  var categoriaPerChiave = {};
  REGOLE_DEFAULT.forEach(function (r) {
    tipoPerChiave[r.chiave] = r.tipo || 'numero';
    categoriaPerChiave[r.chiave] = r.categoria || '';
  });
  return readAll_('REGOLE').map(function (r) {
    return Object.assign({}, r, { tipo: tipoPerChiave[r.chiave] || 'testo', categoria: categoriaPerChiave[r.chiave] || '' });
  });
}

function salvaRegola(regola) {
  richiedeAdmin_();
  if (!regola.chiave) throw new Error('La chiave della regola è obbligatoria.');
  var defaultRegola = REGOLE_DEFAULT.filter(function (r) { return r.chiave === regola.chiave; })[0];
  if (defaultRegola && defaultRegola.tipo === 'percentuale') {
    var percentuale = parseFloat(regola.valore);
    if (isNaN(percentuale)) throw new Error('Il valore di "' + regola.chiave + '" deve essere un numero (percentuale 0-100).');
    regola.valore = String(Math.max(0, Math.min(100, percentuale)));
  }
  var esistenti = readAll_('REGOLE');
  var match = esistenti.filter(function (r) { return r.chiave === regola.chiave; })[0];
  if (match) {
    updateRowFields_('REGOLE', match._row, { valore: regola.valore });
    return Object.assign({}, match, { valore: regola.valore });
  }
  return upsertRow_('REGOLE', regola);
}

/** Restituisce le regole come mappa chiave -> valore tipizzato (numero se numerico). */
function getRegoleMappa_() {
  var righe = listaRegole();
  var mappa = {};
  righe.forEach(function (r) {
    var v = r.valore;
    if (v !== '' && !isNaN(v)) v = parseFloat(v);
    mappa[r.chiave] = v;
  });
  return mappa;
}
