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
  Interventi, Programmazione, Squadre e Regole, che comunica col backend
  tramite `google.script.run`.
- **Geocodifica automatica** (`Geocoding.gs`): quando salvi una squadra o un
  intervento, il rispettivo indirizzo viene convertito in coordinate tramite
  il servizio Maps integrato di Apps Script (nessuna chiave API da
  configurare).
- **Motore di ottimizzazione percorso** (`RouteEngine.gs`): il flusso è
  manuale-assistito, non un'assegnazione automatica cieca:
  1. Scegli **squadra** e **giorno**.
  2. Seleziona dall'elenco gli interventi "Da pianificare" da includere in
     quel giro. La **competenza richiesta è un vincolo rigido anche qui**: un
     intervento la cui competenza non è tra quelle della squadra scelta ha la
     casella disabilitata (non selezionabile), con l'icona ⚠ a indicarne il
     motivo — resta comunque deselezionabile se era già pianificato per quella
     squadra prima di un cambio di competenze.
  3. Premi **"Ottimizza percorso"**: il motore calcola l'ordine di visita che
     minimizza il tempo di spostamento totale, per massimizzare quanti
     interventi entrano nel tempo disponibile (costruzione a "inserimento più
     economico" con seme scelto per priorità e densità dell'area — le zone con
     più interventi vicini vengono privilegiate e completate per intero, e gli
     interventi geograficamente "di passaggio" tra due tappe già pianificate
     vengono raccolti automaticamente — più raffinamento 2-opt e un passaggio
     finale di "riempimento" che tenta di aggiungere in coda gli interventi
     scartati più economici da raggiungere, per non lasciare la giornata a
     metà quando c'è ancora tempo utile). Le distanze usano una stima in linea
     d'aria per scegliere rapidamente ordine e composizione del percorso, poi
     vengono aggiornate con i tempi reali via Google Maps Directions solo sui
     tratti effettivamente scelti (così anche pianificando decine di
     interventi su più giorni/squadre il calcolo resta rapido). Il motore
     assegna poi gli orari rispettando:
     - **l'orario di lavoro della squadra** — il viaggio dall'indirizzo di
       partenza alla prima tappa e dall'ultima tappa all'indirizzo di rientro
       **non** viene conteggiato in questo orario (è trasferimento fuori
       turno); vengono comunque mostrati come informazione l'orario stimato
       di uscita e di rientro;
     - **l'eventuale pausa pranzo** — non si può mai *iniziare* un nuovo
       intervento durante la pausa (slitta a fine pausa). Un intervento già in
       corso quando inizia la pausa può sconfinarci dentro solo entro la
       tolleranza impostata in Regole (**pausaTolleranzaMinuti**, default 15
       minuti): un piccolo sconfinamento viene tollerato senza interrompere il
       lavoro, ma oltre quella soglia la pausa viene inserita per intero (il
       tecnico si ferma davvero e riprende a fine pausa), spostando in avanti
       il completamento reale dell'intervento e, di conseguenza, l'orario
       delle tappe successive;
     - **la finestra oraria richiesta da ciascun cliente**;
     - **l'eventuale indisponibilità della squadra** — giorni settimanali di
       riposo specifici (oltre ai giorni lavorativi generali) e periodi di
       ferie/assenza impostati sulla scheda della squadra: nei giorni
       coperti da questi non le viene assegnato alcun intervento (la
       selezione manuale su quel giorno viene bloccata con un errore
       esplicito).
  4. Puoi affinare manualmente il percorso proposto (sposta su/giù una tappa,
     rimuovine una) prima di confermarlo: ogni modifica ricalcola subito gli
     orari.
  5. **"Conferma e salva percorso"**: scrive stato/squadra/orario sugli
     interventi coinvolti. Gli interventi che non entrano nel giro restano
     "Da pianificare" con una nota sul motivo, così restano visibili e
     gestibili (es. spostarli a un altro giorno, altra squadra, o rivedere la
     finestra oraria). **Non è obbligatorio riempire per forza tutte le
     squadre**: se gli interventi disponibili bastano solo per alcune, le
     altre restano semplicemente senza percorso per quel giorno (nessuna
     tappa "finta" viene creata) — nella pianificazione automatica su
     intervallo questo viene indicato esplicitamente (vedi sotto).

## Struttura dei file (`gas/`)

| File | Contenuto |
|---|---|
| `appsscript.json` | Manifest del progetto Apps Script (fuso orario, accesso Web App) |
| `Config.gs` | Schema dati (colonne dei fogli) e valori di default delle regole |
| `SheetService.gs` | Lettura/scrittura generica dei fogli basata sullo schema |
| `Geocoding.gs` | Conversione indirizzo → coordinate (con cache) |
| `Triggers.gs` | Trigger installabile: geocodifica automatica quando un indirizzo viene scritto direttamente sul foglio |
| `Setup.gs` | Inizializzazione struttura fogli, menu, dati di esempio |
| `Teams.gs` / `Interventions.gs` / `Rules.gs` | CRUD (con geocodifica automatica su Squadre/Interventi) |
| `RouteEngine.gs` | Motore di ottimizzazione percorso (inserimento più economico + 2-opt, scheduling con pausa pranzo, vista "Programmazione" e riempimento buchi) |
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

1. Tab **Squadre**: censisci le squadre con competenze, indirizzo di partenza
   a inizio turno, indirizzo di rientro a fine turno (lascia vuoto se
   coincide con la partenza), orario di lavoro e, se presente, la fascia
   della pausa pranzo. Indirizzo di partenza e rientro vengono geocodificati
   automaticamente al salvataggio. Le **competenze sono un vincolo rigido**
   (non solo un promemoria): una squadra senza una data competenza non potrà
   mai essere assegnata a un intervento che la richiede, né nella selezione
   manuale né nella pianificazione automatica (lascia il campo vuoto se la
   squadra copre qualsiasi competenza). Sulla stessa scheda puoi indicare
   l'**indisponibilità della squadra**: un selettore dei **giorni della
   settimana** in cui quella squadra in particolare non lavora (es. un
   part-time con giorno di riposo infrasettimanale, oltre ai giorni
   lavorativi generali impostati in Regole) e uno o più **periodi di
   ferie/assenza** (Dal/Al, aggiungibili con "+ Aggiungi periodo"): nei
   giorni coperti da questi la squadra non viene mai considerata dalla
   pianificazione (né manuale né automatica). Puoi anche impostare un
   **Target Produzione Giornaliera (€)**: un obiettivo di ricavo che la
   squadra dovrebbe idealmente raggiungere in un giorno (vedi più sotto).
2. Tab **Interventi**: inserisci gli interventi da pianificare (cliente,
   indirizzo — geocodificato automaticamente —, competenza richiesta,
   priorità, durata stimata, finestra oraria, **telefono** del cliente per
   contattarlo sul campo, **ricavo (€)** dell'intervento (usato per
   calcolare la produzione della squadra), eventuale non-prima-del/scadenza
   informativi).

   Sotto ogni campo indirizzo (Squadre e Interventi) c'è un link **"🗺️
   Mostra mappa"**: apre un'anteprima piccola e ridimensionabile (trascina
   l'angolo in basso a destra per ingrandirla) che mostra la posizione
   geocodificata già salvata, oppure — se manca — un avviso più un'anteprima
   di ricerca basata sul testo digitato, utile per individuare un indirizzo
   scritto male prima ancora di salvare. Nota: la prima volta che apri una
   mappa, Google può mostrare un banner di consenso cookie dentro il
   riquadro stesso — è normale, basta accettarlo una volta.
3. Tab **Pianificazione** — due modalità, per la squadra scelta in alto:
   - **Selezione manuale (singolo giorno)**: scegli il giorno, carica gli
     interventi disponibili, seleziona quelli da includere, premi "Ottimizza
     percorso", eventualmente affina l'ordine (frecce su/giù, rimuovi tappa)
     e premi "Conferma e salva percorso". Oltre alla tabella, il link "🗺️
     Mostra mappa" apre una mappa (Leaflet/OpenStreetMap) con tutti gli
     interventi geocodificati: **arancio** = da pianificare, **verde** =
     selezionato, **grigio** = competenza non compatibile con la squadra.
     Cliccando un punto si apre una scheda con i dati essenziali e un
     bottone "Inserisci in planner" (o "Rimuovi dalla selezione" se già
     scelto): aggiunge/toglie l'intervento dalla selezione esattamente come
     la checkbox corrispondente nella tabella, restando sempre sincronizzata
     con essa — serve comunque "Ottimizza percorso" e "Conferma e salva
     percorso" per scrivere davvero sul foglio.
   - **Pianificazione automatica su intervallo**: seleziona una o più
     squadre e un intervallo Dal/Al, poi premi "Pianifica intervallo": il
     sistema genera e **scrive subito** (senza passaggio di conferma) un
     percorso ottimizzato per ciascuna squadra in ciascun giorno
     dell'intervallo, usando via via gli interventi "Da pianificare" ancora
     disponibili e compatibili (qui la competenza richiesta è un filtro
     rigido, non solo un avviso), **saltando i giorni non lavorativi**
     impostati in Regole e i giorni in cui una squadra è specificamente non
     disponibile (giorno di riposo o ferie). Con più squadre selezionate,
     l'assegnazione di ciascun giorno **non segue l'ordine di selezione**:
     per ogni intervento ancora da assegnare si confronta il costo tra
     **tutte** le squadre disponibili quel giorno, e vince chi costa meno in
     assoluto (vicinanza, priorità, ricavo verso il target, competenza
     specifica) — non "a turno" nell'ordine in cui sono state selezionate.
     Così una squadra già vicina a un gruppo di interventi tende a vincerli
     tutti in sequenza (**concentrando il lavoro su poche squadre** invece di
     spalmarlo su tutte), mentre un intervento genuinamente più vicino a
     un'altra squadra va a lei anche se è più in fondo alla lista: nessuna
     squadra monopolizza lavoro sparso su tutta l'area solo perché elencata
     per prima, e nessuna resta priva di lavoro per settimane se c'è
     qualcosa di più adatto a lei. Se il lavoro disponibile non basta per
     tutte, le squadre senza nulla di adatto restano semplicemente libere.
     Gli interventi che non trovano posto in nessun giorno/squadra
     dell'intervallo restano "Da pianificare" con una nota sul motivo. Una
     squadra senza interventi compatibili (o non disponibile) per un
     determinato giorno compare comunque nel riepilogo, marcata come
     "**Giornata libera**" con il motivo: non è necessario che tutte le
     squadre risultino impegnate ogni giorno.

     Se una squadra ha **competenze specifiche** impostate (non generica),
     riceve prima gli interventi che richiedono esplicitamente una di quelle
     competenze, usando gli interventi generici (competenza vuota, adatti a
     qualsiasi squadra) solo come riempitivo quando non c'è (più) lavoro
     specifico disponibile per lei.

   In fondo alla pagina trovi il riepilogo dei percorsi già confermati per il
   giorno selezionato, con tutte le squadre affiancate.

   **Produzione (ricavo) e target giornaliero**: se una squadra ha un
   "Target Produzione Giornaliera" impostato, il ricavo degli interventi
   pesa (regola **pesoRicavo**) tra i fattori usati per scegliere quali
   interventi assegnarle — insieme a priorità, densità dell'area e
   vicinanza alla base. Questo peso **si rafforza automaticamente (fino a
   5 volte) quando la produzione della giornata è ancora lontana dal
   target**, per spingere con più decisione verso gli interventi più
   redditizi e avvicinarsi davvero all'obiettivo, e si attenua man mano che
   ci si avvicina o lo si supera, tornando al peso base impostato in Regole.
   Il target **non blocca né interrompe mai** il riempimento delle ore
   disponibili: anche superato l'obiettivo la squadra continua a ricevere
   altri interventi se c'è ancora tempo e lavoro compatibile, esattamente
   come quando non c'è nessun target impostato — è pensato come un
   indicatore su cui orientare le scelte, non come un tetto. Dove il target
   è impostato, compare un riepilogo "**Produzione: X€ / target Y€**"
   (evidenziato in verde quando raggiunto o superato) nella board della
   pianificazione automatica su intervallo, nell'anteprima del percorso a
   singolo giorno e nella tab Programmazione.
4. Tab **Programmazione**: elenco di tutti gli interventi già pianificati
   (percorsi confermati) in un intervallo di date, raggruppati per
   giorno/squadra, con le indicazioni essenziali (ora, cliente, indirizzo) più
   il **numero di telefono** — utile per contattare il cliente direttamente
   da questa vista. Da qui puoi:
   - **"Rimuovi"** su una singola riga: l'intervento torna "Da pianificare"
     (deselezione di una tappa già programmata);
   - **"Riempi buco"** per una squadra/giorno: ripianifica subito quella
     combinazione usando le tappe rimaste più il pool di interventi ancora
     "Da pianificare" compatibili (stessa competenza, stesso rispetto di
     finestre orarie/pausa pranzo/orario di lavoro), per non lasciare ore di
     turno inutilizzate. Premendo "Rimuovi" questo riempimento **parte in
     automatico** subito dopo la deselezione, così il buco lasciato aperto in
     un giorno già programmato viene ricoperto, se possibile, senza un passo
     manuale in più.
   - **"🗺️ Vedi mappa"** per una squadra/giorno: apre una mappa (OpenStreetMap
     via Leaflet, nessuna chiave API da configurare) con le tappe numerate
     nell'ordine di visita e collegate da segmenti diritti — non un percorso
     stradale reale, solo un'indicazione visiva rapida della sequenza e della
     geografia del giro. Clicca su una tappa per vederne cliente/indirizzo/ora.
   - **"Seleziona manualmente"** per una squadra/giorno: passa al tab
     Pianificazione già precompilato con quella squadra e quel giorno (stesso
     flusso descritto sopra, mappa inclusa), per scegliere a mano quali
     interventi aggiungere invece di affidarsi al riempimento automatico.
5. Tab **Regole**: ogni regola ha il controllo adatto al suo tipo — un
   selettore con i giorni della settimana per "Giorni Lavorativi" (rispettato
   dalla pianificazione automatica su intervallo, che salta i giorni non
   spuntati), campi numerici per tutti gli altri parametri (pesi delle
   priorità, peso e raggio della densità di un'area, preferenza per la
   vicinanza alla base, buffer di setup/parcheggio tra due tappe, velocità
   media di fallback, **minuti di tolleranza sullo sconfinamento nella pausa
   pranzo**, **peso base del ricavo** nella scelta degli interventi da
   assegnare, **priorità della competenza specifica** rispetto agli
   interventi generici) — nessun testo libero da digitare a mano, e nessuna
   modifica al codice richiesta.

Ogni percorso confermato (in entrambe le modalità) viene registrato nel
foglio `LogPianificazione` (visibile in fondo al tab Regole), utile per
tracciare chi ha pianificato cosa e quando.

### Inserire righe direttamente sul Google Sheet

Puoi anche aggiungere Squadre o Interventi scrivendo direttamente le righe sul
foglio invece di usare i form della Web App. In quel caso:

- la casella "Attiva" delle Squadre, se lasciata vuota, viene comunque
  considerata attiva per non far sparire la squadra dai selettori;
- l'**ID viene assegnato/corretto automaticamente alla prima pianificazione**
  che coinvolge la riga (selezione manuale, ottimizzazione, pianificazione su
  intervallo), non serve aprirla dalla Web App apposta: senza un ID univoco
  più righe verrebbero confuse tra loro dal motore, quindi chi ha l'ID vuoto
  ne riceve uno nuovo e chi duplica l'ID di un'altra riga (es. una riga
  copiata da un'altra, che copia anche la cella ID) viene rigenerato — sempre
  salvato subito sul foglio, non appena la riga entra per la prima volta in
  un calcolo;
- la **geocodifica degli indirizzi (lat/lng) può avvenire in automatico
  anche per le righe scritte a mano**, attivando una volta il trigger
  dedicato: dal menu **Delivery Planner → "Attiva geocodifica automatica su
  modifica foglio"**. Alla prima esecuzione Google chiederà di autorizzare
  lo script (come per `inizializzaApp`): è normale, accetta. Da quel momento,
  ogni volta che scrivi o incolli un indirizzo nelle colonne "Indirizzo",
  "Indirizzo di Partenza" o "Indirizzo di Rientro" (anche incollando più
  righe insieme, es. un import in blocco), le colonne Lat/Lng corrispondenti
  vengono calcolate e scritte automaticamente da `Triggers.gs`, senza dover
  passare dalla Web App.
- se non attivi il trigger, resta comunque valida la procedura manuale:
  apri la riga dal tab **Squadre**/**Interventi** → "Modifica" → "Salva"
  (anche senza cambiare nulla) per farla geocodificare. Finché un
  intervento/squadra non è geocodificato/a (né in automatico né a mano), la
  pianificazione darà errore "indirizzo non geocodificato".

## Nota sul servizio Google Maps e sulle prestazioni

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

Per decidere **quale ordine di visita** e **quali interventi entrano** in un
percorso, il motore usa sempre una stima istantanea in linea d'aria (nessuna
chiamata esterna): confrontare decine di interventi con tempi di viaggio
reali per ogni possibile coppia richiederebbe centinaia o migliaia di
chiamate a Google Maps, con tempi di attesa di minuti. I tempi **reali**
vengono richiesti solo alla fine, sui pochi tratti che compongono il
percorso effettivamente scelto (uno per ogni coppia di tappe consecutive) —
così l'ordine tiene comunque conto della distanza reale su strada dove
serve, ma il calcolo resta rapido anche pianificando più squadre su più
giorni con decine di interventi in un'unica operazione. Se, nonostante
questo, l'elaborazione di un intervallo molto grande si avvicina al limite
di esecuzione di Apps Script (6 minuti per gli account consumer), il motore
si interrompe in modo pulito restituendo quanto già pianificato fino a quel
punto, invece di restare bloccato senza risposta: gli interventi non ancora
considerati restano "Da pianificare" con una nota che invita a ripetere la
pianificazione (eventualmente su un intervallo più corto o con meno squadre
alla volta) per completare il resto.

## Personalizzazioni comuni

- **Nuovi campi su Squadre/Interventi**: aggiungi una voce all'array `fields`
  corrispondente in `Config.gs` — form e tabella si aggiornano da soli perché
  generati dinamicamente dallo schema.
- **Bilanciamento del carico tra squadre o altre regole aggiuntive**: il
  punto di innesto è `ordinaNearestNeighbor_` (ordine di visita) e
  `pianificaOrarioPercorso_` (assegnazione orari) in `RouteEngine.gs`.
