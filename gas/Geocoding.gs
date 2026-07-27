/**
 * Geocodifica indirizzi in coordinate (lat/lng). Prova prima il servizio Maps
 * integrato di Apps Script (Maps.newGeocoder()); se non è disponibile, fallisce
 * o non trova risultati (capita con alcuni account/indirizzi anche quando
 * l'indirizzo è corretto), ripiega su Nominatim (OpenStreetMap), un servizio di
 * geocodifica pubblico e gratuito senza chiave API. I risultati sono cachati
 * per ridurre il numero di chiamate quando lo stesso indirizzo ricorre spesso
 * (base delle squadre, clienti abituali).
 */

function normalizzaIndirizzo_(indirizzo) {
  return String(indirizzo || '').trim().toLowerCase();
}

function geocodificaConMaps_(indirizzo) {
  var geocoder = Maps.newGeocoder();
  var response = geocoder.geocode(indirizzo);
  if (response && response.results && response.results.length > 0) {
    var loc = response.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

function geocodificaConNominatim_(indirizzo) {
  var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(indirizzo);
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'DeliveryPlannerAppsScript/1.0 (Google Apps Script)' }
  });
  if (response.getResponseCode() !== 200) return null;
  var data = JSON.parse(response.getContentText());
  if (data && data.length > 0) {
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }
  return null;
}

/**
 * Restituisce { lat, lng } per un indirizzo, oppure null se non è stato possibile
 * geocodificarlo con nessuno dei due servizi (indirizzo vuoto o non trovato).
 * Eventuali errori dei singoli servizi vengono registrati nel log di esecuzione
 * (Apps Script → Esecuzioni) invece di essere ignorati silenziosamente.
 */
function geocodifica_(indirizzo) {
  var chiaveNorm = normalizzaIndirizzo_(indirizzo);
  if (!chiaveNorm) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'geo:' + chiaveNorm;
  var cached = cache.get(cacheKey);
  if (cached) {
    if (cached === 'NULL') return null;
    return JSON.parse(cached);
  }

  var risultato = null;

  try {
    risultato = geocodificaConMaps_(indirizzo);
  } catch (e) {
    console.error('Geocodifica con servizio Maps fallita per "' + indirizzo + '": ' + e.message);
  }

  if (!risultato) {
    try {
      risultato = geocodificaConNominatim_(indirizzo);
    } catch (e) {
      console.error('Geocodifica con Nominatim fallita per "' + indirizzo + '": ' + e.message);
    }
  }

  cache.put(cacheKey, risultato ? JSON.stringify(risultato) : 'NULL', 21600);
  return risultato;
}
