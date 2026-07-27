/**
 * Servizio generico di accesso ai fogli Google Sheets, basato sullo SCHEMA
 * definito in Config.gs. Ogni riga del foglio viene letta/scritta come
 * oggetto JS le cui chiavi corrispondono a field.key dello schema, più
 * il campo tecnico _row (numero di riga fisica sul foglio, 1-based).
 */

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/** Garantisce che l'intestazione del foglio corrisponda ai field label dello schema. */
function ensureHeader_(schemaDef) {
  var sheet = getOrCreateSheet_(schemaDef.sheetName);
  var headers = schemaDef.fields.map(function (f) { return f.label; });
  var range = sheet.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0];
  var needsWrite = false;
  for (var i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) { needsWrite = true; break; }
  }
  if (needsWrite) {
    range.setValues([headers]);
    sheet.setFrozenRows(1);
    // Le colonne "data" vengono gestite come testo dd/MM/yyyy dal codice: forziamo
    // il formato testo per evitare che Sheets le reinterpreti in base al locale del foglio.
    schemaDef.fields.forEach(function (field, idx) {
      if (field.type === 'date') {
        sheet.getRange(2, idx + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      }
    });
  }
  return sheet;
}

function formatCellValue_(field, value) {
  if (value === null || value === undefined) return '';
  if (field.type === 'date' && value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  if (field.type === 'checkbox') {
    return value === true || value === 'TRUE' || value === 'true';
  }
  return value;
}

function parseCellValue_(field, raw) {
  if (field.type === 'number') {
    var n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }
  if (field.type === 'checkbox') {
    // Una cella vuota (es. riga inserita a mano senza spuntare la casella) ricade
    // sul default dello schema invece di essere trattata come "falso": altrimenti
    // una squadra creata direttamente sul foglio, senza "Attiva" = VERO, sparirebbe
    // silenziosamente da tutti i selettori.
    if (raw === '' || raw === null || raw === undefined) {
      return field.default !== undefined ? field.default : false;
    }
    return raw === true || raw === 'TRUE' || raw === 'true';
  }
  if (field.type === 'date') {
    if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    return raw ? String(raw) : '';
  }
  return raw === null || raw === undefined ? '' : String(raw);
}

/** Legge tutte le righe di un foglio come array di oggetti { ...campi, _row }. */
function readAll_(schemaKey) {
  var schemaDef = SCHEMA[schemaKey];
  var sheet = ensureHeader_(schemaDef);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var numCols = schemaDef.fields.length;
  var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var isEmpty = row.every(function (v) { return v === '' || v === null || v === undefined; });
    if (isEmpty) continue;
    var obj = { _row: r + 2 };
    for (var c = 0; c < schemaDef.fields.length; c++) {
      var field = schemaDef.fields[c];
      obj[field.key] = parseCellValue_(field, row[c]);
    }
    out.push(obj);
  }
  return out;
}

function objectToRowArray_(schemaDef, obj) {
  return schemaDef.fields.map(function (field) {
    var value = obj[field.key];
    if ((value === undefined || value === null || value === '') && field.default !== undefined && !obj._existing) {
      value = field.default;
    }
    return formatCellValue_(field, value);
  });
}

function generateId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Math.floor(Math.random() * 9000 + 1000);
}

/**
 * Crea o aggiorna una riga. Se obj.id è presente e già esistente aggiorna la riga,
 * altrimenti genera un nuovo id e accoda una nuova riga. Se obj.id è assente ma
 * obj._row è noto (riga inserita/modificata a mano sul foglio, senza ID) aggiorna
 * comunque quella riga per numero e le assegna un ID, invece di duplicarla.
 */
function upsertRow_(schemaKey, obj) {
  var schemaDef = SCHEMA[schemaKey];
  var sheet = ensureHeader_(schemaDef);
  var existing = null;
  if (obj.id) {
    existing = readAll_(schemaKey).filter(function (r) { return r.id === obj.id; })[0];
  } else if (obj._row) {
    existing = readAll_(schemaKey).filter(function (r) { return r._row === obj._row; })[0];
  }
  var idColIndex = schemaDef.fields.findIndex(function (f) { return f.key === 'id'; });

  if (existing) {
    var merged = Object.assign({}, existing, obj, { _existing: true });
    if (idColIndex >= 0 && !merged.id) merged.id = generateId_(schemaDef.idPrefix || 'ID');
    var rowArray = objectToRowArray_(schemaDef, merged);
    sheet.getRange(existing._row, 1, 1, rowArray.length).setValues([rowArray]);
    return merged;
  } else {
    var newObj = Object.assign({}, obj);
    if (idColIndex >= 0) {
      newObj.id = obj.id || generateId_(schemaDef.idPrefix || 'ID');
    }
    var newRowArray = objectToRowArray_(schemaDef, newObj);
    sheet.appendRow(newRowArray);
    newObj._row = sheet.getLastRow();
    return newObj;
  }
}

/** Aggiorna solo alcuni campi di una riga già nota (per _row), usato dal motore di pianificazione. */
function updateRowFields_(schemaKey, rowNumber, fieldsObj) {
  var schemaDef = SCHEMA[schemaKey];
  var sheet = getOrCreateSheet_(schemaDef.sheetName);
  schemaDef.fields.forEach(function (field, idx) {
    if (Object.prototype.hasOwnProperty.call(fieldsObj, field.key)) {
      sheet.getRange(rowNumber, idx + 1).setValue(formatCellValue_(field, fieldsObj[field.key]));
    }
  });
}

/**
 * Elimina una riga per id. Se l'id è assente (riga inserita a mano sul foglio,
 * senza ID) ricade su rowFallback (numero di riga fisica), sempre univoco.
 */
function deleteRow_(schemaKey, id, rowFallback) {
  var schemaDef = SCHEMA[schemaKey];
  var sheet = getOrCreateSheet_(schemaDef.sheetName);
  var all = readAll_(schemaKey);
  var target = id ? all.filter(function (r) { return r.id === id; })[0] : null;
  if (!target && rowFallback) {
    target = all.filter(function (r) { return r._row === rowFallback; })[0];
  }
  if (target) {
    sheet.deleteRow(target._row);
    return true;
  }
  return false;
}
