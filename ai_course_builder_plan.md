
# AI-kursbyggare – Projekt- och Implementationsplan
**Version:** 1.0  
**Datum:** 2025-09-19  
**Ägare:** Krister (Product/Tech Lead)  

Denna fil är strukturerad för att kunna konsumeras av en kodagent. Den innehåller:
- Övergripande projektplan (mål, arkitektur, milstolpar).
- Stegvis implementationsplan uppdelad i sprintar/milstolpar.
- User stories med ID:n, acceptance criteria (AC), uppgifter (Tasks), och tekniska anteckningar (Tech Notes).
- API-kontrakt (OpenAPI-stubbar), datascheman och export-specar (SCORM/xAPI).
- Definition of Done, risker och kvalitetskriterier.

---

## 0. Målbild & Principer
- **Block-baserad** kurseditor med hierarki *Kurs → Modul → Lektion → Block*.
- **AI-stöd via Google Gemini** (användarens API-nyckel) och dokumentbaserad generering (RAG-light). Upp till **5 källdokument** per kurs.
- **Per-block AI-regenerering** och manuell redigering med versionshantering och diff.
- **Export** till **SCORM 1.2** (MVP) och **xAPI (Tin Can)**; validering ingår.
- **Webbdeploy** (SPA + API), lätt att köra on-prem/SaaS. EU-datapraxis.
- **Tillgänglighet och spårbarhet** (A11y-grund, AI-loggar, återställ/versionshistorik).

---

## 1. Hög-nivå Arkitektur
### 1.1 Frontend
- **Ramverk:** SvelteKit(TipTap/ProseMirror eller Slate för rich-text).
- **State:** Normaliserad kursmodell i store (kurs/modul/lektion/block).
- **Funktioner:** Blockeditor, dokumentpanel, AI-modaler, preview, exportwizard.

### 1.2 Backend
- **Språk:** Node.js (TypeScript)
- **Tjänster:** REST API (CRUD för kursdata, dokumentparser, RAG-index, exportmotor, xAPI/SCORM-paketering).
- **Lagring:** PostgreSQL (kursdata/metadata), Blob store (filer), vektorindex (pgvector) eller lokalt WASM-index för klient-tunga scenarion.
- **Säkerhet:** OIDC (framtid), JWT-sessions, krypterad hantering av Gemini-nycklar (helst lokalt i klient; server-vault valbart).

### 1.3 Exportmotor
- Separat modul/bibliotek som tar `CourseJSON → SCORM 1.2 ZIP` och `CourseJSON → xAPI launch ZIP`.

### 1.4 RAG-light pipeline
- Parsing → Chunking (500–1200 tokens, overlapp) → Embeddings → vektorindex → Retriever → Prompt adapter (teman).

---

## 2. Milstolpar och Sprintplan (8–10 veckor MVP)
**M1 (Vecka 1–2):** Kursmodell, blockeditor (text/heading/list), CRUD-API, autosave.  
**M2 (Vecka 2–3):** Dokumentuppladdning (≤5), parsing, chunking, index.  
**M3 (Vecka 3–4):** Gemini-integration (API-nyckel lokalt), AI-assist (utkast/summary).  
**M4 (Vecka 4–5):** Per-block regenerate + diff/versionshantering.  
**M5 (Vecka 5–6):** Quiz-block (MCQ/TF/Short), preview-spelare, local progress.  
**M6 (Vecka 6–7):** SCORM 1.2-export (manifest, SCO, spårning).  
**M7 (Vecka 7–8):** xAPI (Tin Can) launch-paket, konfiguration, validator.  
**Hardening (Vecka 9–10):** A11y, telemetri, kostkontroll, E2E-tester, prestanda.

---

## 3. User Stories (för kodagent)
> Format: `US-<Milstolpe>-<Löpnummer>`  
> Varje story har AC (Acceptance Criteria), Tasks, Tech Notes, Estimat (T-shirt).

### 3.1 M1 – Editor Core & Kursmodell
**US-M1-01 – Skapa kurs**  
**Som** författare **vill jag** skapa en ny kurs **så att** jag kan börja strukturera innehåll.  
**AC:**  
- Skapa kurs med `title`, `language`, auto-`courseId` (UUID).  
- Kurs visas i sidopanel med tom modul-lista.  
- Persistens i DB (Postgres).  
**Tasks:**  
- [BE] `POST /courses`  
- [FE] Dialog “Ny kurs” + state init.  
- [BE] Repo/ORM modell.  
**Tech Notes:** Kursobjekt enligt dataschema i avsnitt 5.  
**Est:** S

**US-M1-02 – Lägg till modul/lektion**  
**AC:**  
- Lägg till/ta bort/ordna moduler och lektioner (drag/drop).  
- Breadcrumbs + outline uppdateras.  
**Tasks:**  
- [FE] Tree/outline-komponent.  
- [BE] `POST /courses/:id/modules`, `POST /modules/:id/lessons`, `PATCH /order`.  
**Est:** M

**US-M1-03 – Block: text, heading, list**  
**AC:**  
- Infoga/ta bort/duplicera/flytta block via toolbar och “/”-meny.  
- Autosave (debounced).  
- Tangentbordsnavigering.  
**Tasks:**  
- [FE] Blockrenderer + TipTap/Slate extensioner.  
- [BE] `PATCH /lessons/:id/blocks` (upsert).  
**Est:** M

**US-M1-04 – Autosave & versionsfält**  
**AC:**  
- Autosave var 2–5 s efter inaktivhet.  
- `version`-fält per block ökar vid förändring.  
**Tasks:**  
- [FE] Debounce + optimistic UI.  
- [BE] Transaktionell upsert.  
**Est:** S

### 3.2 M2 – Dokument & Index
**US-M2-01 – Ladda upp källdokument (≤5)**  
**AC:**  
- UI hindrar >5. Filtyper: pdf/docx/txt/md.  
- Lista med namn, storlek, typ; ta bort/återställ.  
**Tasks:**  
- [FE] Uploader med progress.  
- [BE] `POST /courses/:id/sources (multipart)` + blob-lagring.  
**Est:** M

**US-M2-02 – Parsing & chunking**  
**AC:**  
- PDF: text + sidnummer; DOCX/MD/TXT: ren text + rubriker.  
- Chunking 500–1200 tokens, 10–15% overlap. Metadata: `docId`, `page`, `headingPath`.  
**Tasks:**  
- [BE] Parser pipeline (pdf-lib/mammoth/markdown-it).  
- [BE] Chunker + tokenizer.  
**Est:** M

**US-M2-03 – Indexera & sök**  
**AC:**  
- Skapa embeddings och spara i vektorindex (pgvector).  
- Retriever-endpoint returnerar top-k (k=5–10) med score.  
**Tasks:**  
- [BE] `POST /courses/:id/index`, `GET /courses/:id/search?q=...`  
- [BE] Embedding-provider adapter (Gemini-embeddings eller lokal).  
**Est:** M

### 3.3 M3 – Gemini-integration & AI-Assist
**US-M3-01 – Lagra Gemini-nyckel lokalt**  
**AC:**  
- Fält i “Inställningar” för API-nyckel.  
- Nyckel lagras krypterat i IndexedDB (Web Crypto).  
- “Testa nyckel” ger OK/fel.  
**Tasks:**  
- [FE] Settings UI + Crypto-wrapper.  
- [FE] Healthcheck-anrop till Gemini.  
**Est:** S

**US-M3-02 – Generera lektionsutkast från källor**  
**AC:**  
- Välj källor (checkbox), målgrupp, längd, språk.  
- Skapar nya block i vald lektion (rubrik + stycken + punktlistor).  
- Loggar prompt/svar i AI-logg.  
**Tasks:**  
- [FE] Modal “AI-assist: Lektionsutkast”.  
- [BE] `POST /ai/generate/lesson` → adapter mot Gemini + retriever.  
**Est:** M

**US-M3-03 – Sammanfatta avsnitt**  
**AC:**  
- Markera block → “Sammanfatta” skapar nytt block med sammanfattning.  
**Tasks:**  
- [FE] Context action.  
- [BE] `POST /ai/summarize`  
**Est:** S

### 3.4 M4 – Per-block Regenerate & Diff
**US-M4-01 – Regenerate block**  
**AC:**  
- Knapp “Förbättra/Regenerate” på block.  
- Val: ton (formell/coachande), längd, målgrupp, Bloom-nivå.  
- Diff-vy (before/after) och “Ersätt/Avbryt/Infoga nytt block”.  
**Tasks:**  
- [FE] Modal + diff-komponent.  
- [BE] `POST /ai/rewriteBlock` (skickar blockContent + constraints + retrieval).  
**Est:** M

**US-M4-02 – Versionshistorik & återställ**  
**AC:**  
- Visa tidigare versioner per block; återställ vald version.  
**Tasks:**  
- [BE] Versions-tabell.  
- [FE] Historia-panel.  
**Est:** S

### 3.5 M5 – Quiz & Preview
**US-M5-01 – Quiz-block (MCQ/TF/Short)**  
**AC:**  
- Skapa/redigera frågor, svarsalternativ, korrekta svar, feedback.  
- Validering (minst ett rätt svar, inga dubbletter).  
**Tasks:**  
- [FE] Quiz-editor.  
- [BE] Quiz-modell + CRUD.  
**Est:** M

**US-M5-02 – AI-generera quiz från källor**  
**AC:**  
- “Generera quiz” (antal frågor, typmix), visar förhandsgranskning + förbättra/regenerate per fråga.  
**Tasks:**  
- [FE] Generator-UI.  
- [BE] `POST /ai/generate/quiz`  
**Est:** M

**US-M5-03 – Preview-spelare + progress**  
**AC:**  
- Navigera modul/lektion, markera genomförd.  
- LocalStorage progress och enkel SCORM-mock-API för test.  
**Tasks:**  
- [FE] Player-komponent.  
- [FE] SCORM shim (window.API).  
**Est:** M

### 3.6 M6 – SCORM 1.2 Export
**US-M6-01 – Generera SCORM ZIP**  
**AC:**  
- Exportwizard väljer “SCORM 1.2”.  
- Skapar `imsmanifest.xml`, mappar lektion→SCO, inkluderar HTML/JS/CSS/assets, zip:ar.  
- Validering: manifest schema + basrundning i scormtestare (lokal).  
**Tasks:**  
- [BE] Exportmodul `course→zip`.  
- [FE] Wizard + nedladdning.  
**Est:** L

**US-M6-02 – SCORM-interaktioner (quiz)**  
**AC:**  
- Quiz skickar `cmi.core.score.raw`, `cmi.interactions.n` vid svar.  
- Completion flaggas korrekt.  
**Tasks:**  
- [FE] Player kopplad mot SCORM API.  
- [FE] Mappningstabell.  
**Est:** M

### 3.7 M7 – xAPI (Tin Can)
**US-M7-01 – xAPI launch-paket**  
**AC:**  
- Konfiguration av LRS endpoint, auth, actor (mail).  
- Player sänder `experienced`, `answered`, `passed/failed`.  
- Export av paket (HTML-launch + xAPI client).  
**Tasks:**  
- [BE] xAPI exportmodul.  
- [FE] xAPI client.  
**Est:** M

**US-M7-02 – Validator & rapport**  
**AC:**  
- Kör grundvalidering och visar checklista/resultat.  
**Tasks:**  
- [FE] Validator-UI.  
- [BE] Schema/konfig-checks.  
**Est:** S

---

## 4. API-kontrakt (OpenAPI-stubbar)
```yaml
openapi: 3.0.3
info:
  title: AI Course Builder API
  version: 1.0.0
paths:
  /courses:
    post:
      summary: Create course
      requestBody: {required: true}
      responses: { "201": { description: "Created" } }
  /courses/{courseId}:
    get: { summary: Get course, responses: { "200": { description: OK } } }
    patch: { summary: Update course, responses: { "200": { description: OK } } }
  /courses/{courseId}/modules:
    post: { summary: Add module, responses: { "201": { description: Created } } }
  /modules/{moduleId}/lessons:
    post: { summary: Add lesson, responses: { "201": { description: Created } } }
  /lessons/{lessonId}/blocks:
    patch: { summary: Upsert blocks, responses: { "200": { description: OK } } }
  /courses/{courseId}/sources:
    post: { summary: Upload up to 5 documents, responses: { "201": { description: Created } } }
  /courses/{courseId}/index:
    post: { summary: Build vector index, responses: { "202": { description: Accepted } } }
  /courses/{courseId}/search:
    get: { summary: Retrieve top-k chunks, responses: { "200": { description: OK } } }
  /ai/generate/lesson:
    post: { summary: Generate lesson draft with RAG, responses: { "200": { description: OK } } }
  /ai/summarize:
    post: { summary: Summarize selected blocks, responses: { "200": { description: OK } } }
  /ai/rewriteBlock:
    post: { summary: Rewrite a block, responses: { "200": { description: OK } } }
  /export/scorm12/{courseId}:
    post: { summary: Export SCORM 1.2 zip, responses: { "200": { description: "ZIP stream" } } }
  /export/xapi/{courseId}:
    post: { summary: Export xAPI launch zip, responses: { "200": { description: "ZIP stream" } } }
```

---

## 5. Datascheman (förenklat)
```ts
// Course
type Course = {{
  courseId: string;
  title: string;
  language: string; // e.g., "sv-SE"
  modules: Module[];
  sources: SourceDocRef[];
  createdAt: string;
  updatedAt: string;
}};

type Module = {{
  moduleId: string;
  title: string;
  lessons: Lesson[];
}};

type Lesson = {{
  lessonId: string;
  title: string;
  blocks: Block[];
}};

type Block = {{
  blockId: string;
  type: "heading" | "paragraph" | "list" | "image" | "video" | "quiz";
  content: any; // specific per type
  version: number;
  ai?: {{
    lastPrompt?: string;
    lastModel?: string;
    lastUpdatedAt?: string;
    sourceDocRefs?: string[];
  }};
}};

type QuizBlock = Block & {{
  type: "quiz";
  content: {{
    items: Array<
      | {{ kind: "mcq"; question: string; options: string[]; correct: number[]; feedback?: string }}
      | {{ kind: "tf"; question: string; correct: boolean; feedback?: string }}
      | {{ kind: "short"; question: string; acceptable: string[]; feedback?: string }}
    >;
    scoring: {{ passingScore: number }};
  }};
}};

type SourceDocRef = {{
  docId: string;
  name: string;
  mime: string;
  size: number;
  pages?: number;
  chunks?: number;
  priority: number; // 1..5
}};
```

**DB-relations (PostgreSQL, förenklat):**
```sql
CREATE TABLE courses (
  course_id uuid PRIMARY KEY,
  title text NOT NULL,
  language text NOT NULL,
  created_at timestamptz NOT NULL default now(),
  updated_at timestamptz NOT NULL default now()
);

CREATE TABLE modules (
  module_id uuid PRIMARY KEY,
  course_id uuid REFERENCES courses(course_id) ON DELETE CASCADE,
  title text NOT NULL,
  position int NOT NULL
);

CREATE TABLE lessons (
  lesson_id uuid PRIMARY KEY,
  module_id uuid REFERENCES modules(module_id) ON DELETE CASCADE,
  title text NOT NULL,
  position int NOT NULL
);

CREATE TABLE blocks (
  block_id uuid PRIMARY KEY,
  lesson_id uuid REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  type text NOT NULL,
  content jsonb NOT NULL,
  version int NOT NULL default 1,
  position int NOT NULL,
  ai jsonb,
  created_at timestamptz NOT NULL default now(),
  updated_at timestamptz NOT NULL default now()
);

-- Vectorindex (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (
  chunk_id uuid PRIMARY KEY,
  course_id uuid REFERENCES courses(course_id) ON DELETE CASCADE,
  doc_id uuid NOT NULL,
  text text NOT NULL,
  meta jsonb,
  embedding vector(1536)
);
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);
```

---

## 6. SCORM 1.2 Export – Spec
- **Struktur:** Varje *lektion* = ett SCO (enkel navigering).  
- **Manifest:** `imsmanifest.xml` med `<organization>` som speglar Kurs/Modul/Lektion.  
- **Player:** HTML/JS som kommunicerar med `window.API` (SCORM 1.2).  
- **Quiz-mappning:**  
  - `cmi.core.lesson_status`: `completed|passed|failed|incomplete`  
  - `cmi.core.score.raw`: 0–100  
  - `cmi.interactions.n`: `{id, type, student_response, result, latency, description}`  
- **Paketering:** ZIP med `/index.html`, `/sco/<lessonId>.html`, `/assets/*`, `imsmanifest.xml`.

---

## 7. xAPI (Tin Can) – Spec
- **Konfig:** LRS endpoint + auth (Basic/Bearer), actor `{mbox: "mailto:user@domain"}`.  
- **Verb:** `experienced`, `answered`, `passed`, `failed`.  
- **Object:** `{id: activityId, definition: { name, description }}`.  
- **Context:** `{contextActivities: { parent: [kurs/modul] }}`.  
- **Launch-paket:** HTML + JS-klient (fetch/queue + retry).

---

## 8. Prompt-ramverk (för kodagent/BE-adapter)
- **System:** “Du är en kursförfattarassistent. Skriv sakligt, tydligt, nivåanpassat.”  
- **Teman:** `lesson_draft`, `summary`, `rewrite_block`, `quiz_generation`.  
- **Constraints:** språk, målgrupp, längd, Bloom-nivå, stil (formell/coachande/akademisk).  
- **RAG-instruktion:** “Använd endast tillhandahållna källutdrag. Citat markeras med [k#sid]. Om information saknas, säg det.”  
- **Kostkontroll:** beräkna max tokens och trimma kontext; top-k + max chars per chunk.

---

## 9. Definition of Done (per milstolpe)
- Kod: enhetstester (>=70% på kritiska moduler), E2E för huvudsflow.  
- Dokumentation: README + API-refs uppdaterade.  
- Säkerhet: Inga hårdkodade nycklar, basic rate limiting.  
- Prestanda: Editor TTI < 2s lokalt, AI-svar < 6s p95 med 2 källfiler.  
- A11y: WCAG-baskontroller (kontrast, ALT, tab-ordning).

---

## 10. Risker & Mitigering
- **PDF-parsing bristfällig** → fallback till OCR-lösning/”manuell rensning”‑läge.  
- **LLM-hallucinationer** → källstöd i UI, “visa referenser”, tydlig RAG-policy.  
- **SCORM‑kompatibilitet** → testa mot minst två externa LMS + lokal testare.  
- **Kostspik** → tokenbudget, förhandsestimat, cachning av partialresultat.  
- **Multi-tenant/Säkerhet** → isolerade namespaces och policyer för nycklar.

---

## 11. Backlog (utanför MVP)
- SCORM 2004 3rd/4th, samarbetsredigering (CRDT), OIDC/SSO, import från SCORM, termutvinning/ordlista, innehållsmallar på org‑nivå, teman (ljus/mörk), audit log och rapporter.

---

## 12. Spårningsmatris (Stories → Milstolpe)
- M1: US-M1-01..04  
- M2: US-M2-01..03  
- M3: US-M3-01..03  
- M4: US-M4-01..02  
- M5: US-M5-01..03  
- M6: US-M6-01..02  
- M7: US-M7-01..02

---

## 13. Kommandosnuttar för Kodagent (exempel)
```bash
# Generera backend-projekt (Node/TS)
pnpm create t3-app ai-course-builder --noNextAuth
pnpm add zod fastify @fastify/multipart pg prisma @neondatabase/serverless
pnpm add -D vitest tsx

# Frontend (SvelteKit + TipTap)
pnpm create svelte@latest editor
pnpm add @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extension-heading

# SCORM export util
pnpm add jszip fast-xml-parser

# xAPI client
pnpm add ky uuid
```
