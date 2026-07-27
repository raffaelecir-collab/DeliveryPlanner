/**
 * Geocodifica indirizzi in coordinate (lat/lng) usando il servizio Maps integrato
 * di Apps Script (nessuna chiave API da configurare). I risultati sono cachati
 * per ridurre il numero di chiamate quando lo stesso indirizzo ricorre spesso
 * (base delle squadre, clienti abituali).
 */

function normalizzaIndirizzo_(indirizzo) {
  return String(indirizzo || '').trim().toLowerCase();
}

/**
 * Restituisce { lat, lng } per un indirizzo, oppure null se non è stato possibile
 * geocodificarlo (indirizzo vuoto, non trovato, o servizio non disponibile).
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
    var geocoder = Maps.newGeocoder();
    var response = geocoder.geocode(indirizzo);
    if (response && response.results && response.results.length > 0) {
      var loc = response.results[0].geometry.location;
      risultato = { lat: loc.lat, lng: loc.lng };
    }
  } catch (e) {
    risultato = null;
  }

  cache.put(cacheKey, risultato ? JSON.stringify(risultato) : 'NULL', 21600);
  return risultato;
}
