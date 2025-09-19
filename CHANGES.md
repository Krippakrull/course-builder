# Ändringslogg

## 2025-09-19

- Initierade SvelteKit-frontend med TypeScript och la till en startvy som testar anslutningen mot backend.
- Skapade Node.js-backend med Express, TypeScript och Postgres-anslutning samt hälsokontroll.
- La till `docker-compose.yml` för att köra Postgres, backend och frontend i utvecklingsläge.
- Uppdaterade README med instruktioner samt skapade `.env.example`-filer för frontend och backend.
- La till `.gitignore` och dokumenterade förändringar i denna fil.
- Implementerade `POST /courses` i backend som skapar kurs med UUID, validerar indata och säkerställer kurs-tabellen i Postgres.

**Nästa steg:** Bygga frontendflödet för att skapa en kurs (dialog + state-initiering enligt US-M1-01) och börja modellera modul- och lektionsstruktur (US-M1-02).
