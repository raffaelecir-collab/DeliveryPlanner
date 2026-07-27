# Delivery Planner — Ottimizzazione Percorsi per Squadre sul Territorio

Web app per creare, per ogni squadra e ogni giorno, il percorso ottimizzato tra
gli interventi selezionati: ordine di visita e orari calcolati automaticamente
rispettando l'orario di lavoro, la pausa pranzo e la finestra oraria di ogni
cliente, minimizzando gli spostamenti con tempi di viaggio reali (Google
Maps). Costruita su **Google Apps Script + Google Sheets**: nessun hosting da
gestire, dati in un unico Google Sheet, accesso già protetto dal login Google.

Tutto il codice sorgente si trova nella cartella [`gas/`](./gas).

## Come funziona

- **Google Sheets come database**: un unico foglio di calcolo contiene i fogli
  `Squadre`, `Interventi`, `Regole` e `LogPianificazione`. Li crea in
  automatico lo script (non serve prepararli a mano).
- **Web App (HtmlService)**: un'unica pagina con tab per Pianificazione,
  Interventi, Squadre e Regole, che comunica col backend tramite
  `google.script.run`.
- **Geocodifica automatica** (`Geocoding.gs`): quando salvi una squadra o un
  intervento, il rispettivo indirizzo viene convertito in coordinate tramite
  il servizio Maps integrato di Apps Script (nessuna chiave API da
  configurare).
- **Motore di ottimizzazione percorso** (`RouteEngine.gs`): il flusso è
  manuale-assistito, non un'assegnazione automatica cieca:
  1. Scegli **squadra** e **giorno**.
  2. Seleziona dall'elenco gli interventi "Da pianificare" da includere in
     quel giro (con avviso se la competenza richiesta non è tra quelle della
     squadra).
  3. Premi **"Ottimizza percorso"**: il motore calcola l'ordine di visita che
     minimizza il tempo di spostamento totale (nearest-neighbour + 2-opt
     sulla matrice dei tempi di viaggio reali via Google Maps Directions, con
     ripiego sulla stima in linea d'aria se il servizio non è disponibile),
     poi assegna gli orari rispettando:
     - **l'orario di lavoro della squadra** — il viaggio dall'indirizzo di
       partenza alla prima tappa e dall'ultima tappa all'indirizzo di rientro
       **non** viene conteggiato in questo orario (è trasferimento fuori
       turno); vengono comunque mostrati come informazione l'orario stimato
       di uscita e di rientro;
     - **l'eventuale pausa pranzo** — nessuna tappa viene collocata in quella
       fascia, lo scheduling la salta automaticamente;
     - **la finestra oraria richiesta da ciascun cliente**.
  4. Puoi affinare manualmente il percorso proposto (sposta su/giù una tappa,
     rimuovine una) prima di confermarlo: ogni modifica ricalcola subito gli
     orari.
  5. **"Conferma e salva percorso"**: scrive stato/squadra/orario sugli
     interventi coinvolti. Gli interventi che non entrano nel giro restano
     "Da pianificare" con una nota sul motivo, così restano visibili e
     gestibili (es. spostarli a un altro giorno, altra squadra, o rivedere la
     finestra oraria).

## Struttura dei file (`gas/`)

| File | Contenuto |
|---|---|
| `appsscript.json` | Manifest del progetto Apps Script (fuso orario, accesso Web App) |
| `Config.gs` | Schema dati (colonne dei fogli) e valori di default delle regole |
| `SheetService.gs` | Lettura/scrittura generica dei fogli basata sullo schema |
| `Geocoding.gs` | Conversione indirizzo → coordinate (con cache) |
| `Setup.gs` | Inizializzazione struttura fogli, menu, dati di esempio |
| `Teams.gs` / `Interventions.gs` / `Rules.gs` | CRUD (con geocodifica automatica su Squadre/Interventi) |
| `RouteEngine.gs` | Motore di ottimizzazione percorso (nearest-neighbour + 2-opt, scheduling con pausa pranzo) |
| `Code.gs` | `doGet()` e funzioni esposte al client |
| `Index.html` / `CSS.html` / `JS.html` | Interfaccia utente (SPA) |

## Come attivarla (5 minuti)

1. Vai su [sheets.google.com](https://sheets.google.com) e crea un nuovo foglio
   di calcolo (es. "Delivery Planner - Dati").
2. Nel foglio, apri **Estensioni → Apps Script**.
3. Cancella il contenuto di default di `Code.gs` e crea nell'editor Apps
   Script un file per ciascun file presente in questa cartella `gas/`
   (stesso nome, inclusa l'estensione `.gs`/`.html`), copiandone il
   contenuto. In alternativa, se usi [`clasp`](https://github.com/google/clasp)
   (CLI ufficiale Google per Apps Script):
   ```bash
   npm install -g @google/clasp
   clasp login
   cd gas
   clasp create --title "Delivery Planner" --type sheet
   clasp push
   ```
4. Nell'editor Apps Script, apri `Setup.gs` e lancia una volta la funzione
   `inizializzaApp` (menu "Esegui" ▶ seleziona `inizializzaApp` ▶ Esegui).
   Alla prima esecuzione Google chiederà di autorizzare lo script ad
   accedere al foglio e al servizio Maps: è normale, accetta.
5. (Facoltativo ma consigliato per provarla subito) Esegui `caricaDatiDiEsempio`
   per popolare 3 squadre e 5 interventi di esempio con indirizzi reali (zona
   Milano), già geocodificati.
6. Distribuisci la Web App: **Distribuisci → Nuova distribuzione → tipo
   "Applicazione web"**.
   - *Esegui come*: **Utente che accede all'applicazione**.
   - *Chi ha accesso*: scegli in base a chi deve usarla — "Chiunque abbia un
     Account Google" per il caso generale, oppure "Chiunque nell'organizzazione
     [tuo dominio]" se usi Google Workspace e vuoi limitarla al personale
     interno.
   - Copia l'URL della Web App generato: è il link da condividere con le
     squadre/operatori (equivalente al login di deliveryplanner.it, ma qui
     l'autenticazione è già quella del loro account Google).
7. Riapri il Google Sheet: nel menu **Delivery Planner** (creato in automatico)
   trovi anche una voce "Apri Web App" che mostra l'URL corrente in qualsiasi
   momento.

## Uso quotidiano

1. Tab **Squadre**: censisci le squadre con competenze (promemoria),
   indirizzo di partenza a inizio turno, indirizzo di rientro a fine turno
   (lascia vuoto se coincide con la partenza), orario di lavoro e, se
   presente, la fascia della pausa pranzo. Indirizzo di partenza e rientro
   vengono geocodificati automaticamente al salvataggio.
2. Tab **Interventi**: inserisci gli interventi da pianificare (cliente,
   indirizzo — geocodificato automaticamente —, competenza richiesta,
   priorità, durata stimata, finestra oraria, eventuale non-prima-del/scadenza
   informativi).
3. Tab **Pianificazione** — due modalità, per la squadra scelta in alto:
   - **Selezione manuale (singolo giorno)**: scegli il giorno, carica gli
     interventi disponibili, seleziona quelli da includere, premi "Ottimizza
     percorso", eventualmente affina l'ordine (frecce su/giù, rimuovi tappa)
     e premi "Conferma e salva percorso".
   - **Pianificazione automatica su intervallo**: scegli un intervallo
     Dal/Al e premi "Pianifica intervallo": il sistema genera e **scrive
     subito** (senza passaggio di conferma) un percorso ottimizzato per
     ciascun giorno dell'intervallo, usando via via gli interventi "Da
     pianificare" ancora disponibili e compatibili (qui la competenza
     richiesta è un filtro rigido, non solo un avviso). Utile per riempire
     più giorni in un colpo solo; gli interventi che non trovano posto in
     nessun giorno dell'intervallo restano "Da pianificare" con una nota sul
     motivo.

   In fondo alla pagina trovi il riepilogo dei percorsi già confermati per il
   giorno selezionato, per tutte le squadre.
4. Tab **Regole**: puoi modificare a caldo i parametri del motore (pesi delle
   priorità usati come criterio secondario nell'ordinamento, buffer di
   setup/parcheggio tra due tappe, velocità media di fallback) senza toccare
   il codice.

Ogni percorso confermato (in entrambe le modalità) viene registrato nel
foglio `LogPianificazione` (visibile in fondo al tab Regole), utile per
tracciare chi ha pianificato cosa e quando.

### Inserire righe direttamente sul Google Sheet

Puoi anche aggiungere Squadre o Interventi scrivendo direttamente le righe sul
foglio invece di usare i form della Web App. In quel caso:

- l'ID e la geocodifica degli indirizzi (lat/lng) non vengono generati in
  automatico, e la casella "Attiva" delle Squadre — se lasciata vuota —
  viene comunque considerata attiva per non far sparire la squadra dai
  selettori;
- apri comunque una volta la riga dal tab **Squadre**/**Interventi** →
  "Modifica" → "Salva" (anche senza cambiare nulla): l'app le assegna un ID
  e geocodifica gli indirizzi, dopodiché la riga si comporta come se fosse
  stata creata dai form. Finché non fai questo passaggio, la pianificazione
  di un intervento/squadra inserito a mano darà errore "indirizzo non
  geocodificato".

## Nota sul servizio Google Maps

Geocodifica e calcolo dei tempi di viaggio reali usano il servizio `Maps`
integrato di Apps Script (classi `Maps.newGeocoder()` e
`Maps.newDirectionFinder()`): non serve creare una chiave API né abilitare
servizi avanzati. È soggetto alle quote giornaliere di Google per l'account
che esegue lo script; se una chiamata fallisce (quota esaurita o servizio
non disponibile), il motore ricade automaticamente su una stima in linea
d'aria (velocità media configurabile in Regole) e la tappa viene comunque
pianificata, segnalata come "stimata" invece che "reale" nell'anteprima del
percorso. I risultati di geocodifica e tempi di viaggio restano in cache 6
ore per ridurre il numero di chiamate quando ricorrono gli stessi indirizzi
(base delle squadre, clienti abituali).

## Personalizzazioni comuni

- **Nuovi campi su Squadre/Interventi**: aggiungi una voce all'array `fields`
  corrispondente in `Config.gs` — form e tabella si aggiornano da soli perché
  generati dinamicamente dallo schema.
- **Bilanciamento del carico tra squadre o altre regole aggiuntive**: il
  punto di innesto è `ordinaNearestNeighbor_` (ordine di visita) e
  `pianificaOrarioPercorso_` (assegnazione orari) in `RouteEngine.gs`.
