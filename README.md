# Course Builder

Fullstack-projekt byggt med SvelteKit där frontend och server-API körs i samma applikation. Persistens hanteras via Postgres.

## Struktur

- `frontend/` – SvelteKit-applikation med serverrutter
- `docker-compose.yml` – utvecklingsstack med Postgres och SvelteKit

## Kom igång

1. Installera beroenden:
   ```bash
   npm install --prefix frontend
   ```
2. Kopiera miljövariabler:
   ```bash
   cp frontend/.env.example frontend/.env
   ```
   Säkerställ att `DATABASE_URL` pekar på din Postgres-instans.
3. Starta hela stacken:
   ```bash
   docker compose up --build
   ```

Frontend och API nås via <http://localhost:5173>.

## Script

| Katalog   | Kommando        | Beskrivning                         |
|-----------|-----------------|-------------------------------------|
| frontend  | `npm run dev`   | Startar SvelteKit i utvecklingsläge |
| frontend  | `npm run check` | Kör typkontroller                   |

## Docker

`docker-compose.yml` konfigurerar två tjänster:

- **db** – Postgres 16 med persistent volym `db_data`
- **app** – Node 20 med SvelteKit dev-server och server-API

Båda tjänsterna körs i utvecklingsläge och volymerna mappar mot projektkatalogen för snabb iteration.
