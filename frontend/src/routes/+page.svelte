<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';
  import { courseStore } from '$lib';
  import type {
    CourseStoreState,
    CourseSummary,
    Module,
    Lesson,
  } from '$lib';

  const backendUrl = env.PUBLIC_BACKEND_URL || 'http://localhost:3001';

  type CreateCourseForm = {
    title: string;
    language: string;
  };

  const languageOptions = [
    { value: 'sv', label: 'Svenska' },
    { value: 'en', label: 'English' },
  ];

  let backendStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let backendMessage = '';

  let showCreateCourseDialog = false;
  let createCourseForm: CreateCourseForm = { title: '', language: 'sv' };
  let createCourseErrors: { title?: string; language?: string; general?: string } = {};
  let isCreatingCourse = false;

  let newModuleTitle = '';
  let lessonDrafts: Record<string, string> = {};
  let lessonErrors: Record<string, string | undefined> = {};
  let lessonPending: Record<string, boolean | undefined> = {};

  let courseState: CourseStoreState;
  $: courseState = $courseStore;
  $: currentCourse = courseState.course;
  $: selectedModule =
    currentCourse?.modules.find((module) => module.moduleId === courseState.selectedModuleId) ??
    null;
  $: selectedLesson =
    selectedModule?.lessons.find((lesson) => lesson.lessonId === courseState.selectedLessonId) ??
    null;

  let moduleError: string | null = null;
  let isCreatingModule = false;

  onMount(async () => {
    backendStatus = 'loading';

    try {
      const response = await fetch(`${backendUrl}/health`);
      const data = (await response.json().catch(() => null)) as
        | { status?: string; database?: string; timestamp?: string }
        | null;

      if (!response.ok) {
        throw new Error(`Backend svarade med status ${response.status}`);
      }

      backendStatus = 'success';
      backendMessage =
        data?.database === 'connected'
          ? 'Backend ansluten och databas kontaktbar.'
          : 'Backend svarade.';
    } catch (error) {
      backendStatus = 'error';
      backendMessage = (error as Error).message;
    }
  });

  function openCreateCourseDialog() {
    createCourseForm = { title: '', language: 'sv' };
    createCourseErrors = {};
    showCreateCourseDialog = true;
    isCreatingCourse = false;
  }

  function closeCreateCourseDialog() {
    if (isCreatingCourse) {
      return;
    }

    showCreateCourseDialog = false;
  }

  function getLanguageLabel(value: string) {
    return languageOptions.find((option) => option.value === value)?.label ?? value;
  }

  function validateCreateCourseForm() {
    const errors: typeof createCourseErrors = {};

    if (!createCourseForm.title.trim()) {
      errors.title = 'Ange en titel.';
    }

    if (!createCourseForm.language.trim()) {
      errors.language = 'Ange ett språk.';
    }

    createCourseErrors = errors;
    return Object.keys(errors).length === 0;
  }

  function parseCoursePayload(payload: unknown): CourseSummary {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Oväntat svar från servern.');
    }

    const { courseId, title, language, createdAt, updatedAt } = payload as Record<string, unknown>;

    if (
      typeof courseId !== 'string' ||
      typeof title !== 'string' ||
      typeof language !== 'string' ||
      typeof createdAt !== 'string' ||
      typeof updatedAt !== 'string'
    ) {
      throw new Error('Svar saknar förväntade fält.');
    }

    return { courseId, title, language, createdAt, updatedAt };
  }

  // Helper: Ensure payload is a non-null object
  function assertObject(payload: unknown, context: string) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Oväntat svar för ${context}.`);
    }
  }

  // Helper: Validate required string fields
  function assertStringFields(obj: Record<string, unknown>, fields: string[], context: string) {
    for (const field of fields) {
      if (typeof obj[field] !== 'string') {
        throw new Error(`Svar saknar förväntade fält '${field}' för ${context}.`);
      }
    }
  }

  // Helper: Parse and validate numeric field
  function parseNumericField(value: unknown, fieldName: string, context: string): number {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Fältet '${fieldName}' för ${context} är ogiltig.`);
    }
    return num;
  }

  function parseLessonPayload(payload: unknown, context = 'lesson'): Lesson {
    assertObject(payload, context);
    const { lessonId, title, position } = payload as Record<string, unknown>;
    assertStringFields(payload as Record<string, unknown>, ['lessonId', 'title'], context);
    const numericPosition = parseNumericField(position, 'position', context);
    return {
      lessonId: lessonId as string,
      title: title as string,
      position: numericPosition,
    };
  }

  function parseModulePayload(payload: unknown): Module {
    const context = 'modul';
    assertObject(payload, context);
    const { moduleId, title, position, lessons } = payload as Record<string, unknown>;
    assertStringFields(payload as Record<string, unknown>, ['moduleId', 'title'], context);
    const numericPosition = parseNumericField(position, 'position', context);
    const parsedLessons = Array.isArray(lessons)
      ? lessons.map((lesson, index) => parseLessonPayload(lesson, `lesson ${index + 1}`))
      : [];
    return {
      moduleId: moduleId as string,
      title: title as string,
      position: numericPosition,
      lessons: parsedLessons,
    };
  }

  async function handleCreateCourseSubmit(event: SubmitEvent) {
    event.preventDefault();

    if (!validateCreateCourseForm()) {
      return;
    }

    isCreatingCourse = true;
    createCourseErrors = {};

    try {
      const response = await fetch(`${backendUrl}/courses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: createCourseForm.title.trim(),
          language: createCourseForm.language.trim(),
        }),
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'message' in payload
            ? String((payload as { message?: unknown }).message ?? 'Kunde inte skapa kursen.')
            : `Kunde inte skapa kursen (status ${response.status}).`;
        throw new Error(message);
      }

      const course = parseCoursePayload(payload);
      courseStore.setCourse(course);
      showCreateCourseDialog = false;
      newModuleTitle = '';
      lessonDrafts = {};
    } catch (error) {
      createCourseErrors = { general: (error as Error).message };
    } finally {
      isCreatingCourse = false;
    }
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeCreateCourseDialog();
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (!showCreateCourseDialog) {
      return;
    }

    handleDialogKeydown(event);
  }

  function handleAddModule() {
    const title = newModuleTitle.trim();
    if (!title || !currentCourse || isCreatingModule) {
      return;
    }

    void (async () => {
      isCreatingModule = true;
      moduleError = null;

      try {
        const response = await fetch(`${backendUrl}/courses/${currentCourse.courseId}/modules`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title }),
        });

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as unknown) : null;

        if (!response.ok) {
          const message =
            payload && typeof payload === 'object' && 'message' in payload
              ? String((payload as { message?: unknown }).message ?? 'Kunde inte skapa modul.')
              : `Kunde inte skapa modul (status ${response.status}).`;
          throw new Error(message);
        }

        const module = parseModulePayload(payload);
        courseStore.addModule(module);
        newModuleTitle = '';
      } catch (error) {
        moduleError = (error as Error).message;
      } finally {
        isCreatingModule = false;
      }
    })();
  }

  function handleAddLesson(moduleId: string) {
    const title = (lessonDrafts[moduleId] ?? '').trim();
    if (!title || lessonPending[moduleId]) {
      return;
    }

    void (async () => {
      lessonPending = { ...lessonPending, [moduleId]: true };
      lessonErrors = { ...lessonErrors, [moduleId]: undefined };

      try {
        const response = await fetch(`${backendUrl}/modules/${moduleId}/lessons`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title }),
        });

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as unknown) : null;

        if (!response.ok) {
          const message =
            payload && typeof payload === 'object' && 'message' in payload
              ? String((payload as { message?: unknown }).message ?? 'Kunde inte skapa lektion.')
              : `Kunde inte skapa lektion (status ${response.status}).`;
          throw new Error(message);
        }

        const lesson = parseLessonPayload(payload);
        courseStore.addLesson(moduleId, lesson);
        lessonDrafts = { ...lessonDrafts, [moduleId]: '' };
      } catch (error) {
        lessonErrors = { ...lessonErrors, [moduleId]: (error as Error).message };
      } finally {
        lessonPending = { ...lessonPending, [moduleId]: false };
      }
    })();
  }

  function handleModuleDraftChange(moduleId: string, value: string) {
    lessonDrafts = { ...lessonDrafts, [moduleId]: value };
  }
</script>

<svelte:head>
  <title>Course Builder</title>
</svelte:head>

<svelte:window on:keydown={handleGlobalKeydown} />

<main>
  <header class="page-header">
    <div>
      <h1>Course Builder</h1>
      <p class="lead">Skapa kursstrukturer med moduler, lektioner och block-baserat innehåll.</p>
    </div>

    <div class="header-actions">
      <button class="primary" type="button" on:click={openCreateCourseDialog}>
        Ny kurs
      </button>
      <div class="backend-status" data-status={backendStatus}>
        {#if backendStatus === 'loading'}
          <span class="dot" aria-hidden="true"></span>
          <span>Kontrollerar backend…</span>
        {:else if backendStatus === 'success'}
          <span class="dot" aria-hidden="true"></span>
          <span>{backendMessage}</span>
        {:else if backendStatus === 'error'}
          <span class="dot" aria-hidden="true"></span>
          <span>Backend-fel: {backendMessage}</span>
        {:else}
          <span class="dot" aria-hidden="true"></span>
          <span>Backend-status okänd.</span>
        {/if}
      </div>
    </div>
  </header>

  {#if currentCourse}
    <section class="workspace">
      <aside class="outline" aria-label="Kursstruktur">
        <div class="outline-header">
          <h2>{currentCourse.title}</h2>
          <p class="muted">Språk: {getLanguageLabel(currentCourse.language)}</p>
        </div>

        <div class="module-list">
          {#if currentCourse.modules.length === 0}
            <p class="empty">Inga moduler ännu. Lägg till din första modul nedan.</p>
          {/if}

          {#each currentCourse.modules as module, index}
            <section class="module" class:active={module.moduleId === courseState.selectedModuleId}>
              <header>
                <button
                  type="button"
                  class="module-trigger"
                  on:click={() => courseStore.selectModule(module.moduleId)}
                >
                  <span class="module-index">Modul {index + 1}</span>
                  <span class="module-title">{module.title}</span>
                </button>
              </header>

              <div class="lessons">
                {#if module.lessons.length === 0}
                  <p class="empty">Inga lektioner ännu.</p>
                {:else}
                  <ul>
                    {#each module.lessons as lesson, lessonIndex}
                      <li>
                        <button
                          type="button"
                          class:active={
                            lesson.lessonId === courseState.selectedLessonId &&
                            module.moduleId === courseState.selectedModuleId
                          }
                          on:click={() => courseStore.selectLesson(module.moduleId, lesson.lessonId)}
                        >
                          <span class="lesson-index">Lektion {lessonIndex + 1}</span>
                          <span class="lesson-title">{lesson.title}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}

                <form
                  class="lesson-form"
                  on:submit|preventDefault={() => handleAddLesson(module.moduleId)}
                >
                  <label class="sr-only" for={`lesson-${module.moduleId}`}>
                    Lektionstitel för {module.title}
                  </label>
                  <input
                    id={`lesson-${module.moduleId}`}
                    name={`lesson-${module.moduleId}`}
                    type="text"
                    placeholder="Lägg till lektion"
                    value={lessonDrafts[module.moduleId] ?? ''}
                    on:input={(event) =>
                      handleModuleDraftChange(module.moduleId, (event.target as HTMLInputElement).value)}
                    disabled={Boolean(lessonPending[module.moduleId])}
                  />
                  <button type="submit" disabled={Boolean(lessonPending[module.moduleId])}>
                    {lessonPending[module.moduleId] ? 'Sparar…' : 'Spara'}
                  </button>
                  {#if lessonErrors[module.moduleId]}
                    <p class="form-error">{lessonErrors[module.moduleId]}</p>
                  {/if}
                </form>
              </div>
            </section>
          {/each}
        </div>

        <form class="module-form" on:submit|preventDefault={handleAddModule}>
          <label class="sr-only" for="module-title">Modulstitel</label>
          <input
            id="module-title"
            name="module-title"
            type="text"
            placeholder="Lägg till modul"
            bind:value={newModuleTitle}
            disabled={isCreatingModule}
          />
          <button type="submit" disabled={isCreatingModule}>
            {isCreatingModule ? 'Lägger till…' : 'Lägg till modul'}
          </button>
          {#if moduleError}
            <p class="form-error">{moduleError}</p>
          {/if}
        </form>
      </aside>

      <section class="details" aria-live="polite">
        {#if selectedLesson}
          <div class="detail-card">
            <h2>{selectedLesson.title}</h2>
            <p class="muted">
              Tillhör modul: {selectedModule?.title ?? 'Okänd modul'} • Position: {selectedLesson.position + 1}
            </p>
            <p>
              Blockredigering kommer här. Nästa steg är att koppla block och autosparning mot backend.
            </p>
          </div>
        {:else if selectedModule}
          <div class="detail-card">
            <h2>{selectedModule.title}</h2>
            <p class="muted">Position: {selectedModule.position + 1}</p>
            <p>Välj en lektion eller skapa en ny för att börja lägga till block.</p>
          </div>
        {:else}
          <div class="detail-card">
            <h2>Välj modul eller lektion</h2>
            <p>Markera en modul eller lektion i vänsterspalten för att se detaljer.</p>
          </div>
        {/if}
      </section>
    </section>
  {:else}
    <section class="empty-state">
      <h2>Skapa din första kurs</h2>
      <p>
        Starta genom att skapa en kurs. När kursen har skapats kan du lägga till moduler och lektioner i
        kursstrukturen.
      </p>
      <button class="primary" type="button" on:click={openCreateCourseDialog}>
        Starta ny kurs
      </button>
    </section>
  {/if}
</main>

{#if showCreateCourseDialog}
  <div class="modal-root">
    <div class="modal-scrim" aria-hidden="true" on:click={closeCreateCourseDialog}></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-course-title">
      <form class="modal-content" on:submit={handleCreateCourseSubmit}>
        <div class="modal-header">
          <h2 id="create-course-title">Ny kurs</h2>
        </div>

        <div class="modal-body">
          {#if createCourseErrors.general}
            <p class="alert">{createCourseErrors.general}</p>
          {/if}

          <label for="course-title">Titel</label>
          <input
            id="course-title"
            name="title"
            type="text"
            placeholder="Till exempel: Introduktion till AI"
            bind:value={createCourseForm.title}
            class:error={Boolean(createCourseErrors.title)}
            aria-invalid={Boolean(createCourseErrors.title)}
          />
          {#if createCourseErrors.title}
            <p class="field-error">{createCourseErrors.title}</p>
          {/if}

          <label for="course-language">Språk</label>
          <select
            id="course-language"
            name="language"
            bind:value={createCourseForm.language}
            class:error={Boolean(createCourseErrors.language)}
            aria-invalid={Boolean(createCourseErrors.language)}
          >
            {#each languageOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if createCourseErrors.language}
            <p class="field-error">{createCourseErrors.language}</p>
          {/if}
        </div>

        <div class="modal-footer">
          <button type="button" class="ghost" on:click={closeCreateCourseDialog} disabled={isCreatingCourse}>
            Avbryt
          </button>
          <button type="submit" class="primary" disabled={isCreatingCourse}>
            {#if isCreatingCourse}
              Skapar…
            {:else}
              Skapa kurs
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    background: #f5f7fb;
    color: #1f2933;
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
  }

  .page-header h1 {
    margin: 0;
    font-size: 2.25rem;
    font-weight: 700;
  }

  .lead {
    margin: 0.25rem 0 0;
    color: #52606d;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .backend-status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    background: #e4e7ec;
    font-size: 0.9rem;
    color: #364152;
  }

  .backend-status[data-status='loading'] {
    background: #f4ebff;
    color: #6941c6;
  }

  .backend-status[data-status='success'] {
    background: #dcfce7;
    color: #047857;
  }

  .backend-status[data-status='error'] {
    background: #fee2e2;
    color: #b91c1c;
  }

  .backend-status .dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 999px;
    background: currentColor;
  }

  .primary {
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 0.65rem;
    padding: 0.65rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease-in-out;
  }

  .primary:disabled {
    opacity: 0.7;
    cursor: default;
  }

  .primary:not(:disabled):hover,
  .primary:not(:disabled):focus-visible {
    background: #1d4ed8;
  }

  .ghost {
    background: transparent;
    color: #364152;
    border: 1px solid #d2d6dc;
    border-radius: 0.65rem;
    padding: 0.65rem 1.1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease-in-out, color 0.2s ease-in-out;
  }

  .ghost:hover,
  .ghost:focus-visible {
    background: #f1f5f9;
    color: #1f2937;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 1.75rem;
  }

  .outline {
    background: #fff;
    border-radius: 1rem;
    padding: 1.5rem;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .outline-header h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .muted {
    color: #667085;
    font-size: 0.95rem;
    margin: 0.25rem 0 0;
  }

  .module-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .module {
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    background: #f9fafb;
    overflow: hidden;
  }

  .module.active {
    border-color: #2563eb;
    background: #eef2ff;
  }

  .module header {
    background: rgba(37, 99, 235, 0.08);
    padding: 0.75rem 1rem;
  }

  .module.active header {
    background: rgba(37, 99, 235, 0.16);
  }

  .module-trigger {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }

  .module-index {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #475467;
  }

  .module-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: #1d2939;
  }

  .lessons {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .lessons ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .lessons button {
    width: 100%;
    border: none;
    background: #fff;
    border-radius: 0.65rem;
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    cursor: pointer;
    color: #334155;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.4);
    transition: box-shadow 0.2s ease-in-out, background 0.2s ease-in-out;
  }

  .lessons button.active {
    background: rgba(37, 99, 235, 0.12);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.4);
    color: #1e3a8a;
  }

  .lesson-index {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
  }

  .lesson-title {
    font-size: 0.95rem;
    font-weight: 500;
  }

  .lesson-form,
  .module-form {
    display: flex;
    gap: 0.5rem;
  }

  .lesson-form input,
  .module-form input,
  .modal-body input,
  .modal-body select {
    flex: 1;
    border-radius: 0.65rem;
    border: 1px solid #d2d6dc;
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  }

  .lesson-form input:focus,
  .module-form input:focus,
  .modal-body input:focus,
  .modal-body select:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
  }

  .lesson-form button,
  .module-form button {
    border-radius: 0.65rem;
    border: none;
    background: #475467;
    color: #fff;
    padding: 0.6rem 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease-in-out;
  }

  .lesson-form button:hover,
  .module-form button:hover,
  .lesson-form button:focus-visible,
  .module-form button:focus-visible {
    background: #1f2937;
  }

  .empty-state,
  .detail-card {
    background: #fff;
    border-radius: 1rem;
    padding: 2rem;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .details {
    display: flex;
    align-items: stretch;
  }

  .details .detail-card {
    width: 100%;
  }

  .empty {
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .modal-root {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 50;
  }

  .modal-scrim {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
  }

  .modal {
    position: relative;
    width: min(420px, calc(100% - 2rem));
    background: #fff;
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(30, 41, 59, 0.35);
    overflow: hidden;
    z-index: 51;
  }

  .modal-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.75rem;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-body label {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .alert {
    margin: 0;
    padding: 0.75rem 1rem;
    background: #fef3c7;
    color: #92400e;
    border-radius: 0.75rem;
    font-size: 0.9rem;
  }

  .field-error {
    margin: -0.35rem 0 0;
    font-size: 0.8rem;
    color: #b91c1c;
  }

  .form-error {
    margin: 0.5rem 0 0;
    color: #b91c1c;
    font-size: 0.9rem;
  }

  input.error,
  select.error {
    border-color: #f87171;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 960px) {
    .workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 600px) {
    .header-actions {
      width: 100%;
      justify-content: space-between;
    }

    .workspace {
      gap: 1rem;
    }

    .page-header h1 {
      font-size: 1.8rem;
    }

    .outline {
      padding: 1.25rem;
    }

    .modal {
      width: min(360px, calc(100% - 2rem));
    }
  }
</style>
