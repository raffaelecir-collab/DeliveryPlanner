/**
 * Lettura/scrittura delle regole di pianificazione (foglio "Regole", coppie chiave/valore).
 */

function listaRegole() {
  inizializzaRegoleDefault_();
  return readAll_('REGOLE');
}

function salvaRegola(regola) {
  if (!regola.chiave) throw new Error('La chiave della regola è obbligatoria.');
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
