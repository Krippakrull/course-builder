# Course Builder

Reposkelett för ett projekt med SvelteKit-frontend, Node.js-backend och Postgres som databas.

## Struktur

- `frontend/` – SvelteKit-applikation
- `backend/` – Express-baserad Node.js-backend
- `docker-compose.yml` – utvecklingsstack med Postgres, backend och frontend

## Kom igång

1. Installera beroenden:
   ```bash
   npm install --prefix frontend
   npm install --prefix backend
   ```
2. Kopiera miljövariabler:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
3. Starta hela stacken:
   ```bash
   docker compose up --build
   ```

Frontend är nåbar på <http://localhost:5173> och backend svarar på <http://localhost:3001>.

## Script

| Katalog   | Kommando           | Beskrivning                              |
|-----------|--------------------|------------------------------------------|
| frontend  | `npm run dev`      | Startar SvelteKit i utvecklingsläge      |
| frontend  | `npm run check`    | Kör typkontroller                        |
| backend   | `npm run dev`      | Startar backend med automatisk omstart   |
| backend   | `npm run lint`     | Kör TypeScript-kompilering utan output   |
| backend   | `npm run build`    | Bygger backend till `dist/`              |

## Docker

`docker-compose.yml` konfigurerar tre tjänster:

- **db** – Postgres 16 med persistent volym `db_data`
- **backend** – Node 20 med Express-server och automatisk installation av beroenden
- **frontend** – Node 20 med SvelteKit dev-server

Samtliga tjänster körs i utvecklingsläge och volymerna mappar mot projektkatalogerna för snabb iteration.
