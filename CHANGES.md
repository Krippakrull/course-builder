# Ändringslogg

## 2025-09-19

- Initierade SvelteKit-frontend med TypeScript och la till en startvy som testar anslutningen mot backend.
- Skapade Node.js-backend med Express, TypeScript och Postgres-anslutning samt hälsokontroll.
- La till `docker-compose.yml` för att köra Postgres, backend och frontend i utvecklingsläge.
- Uppdaterade README med instruktioner samt skapade `.env.example`-filer för frontend och backend.
- La till `.gitignore` och dokumenterade förändringar i denna fil.
- Implementerade `POST /courses` i backend som skapar kurs med UUID, validerar indata och säkerställer kurs-tabellen i Postgres.

## 2025-09-20

- Byggde kursflöde i frontend med modal för att skapa kurser mot `POST /courses`, lokal kursstore och outline för moduler och lektioner.
- Lade till möjlighet att skapa moduler och lektioner i UI samt visning av vald modul/lektion som grund för blockredigeraren.
- Förbättrade kursstoren genom att nollställa till nytt tillstånd, stödja existerande moduler vid `setCourse` och automatiskt välja första modul/lektion om de finns.
- Aktiverade CORS-stöd i backend med konfigurerbara tillåtna ursprung för att möjliggöra kommunikation mellan frontend och API i utvecklingsmiljö.

**Nästa steg:** Konfigurera `CORS_ORIGINS` för relevanta miljöer och knyta modul- och lektionshanteringen till backend (CRUD-endpoints + persistens) samt utöka outline-komponenten med ordning/drag-dropp enligt US-M1-02.

## 2025-09-21

- La till miljövariabeln `CORS_ORIGINS` i backend (kod, `docker-compose` och `.env.example`) och dokumenterade hur den ska sättas.
- Utökade backend med databastabeller för moduler och lektioner samt endpoints för att skapa dem med positionshantering och uppdatering av kursens tidsstämplar.
- Kopplade frontendens modul- och lektionsformulär till backend, visade laddningsstatus och felmeddelanden samt sorterade lokala stores efter position.

**Nästa steg:** Implementera `GET /courses/:id` som returnerar kurs med moduler/lektioner och ladda kursstrukturen från backend vid initiering. Förbered därefter stöd för omordning (drag & drop) och borttagning enligt US-M1-02.

## 2025-09-22

- Implementerade `GET /courses/:id` i backend som returnerar kurs med moduler och lektioner sorterade efter position samt hanterar saknade kurser.
- Laddade kursstrukturen i frontend vid initiering genom att minnas senaste kurs-ID i `localStorage`, hämta kursdata från backend och visa status-/felmeddelanden.
- Rensade och återställde lokalt tillstånd efter laddning och kurskapande för att förbereda kommande hantering av ordning och borttagning.

**Nästa steg:** Bygg API- och UI-stöd för att omordna och ta bort moduler och lektioner (drag & drop + borttagningsflöden) så att kursstrukturen kan persisteras vid förändringar enligt US-M1-02.

## 2025-09-23

- Utökade backend med endpoints för att omordna moduler (`PATCH /courses/:courseId/modules/order`) och lektioner (`PATCH /modules/:moduleId/lessons/order`) samt borttagning av moduler och lektioner med positionsåterställning och tidsstämplar.
- Implementerade drag-och-släpp i frontendens outline för att ändra modul- och lektionsordning, inklusive statusindikatorer, felhantering och fall-back-laddning vid misslyckade sparningar.
- Lagt till borttagningsflöden med bekräftelser, UI-feedback och uppdaterade stores för att hålla vald modul/lektion konsekvent efter ändringar.

**Nästa steg:** Påbörja US-M1-03 genom att etablera backend-endpoint för block (`PATCH /lessons/:id/blocks`) och en första blocklista i frontend (text/heading/list) med autosparningsgrund.

## 2025-09-24

- Konverterade frontendens kursvy till Svelte 5 runes-läge, ersatte den tidigare reaktiviteten med `$state`/`$effect` och uppdaterade händelsebindningar till den nya attributsyntaktiken.
- Synkade kursstoren mot lokala runes-tillstånd och anpassade formulär, drag-och-släpp samt dialoglogik för att fungera med det nya event-API:et.
- Säkerställde att Svelte-check passerar utan varningar genom att justera typinferenser och event-hantering enligt Svelte 5:s riktlinjer.

**Nästa steg:** Fortsätt US-M1-03 genom att bygga backend-endpointen för block (`PATCH /lessons/:id/blocks`) och introducera blocklistan i frontend med autosparningsstöd.
