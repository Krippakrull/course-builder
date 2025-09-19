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

**Nästa steg:** Knyta modul- och lektionshanteringen till backend (CRUD-endpoints + persistens) och utöka outline-komponenten med ordning/drag-dropp enligt US-M1-02.
