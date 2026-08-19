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
- **Web App (HtmlService)**: un'unica pagina con tab per Dashboard, Interventi,
  Squadre e Regole, che comunica col backend tramite `google.script.run`. La
  Dashboard è la schermata di atterraggio: mappa + elenco squadre + dettaglio
  percorso su un giorno o un intervallo di date, unendo quello che prima erano
  due tab separati (Pianificazione e Programmazione).
- **Geocodifica automatica** (`Geocoding.gs`): quando salvi una squadra o un
  intervento, il rispettivo indirizzo viene convertito in coordinate tramite
  il servizio Maps integrato di Apps Script (nessuna chiave API da
  configurare).
- **Motore di ottimizzazione percorso** (`RouteEngine.gs`): il flusso è
  manuale-assistito, non un'assegnazione automatica cieca:
  1. Scegli **squadra** e **giorno**.
  2. Seleziona dall'elenco gli interventi "Da pianificare" da includere in
     quel giro. Il **Tipo Attività è un vincolo rigido anche qui**: un
     intervento il cui Tipo Attività (SM01-SM05) non è tra le Competenze della
     squadra scelta ha la casella disabilitata (non selezionabile), con
     l'icona ⚠ a indicarne il motivo — resta comunque deselezionabile se era
     già pianificato per quella squadra prima di un cambio di competenze. Un
     intervento senza Tipo Attività, "Intervento a vuoto" o "Altro" resta
     invece sempre selezionabile per qualsiasi squadra.
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
       esplicito);
     - **il tempo massimo di viaggio tra le tappe** (regola
       `tempoViaggioMassimoMinuti`, 0 = nessun limite): qui, a differenza
       della pianificazione automatica, se una tappa lo supera non viene
       semplicemente esclusa in silenzio — compare un **avviso** con la
       scelta di pianificarla comunque (ignorando il limite solo per questo
       percorso) oppure annullare, rispettando il limite come al solito. La
       scelta fatta in anteprima resta valida anche premendo "Conferma e
       salva percorso" subito dopo, senza dover rispondere due volte.
  4. Puoi affinare manualmente il percorso proposto (sposta su/giù una tappa,
     rimuovine una) prima di confermarlo: ogni modifica ricalcola subito gli
     orari (e, se necessario, ripropone l'avviso sul tempo massimo di
     viaggio).
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
| `Auth.gs` | Ruolo Admin/Cliente dell'account che esegue la Web App e guardia usata dalle funzioni riservate all'Admin |
| `SheetService.gs` | Lettura/scrittura generica dei fogli basata sullo schema |
| `Geocoding.gs` | Conversione indirizzo → coordinate (con cache) |
| `Triggers.gs` | Trigger installabili: geocodifica automatica su modifica foglio, aggiornamento giornaliero facoltativo delle Priorità automatiche |
| `Setup.gs` | Inizializzazione struttura fogli, menu, dati di esempio |
| `Teams.gs` / `Interventions.gs` / `Rules.gs` / `Listino.gs` | CRUD (con geocodifica automatica su Squadre/Interventi, calcolo automatico di Scadenza/Priorità su Interventi) |
| `Import.gs` | Import di Interventi da un file Excel (.xlsx) del tracking Sicuritalia caricato dal browser |
| `ImportVeneto.gs` | Import di Interventi letto direttamente dal server dalla tab "Veneto" di un foglio Google esterno condiviso |
| `RouteEngine.gs` | Motore di ottimizzazione percorso (inserimento più economico + 2-opt, scheduling con pausa pranzo, dati per la Dashboard e riempimento buchi) |
| `Calendario.gs` | Calendario giorni lavorativi FISSO (Lun-Ven, festività italiane escluse): usato dal tab Analysis e per calcolare automaticamente la Scadenza degli Interventi (SM01-SM05), indipendente dalla regola "giorniLavorativi" della pianificazione |
| `Analysis.gs` | Metriche del tab Analysis (solo Admin): ricavo, tempi di lavorazione, tassi, backlog, km, distribuzione geografica |
| `TeamView.gs` | Programmazione propria per l'account Squadra (elenco/agenda/mappa) |
| `Documenti.gs` | Documenti allegati a ciascun Intervento, archiviati su Google Drive |
| `Notifiche.gs` | Centro notifiche per la campanella Admin/Cliente (nuova nota, cambio stato, riassegnazione squadra...) |
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
   - *Esegui come*: **Me ([tua email])** — **non** "Utente che accede
     all'applicazione". Tutto il sistema di ruoli (Admin/Cliente/Squadra,
     vedi più sotto) presuppone che sia un'unica identità, la tua, a
     leggere/scrivere davvero il foglio e la cartella Drive per conto di
     chiunque acceda: con "Utente che accede all'applicazione" invece è
     ciascun visitatore a dover avere accesso diretto al foglio, cosa che
     normalmente non è così — il sintomo tipico è un **errore 403** per
     chiunque non sia tu, anche con "Chi ha accesso" impostato
     correttamente. L'email di chi accede viene comunque letta
     correttamente (per assegnare il ruolo giusto) anche con "Esegui come:
     Me", perché la distribuzione è ristretta al tuo stesso dominio.
   - *Chi ha accesso*: scegli in base a chi deve usarla — "Chiunque abbia un
     Account Google" per il caso generale, oppure "Chiunque nell'organizzazione
     [tuo dominio]" se usi Google Workspace e vuoi limitarla al personale
     interno.
   - Copia l'URL della Web App generato: è il link da condividere con le
     squadre/operatori (equivalente al login di deliveryplanner.it, ma qui
     l'autenticazione è già quella del loro account Google).
   - Se hai già distribuito con l'impostazione sbagliata: **Distribuisci →
     Gestisci distribuzioni**, icona a matita sulla distribuzione attiva,
     cambia "Esegui come" in "Me" e premi **Distribuisci** — aggiorna la
     stessa distribuzione, stesso URL, non serve crearne una nuova né
     avvisare chi la usa già.
7. Riapri il Google Sheet: nel menu **Delivery Planner** (creato in automatico)
   trovi anche una voce "Apri Web App" che mostra l'URL corrente in qualsiasi
   momento.

## Uso quotidiano

1. Tab **Squadre**: censisci le squadre con competenze, indirizzo di partenza
   a inizio turno, indirizzo di rientro a fine turno (lascia vuoto se
   coincide con la partenza), orario di lavoro e, se presente, la fascia
   della pausa pranzo. Indirizzo di partenza e rientro vengono geocodificati
   automaticamente al salvataggio. Le **Competenze sono una selezione di Tipi
   Attività (SM01-SM05)** e costituiscono un **vincolo rigido** (non solo un
   promemoria): una squadra senza un dato Tipo Attività tra le sue Competenze
   non potrà mai essere assegnata a un intervento di quel tipo, né nella
   selezione manuale né nella pianificazione automatica (nessuna selezione =
   la squadra copre qualsiasi Tipo Attività). Un intervento senza Tipo
   Attività scelto, "Intervento a vuoto" o "Altro" resta invece sempre
   assegnabile a qualsiasi squadra, indipendentemente dalle sue Competenze —
   solo SM01-SM05 sono considerati specializzazioni vere e proprie. Sulla
   stessa scheda puoi indicare
   l'**indisponibilità della squadra**: un selettore dei **giorni della
   settimana** in cui quella squadra in particolare non lavora (es. un
   part-time con giorno di riposo infrasettimanale, oltre ai giorni
   lavorativi generali impostati in Regole) e uno o più **periodi di
   ferie/assenza** (Dal/Al, aggiungibili con "+ Aggiungi periodo"): nei
   giorni coperti da questi la squadra non viene mai considerata dalla
   pianificazione (né manuale né automatica). Puoi anche impostare un
   **Target Produzione Giornaliera (€)**: un obiettivo di ricavo che la
   squadra dovrebbe idealmente raggiungere in un giorno (vedi più sotto).
   Il campo **Email Account Squadra** dà accesso al tab dedicato "Account
   Squadra" più sotto: vedi quella sezione per i dettagli.
2. Tab **Interventi**: l'elenco mostra, per ciascun intervento, **Cliente**,
   **Tipo Attività**, **Op.** (Operazione, dal tracking esterno),
   **Priorità**, **ODS** (Codice Esterno), **Ricavo**, **Stato**,
   **Squadra** e **Data/ora** — con
   **Priorità**, **Squadra** e **Data/ora** cliccabili direttamente in
   elenco (anche quando mostrano "—" o un valore già impostato): un click
   apre un piccolo editor inline (un selettore per Priorità/Squadra, due
   campi data+ora con conferma/annulla per Data/ora) che salva subito, senza
   aprire la scheda completa — utile per assegnazioni rapide. Cambiare la
   Priorità così viene trattato come un override manuale del calcolo
   automatico (vedi più sotto): da quel momento non viene più ricalcolata da
   sola. **Se dall'inline edit un intervento risulta con Squadra E Data/ora
   entrambe valorizzate mentre era ancora "Da pianificare", passa
   automaticamente a "Pianificato"** (stesso comportamento se le assegni
   dalla scheda "Modifica"). Attenzione: sia l'inline edit sia la scheda
   "Modifica" **spostano solo l'assegnazione/l'orario**, senza ricalcolare
   l'ordine/orario del percorso: verifica poi la programmazione della
   squadra coinvolta. Il pulsante **"⋮"** in fondo alla riga apre un
   sottomenu con le altre azioni disponibili (Modifica, Componi Ricavo,
   Nota, Documenti, Completa, Sospendi/Annulla/Fine sospensione, Elimina —
   quali compaiono dipende da ruolo e stato, come prima).

   La scheda "Nuovo intervento"/"Modifica" raccoglie cliente, indirizzo —
   geocodificato automaticamente —, Tipo Attività, durata stimata,
   finestra oraria, **telefono** del cliente per contattarlo sul campo,
   eventuale non-prima-del, **Codice Esterno (Ods)** (normalmente compilato
   dall'import, ma modificabile anche a mano da qui), **Op.** (campo libero,
   es. sigla dell'operatore/Operazione), **Data Dispacciamento** (per gli
   importati è la "Data in. al + presto" del tracking esterno; per quelli
   creati a mano viene impostata di default a oggi, modificabile), **Tipo
   Attività** (codice SM01-SM05, "Intervento a vuoto" o "Altro" — dedotto
   dalla colonna "Tipo di ordine" del tracking esterno per gli importati, da
   scegliere per quelli manuali — un pulsante **"ℹ Legenda"** accanto al
   campo mostra il significato di ciascun codice) e **Comune** (dedotto dal
   tracking esterno per gli importati). Comune non serve alla pianificazione:
   alimenta solo le metriche del tab **Analysis** (vedi più sotto).

   **Scadenza e Priorità si impostano da sole per i Tipi Attività SM01-SM05**,
   in base a "Data Dispacciamento":

   | Tipo Attività | Scadenza automatica | Modificabile a mano? |
   |---|---|---|
   | SM01, SM04, SM05 | Dispacciamento + 7 giorni lavorativi | No: si ricalcola da sola se cambia la Data Dispacciamento |
   | SM02 | Dispacciamento + 3 giorni lavorativi | No |
   | SM03 | Dispacciamento + 90 giorni lavorativi (default) | Sì: una volta impostata (di default o a mano), resta quella — un successivo import non la sovrascrive più |
   | Altro, Intervento a vuoto, nessun tipo scelto | — | Sì, interamente manuale/facoltativa come prima |

   "Giorni lavorativi" segue lo stesso calendario fisso (Lun-Ven, festività
   nazionali italiane escluse) del tab Analysis. La **Priorità** segue di
   conseguenza, in base ai giorni lavorativi rimanenti alla Scadenza: **scaduta
   o a 0-1 giorno → Urgente**, **a 2-3 giorni → Alta**, **a 4-7 giorni →
   Normale**, **oltre 7 giorni → Bassa** — si aggiorna da sola (ad ogni
   apertura della Web App, e con il trigger giornaliero facoltativo attivabile
   dal menu del foglio "Attiva aggiornamento giornaliero priorità
   automatiche") man mano che la scadenza si avvicina, ma **resta sempre
   forzabile a mano da un Admin**: una volta cambiata manualmente, quella
   scelta non viene più sovrascritta in automatico. Vale solo per SM01-SM05
   con una Scadenza; per "Altro"/"Intervento a vuoto"/nessun tipo la Priorità
   resta interamente manuale come prima.

   Dalla scheda **"Modifica"** puoi anche cambiare la **Squadra Assegnata** di
   un intervento già pianificato (o assegnarne una a uno "Da pianificare"):
   utile per correggere a mano un'assegnazione senza dover rimuovere e
   ripianificare da capo. Attenzione: cambiarla qui **sposta solo
   l'assegnazione**, senza ricalcolare l'ordine/orario del percorso né della
   vecchia né della nuova squadra — verifica poi la programmazione di
   entrambe (usa eventualmente "Riempi buchi" se serve richiudere il varco
   lasciato aperto). Il pulsante **"⏸ Sospendi"** su una riga apre un dialog che
   chiede una **nota di motivazione** (obbligatoria) e uno dei tre **stati di
   sospensione** ("Sospeso - ys", "Sospeso - zp", "Sospeso - zc"): la data
   odierna viene registrata automaticamente insieme alla nota nello **storico
   sospensioni** dell'intervento (icona a orologio accanto allo stato: **solo
   se ci sono note inserite** — la "Nota Pianificazione" generata
   automaticamente dal motore, vedi più sotto, non compare più qui — click
   sull'icona apre un **popup** con l'elenco completo di tutte le voci
   data/autore/stato/nota, incluse quelle inserite da un account Cliente).
   Un intervento sospeso **non entra mai nella programmazione**
   (né automatica né tramite selezione manuale — i filtri della
   pianificazione candidano solo "Da pianificare") e, se era già pianificato
   su un percorso, ne viene tolto (come "Rimuovi"). Il pulsante diventa **"▶
   Fine sospensione"** quando l'intervento è già sospeso: lo riporta
   direttamente a "Da pianificare" (lo storico resta, non viene cancellato).

   **Sospensione automatica da "Non Prima Del"**: impostare (o cambiare) il
   campo **"Non Prima Del"** sulla scheda di un intervento lo sospende in
   automatico in stato **"Sospeso - zc"**, con una nota generata da sola
   ("Cliente chiede dopo &lt;data&gt;") — esattamente come il "⏸ Sospendi"
   manuale, incluso il liberare l'eventuale squadra/data/ora già assegnate se
   l'intervento era già pianificato. La sospensione **termina da sola**,
   tornando "Da pianificare", non appena questa data viene raggiunta (senza
   bisogno di aprire la Web App: succede anche dal trigger giornaliero
   opzionale, vedi più sotto) — oppure **subito**, se il campo viene
   svuotato a mano prima di quella data. Non scatta su un intervento già
   Completato o Annullato. Una sospensione "Sospeso - zc" scelta a mano dal
   dialog "⏸ Sospendi" (senza passare da "Non Prima Del") non viene invece
   mai riattivata in automatico: resta sospesa finché non si preme "▶ Fine
   sospensione".
   Il pulsante **"📝"** apre un popup per aggiungere una semplice **nota**
   (solo data automatica, non cambia stato); il pulsante **"⊘ Annulla"**
   chiede una nota di motivazione e porta l'intervento a "Annullato" in modo
   definitivo (non viene più riproposto dalla pianificazione, a differenza
   della sospensione). Il pulsante **"📎 Documenti"** apre un popup con
   l'elenco dei file allegati a quell'intervento (archiviati su Google Drive,
   vedi "Documenti allegati" più sotto) e, per Admin e Cliente, un selettore
   file per caricarne di nuovi. Vedi anche "Account Cliente" più sotto: lo
   stesso tab, con questi quattro pulsanti (Nota/Documenti/Sospendi/Annulla)
   ma senza Modifica/Completa/Elimina, è quello che vede un account Cliente.

   Sotto ogni campo indirizzo (Squadre e Interventi) c'è un link **"🗺️
   Mostra mappa"**: apre un'anteprima piccola e ridimensionabile (trascina
   l'angolo in basso a destra per ingrandirla) che mostra la posizione
   geocodificata già salvata, oppure — se manca — un avviso più un'anteprima
   di ricerca basata sul testo digitato, utile per individuare un indirizzo
   scritto male prima ancora di salvare. Nota: la prima volta che apri una
   mappa, Google può mostrare un banner di consenso cookie dentro il
   riquadro stesso — è normale, basta accettarlo una volta.
3. Tab **Dashboard** (schermata di atterraggio): in alto un selettore
   **Dal/Al** — un solo giorno (Dal = Al, il default all'apertura) oppure un
   intervallo di più giorni. A sinistra l'elenco delle squadre attive, con
   stato ("Pianificato"/"Libera"), produzione rispetto al target (se
   impostato), km indicativi e numero di interventi nel periodo scelto; a
   destra una mappa (Leaflet/OpenStreetMap) con tre modalità, scelte con i
   bottoncini sopra la mappa: **"🧭 Percorsi"** (default) disegna il
   percorso di ogni squadra per ciascun giorno dell'intervallo, con quella
   selezionata in evidenza e le altre attenuate; **"📍 Per stato"** e
   **"🏷️ Per tipologia"** mostrano invece, indipendentemente dal Dal/Al
   scelto, ogni intervento geocodificato colorato rispettivamente per
   **Stato** (Da pianificare/Pianificato/Completato, legenda sotto la
   mappa) o per **Tipo Attività** (SM01-SM05, Altro, "(non specificato)" per
   chi non lo ha valorizzato — legenda sotto la mappa, con il significato di
   ciascun codice) — utile per una visione d'insieme del territorio, non solo di ciò
   che è già pianificato. **Un intervento Sospeso o Annullato non compare
   mai in nessuna delle due viste** (non è più lavoro attivo da mostrare sul
   territorio); **"Per tipologia" nasconde anche i Completati** (mostra solo
   il lavoro ancora da fare o in corso, non lo storico — per quello c'è
   "Per stato") — resta comunque tutto visibile e gestibile dal tab
   Interventi. Cliccando una squadra
   nell'elenco la selezioni e il pannello sotto la mappa mostra il dettaglio: con un solo
   giorno selezionato, la lista piatta delle tappe (ora, cliente, indirizzo,
   durata, telefono); con un intervallo di più giorni, le stesse tappe
   **raggruppate per giornata**, ciascuna con il proprio riepilogo e le
   proprie azioni (un giorno è comunque un percorso indipendente dagli
   altri). Accanto a ogni tappa, l'icona **"✓"** la segna direttamente come
   **completata** (stessa azione, senza dover passare dal tab Interventi),
   l'icona a foglio **"📝"** apre un piccolo dialog per aggiungere una
   **nota** (data odierna registrata automaticamente, come per la
   sospensione): non cambia stato né programmazione, serve solo per
   annotazioni libere sull'intervento già pianificato. Le note si accumulano
   nello stesso storico visibile nel tab Interventi (icona a orologio, click
   per aprire il popup con l'elenco di tutte le voci) e compaiono anche qui,
   sulla tappa stessa (al passaggio del mouse), quando presenti. Da qui:
   - Se la squadra è **completamente libera** nel giorno (o nell'intero
     periodo) selezionato, il pannello mostra solo un messaggio e i due
     bottoni **"📋 Seleziona da elenco"** e **"+ Aggiungi intervento"**
     descritti sotto (niente "🧩 Riempi buchi", che ha senso solo quando
     esiste già almeno una tappa ferma da cui partire). Se il motivo
     dell'assenza di interventi è che la squadra è in **ferie/assente** o è
     il suo **giorno di riposo settimanale** (vedi indisponibilità squadra
     più sopra), il messaggio lo dice esplicitamente ("🏖️ La squadra è in
     ferie/assente..." o "📅 È il giorno di riposo settimanale...") invece
     del generico "Nessun intervento pianificato" — su un intervallo di più
     giorni, solo se **tutti** i giorni selezionati sono coperti da
     ferie/riposo (altrimenti potrebbe semplicemente non avere ancora nulla
     assegnato in un giorno in cui è disponibile, e il messaggio resta
     quello generico per non essere fuorviante).
   - **"🧩 Riempi buchi"** per una squadra/giorno: le tappe **già
     pianificate restano ferme** (stesso ordine relativo tra loro, mai
     scartate né ripianificate da zero) e vengono solo **aggiunti**
     interventi ancora "Da pianificare" compatibili (stesso vincolo di Tipo
     Attività/Competenze, stesso rispetto di finestre orarie/pausa
     pranzo/orario di lavoro) nei
     buchi residui del turno, per non lasciare ore inutilizzate. Vengono
     valutate **tutte** le posizioni di inserimento disponibili per ciascun
     candidato (non solo la più economica in termini di viaggio) e **tutti**
     i candidati compatibili (non solo i primi per vicinanza), per non
     scartare ingiustamente un intervento che in realtà entrerebbe benissimo
     nella giornata. Un nuovo intervento può essere inserito anche "in
     mezzo" a due tappe già ferme se conviene dal punto di vista del
     percorso — questo può ricalcolare (quasi sempre anticipare) l'orario di
     una o più tappe già pianificate, se il margine tra loro lo permette.
     **Se il calcolo prevede uno spostamento di questo tipo, prima di
     scrivere qualunque cosa compare un avviso** con l'elenco di chi
     cambierebbe orario e da quando a quando, per scegliere se accettarlo
     (l'orario cambia, come sopra) o mantenere fissi gli orari già salvati
     (in questo caso i nuovi interventi vengono inseriti solo nei varchi
     liberi che non richiedono di toccare nessun orario già fissato: prima
     della prima tappa, tra due tappe consecutive o dopo l'ultima, usando
     esattamente gli orari salvati come riferimento — può risultare in
     qualche intervento in meno aggiunto rispetto a permettere lo
     spostamento). Un intervento già confermato non viene comunque **mai**
     rimosso o spostato su un'altra squadra/giorno da questa funzione. A
     differenza della selezione manuale, qui **"Non Prima Del" è un vincolo
     rigido**: un intervento non ancora disponibile per il giorno che si sta
     riempiendo non viene proposto, ma resta comunque "Da pianificare" con
     una nota esplicita del perché ("Nota Pianificazione") invece di sparire
     silenziosamente dal riempimento. **"Scadenza" invece non esclude mai**:
     un intervento con scadenza già superata resta pianificabile
     normalmente, ma viene trattato ovunque come priorità "Urgente"
     (indipendentemente dalla priorità realmente impostata sulla riga, che
     non viene modificata) finché la scadenza non viene corretta o rimossa —
     vale per "Riempi buchi", per la pianificazione automatica su intervallo
     e per la selezione manuale.
   - **"📋 Seleziona da elenco"** per una squadra/giorno: apre un dialog con
     gli interventi "Da pianificare" disponibili — stessa tabella (con
     checkbox), stessa mappa opzionale ("🗺️ Mostra mappa") e stesso flusso di
     prima: seleziona quelli da includere, premi "Ottimizza percorso",
     eventualmente affina l'ordine (frecce su/giù, rimuovi tappa) e premi
     "Conferma e salva percorso". La mappa include anche gli interventi già
     pianificati per un'altra squadra o un altro giorno (per poterli
     spostare a mano): **arancio** = da pianificare, **verde** =
     selezionato, **blu scuro** = già pianificato altrove, **grigio** =
     Tipo Attività non compatibile con le Competenze della squadra. Cliccando un punto si apre
     una scheda con i dati essenziali (e, se già pianificato altrove,
     l'indicazione di dove) e un bottone "Inserisci in planner"/"Sposta
     qui" (o "Rimuovi dalla selezione"/"Annulla spostamento" se già
     scelto), sincronizzato con la tabella. Selezionare un intervento già
     pianificato altrove e confermare **lo sposta**, sovrascrivendone
     squadra/giorno/orario precedenti. Nota: lo spostamento non ricalcola
     automaticamente il percorso lasciato "scoperto" nella squadra/giorno di
     provenienza; se serve, usa "Riempi buchi" su quella combinazione dopo
     lo spostamento.
   - **"+ Aggiungi intervento"** per una squadra/giorno: crea al volo un
     nuovo intervento (cliente, indirizzo, Tipo Attività, priorità, durata,
     telefono, ricavo) e lo inserisce subito nel percorso **a un orario
     scelto a mano**, senza passare dall'ottimizzatore — pensato per un
     intervento imprevisto durante un giro già in corso. L'intervento entra
     nella posizione corretta dell'elenco in base all'orario indicato (non
     necessariamente in coda).
   - **Modifica orario** (cliccando l'orario stesso, con l'icona ✏️ accanto)
     su una tappa già pianificata: puoi cambiare **solo l'orario di
     inizio** — la durata resta quella già impostata sull'intervento, e
     l'orario di fine si ricalcola da solo. Nessun controllo su orario di
     lavoro/pausa pranzo/finestra oraria del cliente (override esplicito,
     come "+ Aggiungi intervento"): l'unico controllo è la sovrapposizione
     con le altre tappe della stessa squadra/giorno. Se il nuovo orario si
     sovrappone ad altre tappe **successive** (nell'ordine cronologico
     precedente alla modifica), viene chiesto se **risolvere** lo
     spostandole in avanti a cascata (ciascuna non prima del proprio
     orario originale, né prima della fine di quella che la precede) o
     **lasciare la sovrapposizione** com'è; una sovrapposizione con una
     tappa **precedente** non viene invece mai risolta automaticamente
     (va corretta a mano se necessario), perché questa funzione sposta
     solo le tappe successive, mai quelle già passate nell'ordine del
     giorno.
   - **Rimuovi** (icona cestino) su una singola tappa: l'intervento torna
     semplicemente "Da pianificare" — **non** viene ripianificato né il buco
     lasciato aperto viene ricoperto in automatico: è una scelta esplicita
     successiva ("Riempi buchi" quando vuoi). In più, l'intervento rimosso
     **non viene più riproposto dagli strumenti automatici** ("Riempi
     buchi", pianificazione su intervallo) per quella **stessa data** da cui
     è stato tolto — così non ricompare subito al primo riempimento
     automatico successivo — ma resta **sempre selezionabile a mano**, anche
     per quella stessa data ("Seleziona da elenco"), e resta pianificabile
     automaticamente per qualsiasi altra data. Il vincolo si azzera da solo
     non appena l'intervento viene ripianificato di nuovo (a mano o in
     automatico, anche per un'altra data).

   Il bottone **"Pianifica automaticamente un intervallo"** in alto apre un
   dialog separato: seleziona una o più squadre e un intervallo Dal/Al, poi
   premi "Pianifica intervallo": il sistema genera e **scrive subito**
   (senza passaggio di conferma) un percorso ottimizzato per ciascuna
   squadra in ciascun giorno dell'intervallo, usando via via gli interventi
   "Da pianificare" ancora disponibili e compatibili (qui il Tipo Attività
   è un filtro rigido, non solo un avviso), **saltando i giorni
   non lavorativi** impostati in Regole e i giorni in cui una squadra è
   specificamente non disponibile (giorno di riposo o ferie). Con più
   squadre selezionate, l'assegnazione di ciascun giorno **non segue
   l'ordine di selezione**: per ogni intervento ancora da assegnare si
   confronta il costo tra **tutte** le squadre disponibili quel giorno, e
   vince chi costa meno in assoluto (vicinanza, priorità, ricavo verso il
   target, competenza specifica per Tipo Attività) — non "a turno" nell'ordine in cui sono
   state selezionate. Così una squadra già vicina a un gruppo di interventi
   tende a vincerli tutti in sequenza (**concentrando il lavoro su poche
   squadre** invece di spalmarlo su tutte), mentre un intervento
   genuinamente più vicino a un'altra squadra va a lei anche se è più in
   fondo alla lista: nessuna squadra monopolizza lavoro sparso su tutta
   l'area solo perché elencata per prima, e nessuna resta priva di lavoro
   per settimane se c'è qualcosa di più adatto a lei. Se il lavoro
   disponibile non basta per tutte, le squadre senza nulla di adatto restano
   semplicemente libere. Gli interventi che non trovano posto in nessun
   giorno/squadra dell'intervallo restano "Da pianificare" con una nota sul
   motivo. Una squadra senza interventi compatibili (o non disponibile) per
   un determinato giorno compare comunque nel riepilogo, marcata come
   "**Giornata libera**" con il motivo: non è necessario che tutte le
   squadre risultino impegnate ogni giorno.

   Se una squadra ha **Competenze specifiche** impostate (uno o più Tipi
   Attività, non generica), riceve prima gli interventi il cui Tipo Attività
   è esplicitamente una di quelle competenze, usando gli interventi generici
   (senza Tipo Attività, "Intervento a vuoto" o "Altro" — adatti a qualsiasi
   squadra) solo come riempitivo quando non c'è (più) lavoro specifico
   disponibile per lei.

   Se una combinazione squadra/giorno ha **già un percorso confermato** in
   partenza (da un run precedente di "Pianifica intervallo", o pianificato a
   mano), quelle tappe **restano ferme**: la funzione si limita ad
   aggiungere nei buchi residui del turno gli interventi vinti nel
   confronto di quel giorno, senza mai ricostruire da zero o scartare
   quanto già confermato. Una squadra/giorno con un percorso già completo e
   nessun nuovo candidato compatibile non compare più come "Giornata
   libera": mostra il percorso esistente, invariato.

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
   (evidenziato in verde quando raggiunto o superato) sia nella card di ogni
   squadra sia nel dettaglio del percorso selezionato, sommato su tutto
   l'intervallo di date scelto.
4. Tab **Regole**: ogni regola ha il controllo adatto al suo tipo — un
   selettore con i giorni della settimana per "Giorni Lavorativi" (rispettato
   dalla pianificazione automatica su intervallo, che salta i giorni non
   spuntati), campi numerici per i parametri "assoluti" (buffer di
   setup/parcheggio tra due tappe, velocità media di fallback, minuti di
   tolleranza sullo sconfinamento nella pausa pranzo, **minuti massimi di
   viaggio tra le tappe**) e un campo **percentuale da 0 a 100** per tutti i
   pesi che regolano le scelte del motore (priorità Urgente/Alta/Normale/
   Bassa, densità di un'area, vicinanza alla base, peso base del ricavo,
   priorità della competenza specifica) — nessun testo libero da digitare a
   mano, e nessuna modifica al codice richiesta.

   **Tempo massimo di viaggio tra le tappe (regola `tempoViaggioMassimoMinuti`,
   default 90 minuti)**: impone un tetto al tempo di viaggio complessivo *tra*
   le tappe di una singola giornata per una squadra (il tragitto dalla
   partenza alla prima tappa e quello dall'ultima tappa al rientro non
   contano, in coerenza con la regola per cui quei due tragitti non sono
   comunque conteggiati come orario di lavoro). Superata questa soglia, un
   intervento altrimenti raggiungibile per tempo di turno viene comunque
   escluso da quella giornata — questo evita che il motore componga percorsi
   che mescolano zone troppo lontane tra loro (es. Cortina d'Ampezzo e
   Vicenza nello stesso giro) solo per riempire ore o inseguire priorità/
   ricavo. Il vincolo è rispettato sia nella pianificazione manuale a singola
   squadra sia in quella automatica multi-squadra su intervallo. Con `0` il
   vincolo è disattivato (nessun limite).

   **Pesi in percentuale (0-100)**: ogni regola "peso" esprime quanto quel
   fattore conta nelle scelte del motore, in percentuale rispetto
   all'intensità raccomandata di default: **100% riproduce il comportamento
   di default**, valori più bassi attenuano il fattore, **0% lo disattiva
   completamente**, valori intermedi lo dosano in proporzione. Ad esempio,
   portare "Peso Ricavo" al 50% dimezza quanto il ricavo di un intervento
   influenza la scelta rispetto a priorità/densità/vicinanza, mentre portare
   "Peso Competenza Specifica" a 0% fa sì che una squadra con competenze
   specifiche non riceva più priorità sul lavoro della propria
   specializzazione rispetto a quello generico.

Ogni percorso confermato (in entrambe le modalità) viene registrato nel
foglio `LogPianificazione` (visibile in fondo al tab Regole), utile per
tracciare chi ha pianificato cosa e quando.

### Campanella notifiche (Admin e Cliente)

In alto a destra, accanto all'account collegato, Admin e Cliente hanno una
**campanella 🔔** (assente per l'account Squadra, che non ha un tab dedicato
per riceverle): un pallino rosso mostra quante notifiche non lette ci sono,
aggiornato automaticamente ogni 25 secondi mentre la pagina resta aperta (non
è un push: bisogna avere la Web App aperta in una scheda per vederle
arrivare). Cliccando la campanella si apre l'elenco delle notifiche più
recenti (**Cliente**, **Ods**, evento, data/ora) e tutte quelle mostrate
vengono segnate come lette. **Cliccando una notifica** si passa
automaticamente al tab Interventi con un **filtro attivo su quel solo
intervento** (mostrato come chip "Filtro: Cliente — Ods" sopra l'elenco):
la lista mostra solo quella riga, indipendentemente dagli altri filtri
stato/squadra/ricerca. Si torna alla lista normale premendo la **✕** sul
chip, oppure semplicemente toccando uno degli altri filtri (stato, squadra o
ricerca), che lo disattiva automaticamente.

Genera una notifica ogni evento rilevante sul ciclo di vita di un intervento:
nuova nota, sospensione/fine sospensione/annullamento (con la nota), il
completamento (da Admin o da una Squadra), la rimozione dalla programmazione
("Rimuovi"), l'assegnazione/riassegnazione della Squadra e ogni nuova
pianificazione (manuale, "Riempi buchi", pianificazione automatica su
intervallo, o la creazione al volo di un intervento imprevisto). Non genera
notifiche per le semplici modifiche ai campi anagrafici (indirizzo, telefono,
ricavo...), per non affollare l'elenco di eventi poco rilevanti. **Chi manda
non riceve mai la notifica della propria stessa azione**: una modifica
dell'Admin notifica il Cliente e viceversa; un'azione di un account Squadra
(che non ha una campanella) notifica sia Admin sia Cliente.

"Letto"/"non letto" è per **ruolo**, non per singolo indirizzo email — come
il resto dell'app, Admin e Cliente sono account condivisi, non utenti
singoli: se più persone usano lo stesso account Cliente, aprire la
campanella da una di esse segna come lette le notifiche per tutte.

### Account Cliente (accesso ristretto)

Oltre all'account Admin (accesso completo a tutti i tab), la Web App supporta
un secondo ruolo, **Cliente**, pensato per essere condiviso con l'account
Google del cliente esterno senza dargli accesso a squadre, regole,
pianificazione o import: vede **solo il tab Interventi** e su ogni intervento
può soltanto **aggiungere una nota**, **sospendere** (con nota di motivazione
e stato "Sospeso - ys/zp/zc", esattamente come l'Admin) o **annullare** (nuovo
pulsante ⊘, chiede una nota di motivazione: a differenza della sospensione è
definitivo, l'intervento non viene più riproposto dalla pianificazione). Non
può creare, modificare o eliminare interventi, né importare dal tracking
esterno, né toccare Squadre/Regole/Dashboard/pianificazione — questi pulsanti
e queste schede restano nascosti, e le funzioni corrispondenti sono comunque
bloccate anche lato server (non è un'occultazione solo grafica: chiamandole
comunque restituiscono un errore "Operazione non consentita per l'account
Cliente").

**Come attivarlo**: nel tab Regole (visibile solo all'Admin) trovi la regola
**"emailClienti"**: scrivi qui l'email (o le email, separate da virgola)
dell'account/i Google da trattare come Cliente — devi comunque prima dare a
quell'account accesso alla Web App dalle impostazioni di distribuzione di
Apps Script (Distribuisci → Gestisci distribuzioni), esattamente come per un
account Admin. Chi non è in questo elenco resta Admin: il comportamento di
tutti gli account esistenti non cambia finché non aggiungi esplicitamente
un'email qui.

Le note aggiunte dal Cliente finiscono nello **stesso storico** già visibile
con l'icona a orologio (rinominato "Storico Note e Sospensioni"): ogni voce
riporta ora anche **chi l'ha scritta** (Admin o Cliente), così l'Admin legge
le note del Cliente e viceversa nello stesso popup (nel tab Interventi, click
sull'icona) sia (per l'Admin) accanto alle tappe della Dashboard.

### Tab Analysis (solo Admin)

Tab dedicato alle metriche sull'andamento degli interventi, con un'unica barra
filtri in alto: intervallo di date **Dal/Al** (con scorciatoie "Questa
settimana"/"Questo mese", o scelto liberamente), **Tecnico** (una squadra
specifica o "Tutti"), e la casella **"Includi interventi ancora aperti (stima
ad oggi)"** (vedi sotto). Premendo "Aggiorna analisi" tutte le card si
ricalcolano in un'unica chiamata al server.

**Importante limite sui dati storici**: i tre "tempi di lavorazione" (vedi
sotto) si basano su tre nuovi campi (`primoEventoData`, `dataPrimoPianificato`,
`dataCompletamento`) impostati automaticamente ad ogni cambio di stato/nota
rilevante — ma solo **da quando questa funzionalità è stata introdotta in
poi**: gli Interventi già esistenti prima non hanno questi dati (non essendo
mai stati registrati) e restano fuori da queste tre metriche finché non
vengono ripresi in mano (una sospensione, una nota, una nuova pianificazione
li fa "entrare" nel tracciamento da quel momento). Il calendario dei giorni
lavorativi usato da queste metriche è **fisso** (Lun-Ven, festività
nazionali italiane escluse) e non è lo stesso della regola configurabile
"giorniLavorativi" usata dalla pianificazione: cambiare quest'ultima non
altera le statistiche già calcolate.

Le card disponibili:
- **Ricavo per tecnico**: totale nel periodo (solo Interventi Completati, per
  data pianificata) con andamento **settimanale/mensile** (toggle) e
  ripartizione per squadra; il filtro "Tecnico" in alto lo restringe a una
  sola squadra.
- **Tempi di lavorazione** (in giorni lavorativi, sospensioni escluse): **Tempo
  di prima lavorazione** (dispacciamento → primo evento, es. una nota o un
  cambio di stato), **Tempo di lavorazione medio** (dispacciamento → primo
  "Pianificato") e **Tempo di completamento** (dispacciamento →
  completamento). Toggle **Cumulativo/Per tipo attività**. Di default
  considera solo gli Interventi già Completati; con "Includi interventi
  ancora aperti" spuntato, include anche quelli non ancora arrivati a quel
  traguardo, stimando il tempo trascorso **ad oggi** (esclusi gli Annullati).
- **Nuovi interventi dispacciati**: conteggio mensile (per data
  dispacciamento), cumulativo o per tipo attività.
- **Tasso completamento/annullamento/sospensione**: percentuali sul totale
  dispacciato nel periodo, cumulativo e per tipo attività.
- **Sospensioni**: durata media di una sospensione e numero medio di
  sospensioni per intervento (tra quelli sospesi almeno una volta).
- **Aging backlog "Da pianificare"**: quanti Interventi non ancora presi in
  carico da più della soglia scelta (default 5 giorni lavorativi), con
  elenco.
- **SLA scadenza**: percentuale di Interventi Completati oltre la loro
  "Scadenza" impostata.
- **Ricavo medio per tipo attività**: valore medio a intervento (non
  totale), utile per capire la redditività relativa delle diverse attività.
- **Km stimati per tecnico**: percorso stimato (linea d'aria, stessa stima
  usata in Dashboard) sommato su tutti i giorni del periodo.
- **Distribuzione per Comune**: numero di interventi dispacciati per Comune
  (richiede che il campo Comune sia valorizzato).

### Account Squadra (accesso ristretto alla propria programmazione)

Terzo ruolo, pensato per i tecnici sul campo: a differenza del Cliente (che
vede tutti gli Interventi) un account Squadra vede **solo la programmazione
della propria squadra**, in un tab dedicato "La mia squadra" — tutti gli
altri tab (Dashboard, Interventi, Squadre, Regole, Analysis) restano
nascosti, e le relative funzioni sono bloccate anche lato server.

**Come attivarlo**: nel tab Squadre (solo Admin), apri la scheda della
squadra e compila **"Email Account Squadra"** con una o più email (separate
da virgola) degli account Google da autorizzare — vedono *solo* quella
squadra. A differenza del Cliente (un elenco email unico e globale in
Regole), qui l'associazione è per singola squadra: la stessa email non può
appartenere contemporaneamente a due squadre diverse. Come sempre, l'account
deve anche avere accesso alla Web App dalle impostazioni di distribuzione di
Apps Script.

Il tab "La mia squadra" si apre su **oggi** (modificabile: Dal/Al liberi, per
tornare indietro nel tempo e rivedere il lavoro già completato) e mostra gli
Interventi già assegnati alla squadra (Pianificato o Completato — non quelli
ancora "Da pianificare", anche se di competenza compatibile) in due viste:
- **🗓️ Agenda**: le tappe raggruppate per giornata, ordinate per ora.
- **🗺️ Mappa**: un pin per intervento (Leaflet/OpenStreetMap); **cliccandolo
  si apre un popup con il pulsante "🧭 Naviga"**, che apre Google Maps con le
  indicazioni stradali verso quel punto (su mobile in genere propone di
  aprire l'app Maps installata).

Da qualunque vista, un account Squadra può solo **aggiungere una nota**
(stesso storico/popup già visto per Admin/Cliente, con "Squadra" come
autore), **segnare un intervento come completato** (icona ✓, senza
vincoli di data: recupera anche un intervento di un giorno passato non
ancora spuntato) o **visualizzare i documenti allegati** (icona 📎, sola
lettura — vedi sezione successiva) — non può creare, modificare, eliminare,
sospendere, annullare, pianificare né caricare/eliminare documenti, né
vedere il **Ricavo (€)** degli interventi (nascosto di proposito, dato non
necessario sul campo).

### Documenti allegati (Google Drive)

Ogni intervento può avere documenti allegati (fatture, moduli, foto...),
archiviati su Google Drive invece che nel foglio: il pulsante **"📎
Documenti"** (tab Interventi per Admin/Cliente, tab "La mia squadra" per
l'account Squadra) apre un popup con l'elenco dei file già caricati (click
per aprirli in una nuova scheda) e, solo per **Admin e Cliente**, un
selettore file per caricarne di nuovi o eliminare quelli esistenti; un
account **Squadra può solo visualizzarli** (e solo quelli della propria
squadra).

**Dove vengono salvati**: alla prima volta che un documento viene caricato
per un intervento, viene creata una sottocartella dedicata dentro la
cartella Drive configurata nella regola **"driveCartellaRadiceId"** (tab
Regole, solo Admin — di default quella indicata all'attivazione di questa
funzionalità), nominata **`yyyyMMdd_ODS_Cliente`** (es.
`20260803_IN-260803-1234_MarioRossi`): la data è la Data Dispacciamento
dell'intervento (oggi se non ancora impostata), l'ODS è il Codice Esterno
(**"SENZA-ODS"** se non ancora presente — capiterà spesso per gli
interventi inseriti a mano prima che arrivi l'ODS ufficiale: la cartella
**si rinomina da sola** non appena il Codice Esterno viene valorizzato, a
mano o da un import successivo che lo riconcilia). L'associazione tra
intervento e cartella è tramite un ID salvato internamente sull'intervento,
non tramite il nome (evita ambiguità se due interventi generassero per
caso lo stesso nome).

**Chi può vedere cosa su Drive**: la cartella di ogni intervento viene
condivisa in sola visualizzazione (non con un link pubblico) con l'elenco
email della regola "emailClienti" e con le email della squadra assegnata a
quell'intervento (campo "Email Account Squadra"); la condivisione viene
verificata e aggiornata automaticamente ad ogni apertura del popup
Documenti, così un cambio di squadra o degli elenchi email si riflette da
solo. L'account che esegue la Web App (impostazioni di distribuzione,
"Esegui come") deve avere accesso in scrittura alla cartella radice
configurata, altrimenti il caricamento fallisce con un errore esplicito.
Nessun limite di tipo o dimensione file è imposto dall'app (i limiti
pratici sono quelli della piattaforma Apps Script/del browser per file
molto grandi). Si possono selezionare e caricare **più file
contemporaneamente** (il selettore accetta selezione multipla): vengono
inviati uno alla volta in sequenza, e un eventuale errore su un file non
blocca gli altri.

**Se al primo caricamento compare un errore di autorizzazione** del tipo
*"Non disponi dell'autorizzazione necessaria per chiamare
DriveApp.getFolderById... auth/drive"*: è normale la prima volta che si usa
questa funzionalità, perché aggiunge un nuovo servizio (Google Drive) allo
script, che richiede un'autorizzazione più ampia rispetto a quella già
concessa in precedenza. Per risolvere (lo fa una volta sola l'account che
esegue la Web App, cioè quello indicato in "Esegui come"):
1. Apri l'editor Apps Script del progetto (da Estensioni → Apps Script sul
   foglio Google, o direttamente da script.google.com).
2. Scegli una qualunque funzione dal menu a tendina in alto (es.
   `cartellaRadiceDocumenti_`) e premi **Esegui**.
3. Comparirà una richiesta di autorizzazione: scegli il tuo account, poi
   (se compare l'avviso "Google non ha verificato questa app", normale per
   uno script personale/interno) clicca **Avanzate** → **Vai al progetto
   (nome progetto), non sicuro** → **Consenti**.
4. Ricarica la Web App: da qui in poi il caricamento documenti funziona
   senza dover ripetere questo passaggio.

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
  pianificazione darà errore "indirizzo non geocodificato";
- le **Priorità automatiche** (SM01-SM05, vedi tab Interventi più sotto) e la
  **fine automatica delle sospensioni "Non Prima Del"** (vedi tab Interventi)
  si aggiornano comunque ad ogni apertura della Web App: il trigger dal menu
  **Delivery Planner → "Attiva aggiornamento giornaliero priorità
  automatiche"** è facoltativo, utile solo per tenerle fresche anche nei
  giorni in cui nessuno apre la Web App (es. prima di una pianificazione
  automatica mattutina schedulata a parte).

### Importare gli interventi da un file Excel (tracking Sicuritalia)

Nel tab **Interventi**, premi **"📥 Importa da Excel"**: si apre il
selettore file del browser, scegli il file `.xlsx` del tracking Sicuritalia
(l'estrazione avviene **interamente lato client**, tramite la libreria
[SheetJS](https://sheetjs.com) caricata da CDN al primo utilizzo — nessun
dato del file transita altrove prima di essere inviato al server della Web
App). Le colonne si leggono per **posizione fissa** (lettera di colonna),
non per nome di intestazione:

| Colonna file | Campo Intervento |
|---|---|
| B (Tipo di ordine) | Tipo Attività (codice SM01-SM05) |
| C (Ordine) | Codice Esterno (Ods) — esattamente come nel file |
| D (Operazione) | Op. |
| M (Richiesta d'acquisto) | Richiesta d'Acquisto (sola lettura) |
| N (Data in. al + presto) | Data Dispacciamento |
| R (Prezzo) | Prezzo Importato (sola lettura) |
| U (Nome lista) | Cliente |
| V (Via) + W (Località) + Y (Provincia) | Indirizzo (concatenato, geocodificato automaticamente) |
| W (Località) | Comune |
| X (Cliente) | Cod. Cliente (sola lettura) |
| Y (Provincia) | usata anche per il filtro regioni (vedi sotto) |
| Z (Equipment) | Cod. Equipment (sola lettura) |

**Codice Esterno = solo Ordine, ma riconciliato con Ordine+Operazione**: il
campo Codice Esterno mostra esattamente il valore della colonna "Ordine",
senza alcuna aggiunta. Dietro le quinte, però, riconoscere un intervento già
importato (per non duplicarlo a un import successivo) usa la coppia
Ordine+Operazione: nel file Sicuritalia la sola colonna "Ordine" non è
univoca — più righe possono condividere lo stesso Ordine con Operazioni
diverse (stesso indirizzo, date/prezzi differenti) — mentre la coppia lo è
sempre. L'Operazione resta comunque visibile a parte nel campo "Op.".

**Protezione dagli zeri iniziali (bug noto, risolto)**: Google Sheets può
reinterpretare in automatico come NUMERO un valore testuale che sembra
numerico (es. un'Operazione "0010" scritta sul foglio può silenziosamente
diventare 10, perdendo gli zeri) a meno che la colonna non sia già
formattata come testo semplice — un comportamento del foglio stesso, non
del codice, ma che rompeva il confronto usato per riconoscere un
intervento già importato, causando duplicati a un reimport. Sono in atto
due protezioni: (1) tutte le colonne di tipo testo/data vengono forzate al
formato testo semplice ("@") — sui fogli nuovi già alla creazione, sui
fogli esistenti con una migrazione una tantum eseguita in automatico alla
prima apertura della Web App dopo l'aggiornamento (marcata con una
proprietà del documento, per non ripeterla ad ogni apertura); (2) il
confronto usato per riconoscere un intervento già importato normalizza
comunque i valori puramente numerici (es. "0010" e "10" vengono trattati
come lo stesso valore), così la riconciliazione resta corretta anche per
le righe già scritte prima di questa correzione.

**Selezione delle regioni da importare**: dopo aver letto il file, un popup
mostra l'elenco delle **regioni italiane presenti nel file** (dedotte dalla
sigla provincia in colonna Y tramite una tabella provincia→regione
integrata, valida per tutte le sigle ufficiali italiane), ciascuna col
numero di righe corrispondenti — utile per importare un file che copre
tutta Italia **gradualmente**, una o più regioni alla volta, ricaricando lo
stesso file più avanti per le regioni ancora da fare. "Seleziona tutte" /
"Deseleziona tutte" per velocizzare la scelta.

**Tipo Attività e durata stimata**: la colonna "Tipo di ordine" (B) diventa
direttamente il codice Tipo Attività — un pulsante **"ℹ Legenda"** (accanto
al campo, nella scheda Intervento, e nella legenda sotto la mappa "Per
tipologia" della Dashboard) ne mostra il significato:

| Codice | Significato | Durata stimata |
|---|---|---|
| SM01 | Installazione | Prezzo ≤ 120€ → 120 min · ≤ 240€ → 240 min · ≤ 350€ → 360 min · oltre → 480 min |
| SM02 | Manutenzione Correttiva | 60 min |
| SM03 | Manutenzione Predittiva | 60 min |
| SM04 | Smontaggio | 60 min |
| SM05 | Sopralluogo | 60 min |

Un codice non tra questi diventa "Altro" e non modifica la durata (resta il
default dello schema, 60 min).

**Comportamento sui re-import**: un Ods (coppia Ordine+Operazione) già presente su
un Intervento esistente **aggiorna** quell'Intervento (cliente, indirizzo,
comune, Tipo Attività, durata stimata, Data Dispacciamento, Richiesta
d'Acquisto, Cod. Cliente, Cod. Equipment, Prezzo Importato) — **senza mai
creare un duplicato** e **senza mai toccare** stato, squadra assegnata,
data/ora pianificata, ordine tappa, Ricavo o voci di listino: questi campi
restano sempre sotto controllo esclusivo della Web App (pianificazione,
"Componi Ricavo"). Un Ods non ancora presente crea un nuovo Intervento in
stato "Da pianificare". **A differenza del vecchio meccanismo di import da
foglio Google, qui non esiste alcun annullamento automatico** per un Ods
che non compare più in un import: sarebbe pericoloso proprio perché
l'import è tipicamente **parziale** (una o poche regioni alla volta) — un
Intervento importato in precedenza e non presente nel batch corrente resta
semplicemente inalterato.

**File di migliaia di righe**: l'elaborazione avviene **a lotti** (150 righe
per chiamata al server, per restare comodamente dentro il limite di 6
minuti di esecuzione di Apps Script anche su file molto grandi): una barra
di avanzamento nel popup mostra quante righe sono state elaborate; se un
lotto scade per tempo, il client lo ripete automaticamente sul segmento
restante prima di passare al successivo. Al termine, la Web App mostra
quanti Interventi sono stati creati, quanti aggiornati e quanti falliti
(con il dettaglio delle prime righe in errore, tipicamente indirizzo non
geocodificabile o dati obbligatori mancanti).

### Importare gli interventi da un foglio Google Sheet esterno (Veneto)

Oltre all'import da file Excel sopra, il tab **Interventi** offre un secondo
pulsante, **"Importa da Google Sheet (Veneto)"**, che legge direttamente —
lato server, non tramite upload dal browser — la tab **"Veneto"** di un
foglio Google esterno configurato (`ID_FOGLIO_VENETO_` in `ImportVeneto.gs`).

**Prerequisito**: quel foglio Google deve essere condiviso **almeno in
lettura** con l'account Google che esegue la Web App (quello scelto in
"Esegui come" nella distribuzione) — altrimenti il pulsante mostra un
errore chiaro invece di un elenco vuoto.

Le colonne si leggono per **posizione fissa**, come per l'import Excel:

| Colonna foglio | Campo Intervento |
|---|---|
| S | Cliente |
| T, B, C (concatenate in quest'ordine) | Indirizzo (geocodificato automaticamente) |
| D | Codice Esterno (Ods) — può anche essere vuoto (vedi sotto) |
| H | Data Dispacciamento |
| G | Tipo Attività (testo libero, tradotto — vedi tabella sotto) |
| N | Prezzo Importato (usato per calcolare la Durata Stimata, vedi sotto) |
| C | Comune |
| L | Telefono |

**Righe senza Codice Esterno**: una riga con la colonna D vuota viene
**importata comunque** (Codice Esterno resta vuoto, da compilare a mano in
seguito appena l'Ods viene assegnato) — non viene scartata né segnata come
fallita.

**Tipo Attività**: la colonna G contiene testo libero (non un codice),
tradotto automaticamente secondo questa mappa (case-insensitive):

| Testo colonna G | Tipo Attività |
|---|---|
| Integrazione impianto, Installazione Filare, Installazione Periferica, Installazione WiComm | SM01 |
| Manutenzione correttiva | SM02 |
| Manutenzione ispettiva | SM03 |
| Smontaggio | SM04 |
| Sopralluogo | SM05 |
| Intervento a vuoto | Intervento a vuoto |

Un testo non riconosciuto diventa "Altro". La **Durata Stimata** segue le
stesse regole già viste per l'import Excel, usando il Prezzo Importato
(colonna N) per le fasce di SM01: Prezzo ≤ 120€ → 120 min · ≤ 240€ → 240 min
· ≤ 350€ → 360 min · oltre → 480 min (Prezzo mancante o non numerico → 120
min); le altre regole (durata fissa per SM02-SM05, Scadenza e Priorità
automatiche) sono le stesse, condivise tra le due fonti di import.

**Filtro sullo stato (colonna M)**: vengono importate/aggiornate **solo** le
righe la cui colonna M vale "Giacente" (case-insensitive) — le altre sono
escluse in automatico, senza creare né
toccare nulla; il risultato dell'import mostra quante righe sono state
scartate per questo motivo.

**Niente duplicati anche se il Codice Esterno si ripete**: a differenza
del file Excel (dove Ordine+Operazione è la coppia univoca), in questo
foglio la colonna D (Ods) **può ripetersi su più righe** senza che
un'altra colonna visibile la disambiguhi. La riconciliazione con un
import successivo usa quindi Ods + colonna T, memorizzata internamente in
un campo dedicato mai mostrato né modificabile ("Chiave Secondaria
Import") — stessa logica di Ordine+Operazione, chiave diversa. Per una riga
senza Ods la riconciliazione si basa sulla sola colonna T. Come per
l'Excel, un re-import **aggiorna** l'Intervento esistente (stessi campi
anagrafici sopra) **senza mai toccare** stato, squadra, data/ora
pianificata, ordine tappa o Ricavo, e non esiste alcun annullamento
automatico per righe non più presenti o non più in uno dei tre stati
importabili.

**File di migliaia di righe**: come per l'Excel, l'elaborazione avviene a
lotti entro il limite di 6 minuti di Apps Script, con avanzamento visibile
e ripresa automatica dal punto in cui si era interrotta.

### Listino e Ricavo

Il tab **Listino** (solo Admin) contiene le voci di prezzo concordate (voce,
descrizione, prezzo — precaricate al primo avvio con il listino Sicuritalia
in vigore, modificabili/aggiungibili/eliminabili liberamente in seguito).
Il **Ricavo (€)** di un Intervento non si scrive più a mano: si compone col
pulsante **"💶 Componi Ricavo"** nell'elenco Interventi, che apre un popup
con l'elenco delle voci di listino (ricercabile) — seleziona una o più voci
e indica la quantità per ciascuna, il Ricavo è la somma dei subtotali
(prezzo unitario × quantità, sempre ricalcolato sul prezzo di listino
**attuale** al momento del salvataggio). Se il Ricavo composto risulta
**inferiore al Prezzo Importato** dal tracking esterno per quell'Intervento,
l'Admin riceve una notifica dedicata (campanella) per valutare un
adeguamento — capita anche automaticamente durante un re-import, se il
Prezzo importato aumenta oltre il Ricavo già composto in precedenza.

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
