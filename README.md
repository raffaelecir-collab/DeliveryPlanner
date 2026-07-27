# Delivery Planner — Pianificazione Territoriale Intelligente

Web app per pianificare in modo automatico gli interventi sul territorio tra più
squadre di lavoro, applicando regole configurabili (priorità/urgenza, finestre
orarie, copertura zona/competenza, clustering geografico per minimizzare gli
spostamenti). Costruita su **Google Apps Script + Google Sheets**: nessun
hosting da gestire, dati in un unico Google Sheet, accesso già protetto dal
login Google.

Tutto il codice sorgente si trova nella cartella [`gas/`](./gas).

## Come funziona

- **Google Sheets come database**: un unico foglio di calcolo contiene i fogli
  `Squadre`, `Zone`, `Interventi`, `Regole` e `LogPianificazione`. Li crea in
  automatico lo script (non serve prepararli a mano).
- **Web App (HtmlService)**: un'unica pagina con tab per Pianificazione,
  Interventi, Squadre, Zone e Regole, che comunica col backend tramite
  `google.script.run`.
- **Motore di pianificazione** (`PlanningEngine.gs`): per ogni giorno
  dell'orizzonte selezionato e per ogni squadra attiva, assegna in ordine gli
  interventi "Da pianificare" rispettando:
  1. **Copertura territoriale e competenza** — una squadra prende solo
     interventi nelle zone che copre e con la competenza richiesta (se
     specificata).
  2. **Priorità/urgenza e finestra oraria del cliente** — un intervento
     Urgente/con scadenza vicina viene sempre preferito a uno a bassa
     priorità; un intervento non può essere assegnato fuori dalla propria
     finestra oraria.
  3. **Clustering geografico** — a parità di priorità viene scelto
     l'intervento più vicino all'ultima tappa della squadra (calcolo
     distanza haversine su lat/lng, oppure centroide della zona), per
     ridurre gli spostamenti e creare giri di lavoro compatti.
  4. **Capacità giornaliera** — minuti di lavoro disponibili e orario della
     squadra.
  
  Gli interventi che non trovano posto nell'orizzonte selezionato vengono
  marcati "Non pianificabile" con il motivo, in modo da restare visibili e
  gestibili manualmente (es. aggiungere una squadra, allargare l'orizzonte,
  rivedere la finestra oraria).

## Struttura dei file (`gas/`)

| File | Contenuto |
|---|---|
| `appsscript.json` | Manifest del progetto Apps Script (fuso orario, accesso Web App) |
| `Config.gs` | Schema dati (colonne dei fogli) e valori di default delle regole |
| `SheetService.gs` | Lettura/scrittura generica dei fogli basata sullo schema |
| `Setup.gs` | Inizializzazione struttura fogli, menu, dati di esempio |
| `Teams.gs` / `Zones.gs` / `Interventions.gs` / `Rules.gs` | CRUD |
| `PlanningEngine.gs` | Motore di pianificazione intelligente |
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
   accedere al foglio: è normale, accetta.
5. (Facoltativo ma consigliato per provarla subito) Esegui `caricaDatiDiEsempio`
   per popolare 3 squadre, 3 zone e 5 interventi di esempio.
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

1. Tab **Squadre**: censisci le squadre con competenze, zone coperte, orario
   di lavoro, capacità giornaliera (minuti) e, se vuoi sfruttare il
   clustering geografico, le coordinate della base di partenza.
2. Tab **Zone**: censisci le zone del territorio (nome e, per il clustering,
   le coordinate del centroide).
3. Tab **Interventi**: inserisci gli interventi da pianificare (cliente,
   indirizzo, zona, competenza richiesta, priorità, durata stimata, finestra
   oraria, eventuale scadenza).
4. Tab **Pianificazione**: scegli l'intervallo di date e premi "Esegui
   pianificazione". Il piano squadra-per-giorno appare subito sotto, con il
   riepilogo di quanti interventi sono stati assegnati e quali non lo sono
   stati (con motivo).
5. Tab **Regole**: puoi modificare a caldo i parametri del motore (pesi delle
   priorità, buffer di viaggio, velocità media per il calcolo degli
   spostamenti, giorni lavorativi, orizzonte di pianificazione di default)
   senza toccare il codice.

Ogni esecuzione della pianificazione viene anche registrata nel foglio
`LogPianificazione` (visibile in fondo al tab Regole), utile per tracciare chi
ha pianificato cosa e quando.

## Personalizzazioni comuni

- **Nuove competenze/zone**: bastano nuove righe nei rispettivi fogli, non
  serve modificare codice.
- **Nuovi campi sugli interventi**: aggiungi una voce all'array `fields` di
  `INTERVENTI` in `Config.gs` — form e tabella si aggiornano da soli perché
  generati dinamicamente dallo schema.
- **Regole aggiuntive** (es. bilanciamento del carico tra squadre): il punto
  di innesto è `pianificaGiornoPerSquadra_` in `PlanningEngine.gs`, dove
  vengono filtrati/ordinati i candidati per ogni squadra/giorno.
