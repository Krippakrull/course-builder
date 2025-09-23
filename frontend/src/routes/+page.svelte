<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { courseStore } from '$lib';
  import type { PageData } from './$types';
  import type {
    Block,
    BlockType,
    HeadingBlockContent,
    ListBlockContent,
    Course,
    CourseStoreState,
    CourseSummary,
    Lesson,
    TextBlockContent,
    Module,
  } from '$lib';

  const { data } = $props<{ data: PageData }>();
  const apiBase = '/api';
  const LAST_COURSE_STORAGE_KEY = 'course-builder:lastCourseId';

  type CreateCourseForm = {
    title: string;
    language: string;
  };

  type CreateCourseErrors = { title?: string; language?: string; general?: string };
  type LessonErrorMap = Record<string, string | undefined>;
  type PendingMap = Record<string, boolean | undefined>;
  type LessonSavingMap = Record<string, number | undefined>;
  type BlockErrorMap = Record<string, string | undefined>;
  type BlockFlagMap = Record<string, boolean | undefined>;

  const blockSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const blockSuccessTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const languageOptions = [
    { value: 'sv', label: 'Svenska' },
    { value: 'en', label: 'English' },
  ];

  let backendStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let backendMessage = $state('');

  let showCreateCourseDialog = $state(false);
  let createCourseForm = $state<CreateCourseForm>({ title: '', language: 'sv' });
  let createCourseErrors = $state<CreateCourseErrors>({});
  let isCreatingCourse = $state(false);

  let newModuleTitle = $state('');
  let lessonDrafts = $state<Record<string, string>>({});
  let lessonErrors = $state<LessonErrorMap>({});
  let lessonPending = $state<PendingMap>({});

  let courseState = $state<CourseStoreState>(get(courseStore));
  let currentCourse = $state<Course | null>(null);
  let selectedModule = $state<Module | null>(null);
  let selectedLesson = $state<Lesson | null>(null);

  let moduleError = $state<string | null>(null);
  let isCreatingModule = $state(false);
  let isLoadingCourse = $state(false);
  let initialLoadError = $state<string | null>(null);
  let moduleOrderSavingCount = $state(0);
  let moduleOrderSaving = $state(false);
  let moduleDeletePending = $state<PendingMap>({});
  let lessonDeletePending = $state<PendingMap>({});
  let lessonOrderSaving = $state<LessonSavingMap>({});
  let draggingModuleId = $state<string | null>(null);
  let moduleDragOverId = $state<string | null>(null);
  let draggingLesson = $state<{ moduleId: string; lessonId: string } | null>(null);
  let lessonDragOver = $state<{ moduleId: string; lessonId: string | null } | null>(null);
  let blockDirty = $state<BlockFlagMap>({});
  let blockSaving = $state<BlockFlagMap>({});
  let blockErrors = $state<BlockErrorMap>({});
  let blockSuccess = $state<BlockFlagMap>({});

  let lastSelectedLessonId: string | null = null;

  $effect(() => {
    currentCourse = courseState.course;
    const moduleId = courseState.selectedModuleId;
    const resolvedModule =
      moduleId && currentCourse
        ? currentCourse.modules.find((item) => item.moduleId === moduleId) ?? null
        : null;
    selectedModule = resolvedModule;

    const lessonId = courseState.selectedLessonId;
    selectedLesson =
      lessonId && resolvedModule
        ? resolvedModule.lessons.find((lesson) => lesson.lessonId === lessonId) ?? null
        : null;
  });

  $effect(() => {
    moduleOrderSaving = moduleOrderSavingCount > 0;
  });

  $effect(() => {
    const currentLessonId = courseState.selectedLessonId ?? null;

    if (lastSelectedLessonId && lastSelectedLessonId !== currentLessonId) {
      const pendingTimer = blockSaveTimers.has(lastSelectedLessonId);
      const isDirty = Boolean(blockDirty[lastSelectedLessonId]);

      if (pendingTimer || isDirty) {
        void saveLessonBlocks(lastSelectedLessonId);
      }
    }

    lastSelectedLessonId = currentLessonId;
  });

  onMount(() => {
    let active = true;
    const unsubscribe = courseStore.subscribe((value) => {
      if (active) {
        courseState = value;
      }
    });

    (async () => {
      if (!data.databaseConfigured) {
        backendStatus = 'error';
        backendMessage = 'Databasen är inte konfigurerad på servern.';
        return;
      }

      backendStatus = 'loading';

      try {
        const response = await fetch(`${apiBase}/health`);
        const data = (await response.json().catch(() => null)) as
          | { status?: string; database?: string; timestamp?: string }
          | null;

        if (!response.ok) {
          throw new Error(`Backend svarade med status ${response.status}`);
        }

        if (!active) {
          return;
        }

        backendStatus = 'success';
        backendMessage =
          data?.database === 'connected'
            ? 'Backend ansluten och databas kontaktbar.'
            : 'Backend svarade.';

        const storedCourseId = getStoredCourseId();
        if (storedCourseId) {
          await loadCourseFromBackend(storedCourseId);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        backendStatus = 'error';
        backendMessage = (error as Error).message;
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  });

  async function loadCourseFromBackend(courseId: string) {
    isLoadingCourse = true;
    initialLoadError = null;

    try {
      const response = await fetch(`${apiBase}/courses/${courseId}`);
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        if (response.status === 404) {
          clearStoredCourseId();
          courseStore.reset();
        }

        const message =
          payload && typeof payload === 'object' && 'message' in payload
            ? String((payload as { message?: unknown }).message ?? 'Kunde inte ladda kursen.')
            : `Kunde inte ladda kursen (status ${response.status}).`;
        throw new Error(message);
      }

      const course = parseCourseWithStructure(payload);
      clearAllBlockTimers();
      blockDirty = {};
      blockSaving = {};
      blockErrors = {};
      blockSuccess = {};
      lastSelectedLessonId = null;
      courseStore.setCourse(course);
      persistLastCourseId(course.courseId);
      newModuleTitle = '';
      lessonDrafts = {};
      lessonErrors = {};
      lessonPending = {};
      moduleError = null;
      initialLoadError = null;
      moduleOrderSavingCount = 0;
      moduleDeletePending = {};
      lessonDeletePending = {};
      lessonOrderSaving = {};
      draggingModuleId = null;
      moduleDragOverId = null;
      draggingLesson = null;
      lessonDragOver = null;
    } catch (error) {
      initialLoadError = (error as Error).message;
      return false;
    } finally {
      isLoadingCourse = false;
    }

    return true;
  }

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
    const errors: CreateCourseErrors = {};

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

  function parseCourseWithStructure(payload: unknown): Course {
    const summary = parseCoursePayload(payload);
    const modulesValue = payload && typeof payload === 'object' ? (payload as { modules?: unknown }).modules : undefined;
    const modules = Array.isArray(modulesValue)
      ? modulesValue.map((module, index) => parseModulePayload(module, `modul ${index + 1}`))
      : [];

    return { ...summary, modules };
  }

  function getStoredCourseId(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const value = window.localStorage.getItem(LAST_COURSE_STORAGE_KEY);
      return value && value.trim().length > 0 ? value : null;
    } catch (error) {
      console.warn('Kunde inte läsa sparad kursreferens', error);
      return null;
    }
  }

  function persistLastCourseId(courseId: string) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(LAST_COURSE_STORAGE_KEY, courseId);
    } catch (error) {
      console.warn('Kunde inte spara kursreferens', error);
    }
  }

  function clearStoredCourseId() {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(LAST_COURSE_STORAGE_KEY);
    } catch (error) {
      console.warn('Kunde inte rensa kursreferens', error);
    }
  }

  function extractErrorMessage(payload: unknown, fallback: string) {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }

    return fallback;
  }

  function assertObject(payload: unknown, context: string) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Oväntat svar för ${context}.`);
    }
  }

  function assertStringFields(obj: Record<string, unknown>, fields: string[], context: string) {
    for (const field of fields) {
      if (typeof obj[field] !== 'string') {
        throw new Error(`Svar saknar förväntade fält '${field}' för ${context}.`);
      }
    }
  }

  function parseNumericField(value: unknown, fieldName: string, context: string): number {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Fältet '${fieldName}' för ${context} är ogiltig.`);
    }
    return num;
  }

  function parseBlockContent(
    type: BlockType,
    content: unknown,
    context: string
  ): Block['content'] {
    if (!content || typeof content !== 'object') {
      throw new Error(`Blockinnehåll för ${context} saknas eller är ogiltigt.`);
    }

    if (type === 'text') {
      const textValue = (content as { text?: unknown }).text;
      return { text: typeof textValue === 'string' ? textValue : '' };
    }

    if (type === 'heading') {
      const textValue = (content as { text?: unknown }).text;
      const levelValue = (content as { level?: unknown }).level;
      const parsedLevel = Number(levelValue);
      const level = Number.isInteger(parsedLevel) ? Math.min(Math.max(parsedLevel, 1), 6) : 2;
      return {
        text: typeof textValue === 'string' ? textValue : '',
        level,
      };
    }

    const listContent = content as { items?: unknown; style?: unknown };
    const items = Array.isArray(listContent.items)
      ? listContent.items.map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      : [];
    const style = listContent.style === 'numbered' ? 'numbered' : 'bulleted';
    return { items, style };
  }

  function parseBlockPayload(payload: unknown, context = 'block'): Block {
    assertObject(payload, context);
    const { blockId, type, content, position, version, createdAt, updatedAt } = payload as Record<
      string,
      unknown
    >;

    assertStringFields(payload as Record<string, unknown>, ['blockId', 'type', 'createdAt', 'updatedAt'], context);

    if (!['text', 'heading', 'list'].includes(String(type))) {
      throw new Error(`Block-typen för ${context} är ogiltig.`);
    }

    const parsedContent = parseBlockContent(type as BlockType, content, context);
    const numericPosition = parseNumericField(position, 'position', context);
    const numericVersion = parseNumericField(version, 'version', context);

    return {
      blockId: blockId as string,
      type: type as BlockType,
      content: parsedContent,
      position: numericPosition,
      version: numericVersion,
      createdAt: createdAt as string,
      updatedAt: updatedAt as string,
    };
  }

  function parseLessonPayload(payload: unknown, context = 'lesson'): Lesson {
    assertObject(payload, context);
    const { lessonId, title, position, blocks } = payload as Record<string, unknown>;
    assertStringFields(payload as Record<string, unknown>, ['lessonId', 'title'], context);
    const numericPosition = parseNumericField(position, 'position', context);
    const parsedBlocks = Array.isArray(blocks)
      ? blocks.map((block, index) => parseBlockPayload(block, `${context} block ${index + 1}`))
      : [];
    return {
      lessonId: lessonId as string,
      title: title as string,
      position: numericPosition,
      blocks: parsedBlocks,
    };
  }

  function isListContent(content: Block['content']): content is ListBlockContent {
    return Array.isArray((content as { items?: unknown }).items);
  }

  function isHeadingContent(content: Block['content']): content is HeadingBlockContent {
    return typeof (content as { level?: unknown }).level !== 'undefined';
  }

  function isTextContent(content: Block['content']): content is TextBlockContent {
    return !isListContent(content) && !isHeadingContent(content);
  }

  function parseModulePayload(payload: unknown, context = 'modul'): Module {
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

  function clearBlockTimer(lessonId: string) {
    const existing = blockSaveTimers.get(lessonId);
    if (existing) {
      clearTimeout(existing);
      blockSaveTimers.delete(lessonId);
    }
  }

  function clearBlockSuccessTimer(lessonId: string) {
    const existing = blockSuccessTimers.get(lessonId);
    if (existing) {
      clearTimeout(existing);
      blockSuccessTimers.delete(lessonId);
    }
  }

  function clearAllBlockTimers() {
    for (const timer of blockSaveTimers.values()) {
      clearTimeout(timer);
    }
    blockSaveTimers.clear();

    for (const timer of blockSuccessTimers.values()) {
      clearTimeout(timer);
    }
    blockSuccessTimers.clear();
  }

  function setBlockDirtyFlag(lessonId: string, value: boolean) {
    if (value) {
      blockDirty = { ...blockDirty, [lessonId]: true };
    } else {
      const { [lessonId]: _removed, ...rest } = blockDirty;
      blockDirty = rest;
    }
  }

  function setBlockSavingFlag(lessonId: string, value: boolean) {
    if (value) {
      blockSaving = { ...blockSaving, [lessonId]: true };
    } else {
      const { [lessonId]: _removed, ...rest } = blockSaving;
      blockSaving = rest;
    }
  }

  function setBlockError(lessonId: string, message: string | null) {
    if (message && message.trim().length > 0) {
      blockErrors = { ...blockErrors, [lessonId]: message };
    } else {
      const { [lessonId]: _removed, ...rest } = blockErrors;
      blockErrors = rest;
    }
  }

  function setBlockSuccessFlag(lessonId: string, value: boolean) {
    clearBlockSuccessTimer(lessonId);

    if (value) {
      blockSuccess = { ...blockSuccess, [lessonId]: true };
      const timer = setTimeout(() => {
        const { [lessonId]: _removed, ...rest } = blockSuccess;
        blockSuccess = rest;
        blockSuccessTimers.delete(lessonId);
      }, 2000);
      blockSuccessTimers.set(lessonId, timer);
    } else {
      const { [lessonId]: _removed, ...rest } = blockSuccess;
      blockSuccess = rest;
    }
  }

  function getLessonById(lessonId: string) {
    if (!courseState.course) {
      return null;
    }

    for (const module of courseState.course.modules) {
      const lesson = module.lessons.find((item) => item.lessonId === lessonId);
      if (lesson) {
        return { module, lesson };
      }
    }

    return null;
  }

  function updateBlocksForLesson(
    lessonId: string,
    updater: (blocks: Block[]) => Block[]
  ) {
    const resolved = getLessonById(lessonId);
    if (!resolved) {
      return false;
    }

    const currentBlocks = resolved.lesson.blocks ?? [];
    const updatedBlocks = updater(currentBlocks);

    if (updatedBlocks === currentBlocks) {
      return false;
    }

    courseStore.setLessonBlocks(lessonId, updatedBlocks);
    setBlockSuccessFlag(lessonId, false);
    return true;
  }

  function generateBlockId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `block-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createDefaultContent(type: BlockType): Block['content'] {
    if (type === 'heading') {
      return { text: '', level: 2 } satisfies HeadingBlockContent;
    }

    if (type === 'list') {
      return { items: [''], style: 'bulleted' } satisfies ListBlockContent;
    }

    return { text: '' } satisfies TextBlockContent;
  }

  function getBlockTypeLabel(type: BlockType) {
    switch (type) {
      case 'heading':
        return 'Rubrik';
      case 'list':
        return 'Lista';
      default:
        return 'Text';
    }
  }

  function serializeBlockForRequest(block: Block, index: number) {
    if (isListContent(block.content)) {
      const items = block.content.items.map((item) => item.replace(/\r/g, ''));
      return {
        blockId: block.blockId,
        type: block.type,
        position: index,
        content: {
          items,
          style: block.content.style === 'numbered' ? 'numbered' : 'bulleted',
        },
      };
    }

    if (isHeadingContent(block.content)) {
      const level = Math.min(Math.max(Math.round(block.content.level ?? 2), 1), 6);
      return {
        blockId: block.blockId,
        type: block.type,
        position: index,
        content: {
          text: block.content.text ?? '',
          level,
        },
      };
    }

    const textContent = isTextContent(block.content) ? block.content.text : '';
    return {
      blockId: block.blockId,
      type: block.type,
      position: index,
      content: {
        text: textContent ?? '',
      },
    };
  }

  function scheduleLessonBlocksSave(lessonId: string, delay = 900) {
    if (!lessonId) {
      return;
    }

    clearBlockTimer(lessonId);
    setBlockDirtyFlag(lessonId, true);
    setBlockError(lessonId, null);

    if (delay <= 0) {
      void saveLessonBlocks(lessonId);
      return;
    }

    const timer = setTimeout(() => {
      void saveLessonBlocks(lessonId);
    }, delay);
    blockSaveTimers.set(lessonId, timer);
  }

  function triggerImmediateBlockSave(lessonId: string) {
    scheduleLessonBlocksSave(lessonId, 0);
  }

  async function saveLessonBlocks(lessonId: string) {
    if (!lessonId) {
      return;
    }

    clearBlockTimer(lessonId);

    const resolved = getLessonById(lessonId);
    if (!resolved) {
      setBlockDirtyFlag(lessonId, false);
      setBlockSavingFlag(lessonId, false);
      setBlockError(lessonId, null);
      setBlockSuccessFlag(lessonId, false);
      return;
    }

    const lessonBlocks = resolved.lesson.blocks ?? [];
    const payloadBlocks = lessonBlocks.map((block, index) => serializeBlockForRequest(block, index));

    setBlockSavingFlag(lessonId, true);
    setBlockError(lessonId, null);

    try {
      const response = await fetch(`${apiBase}/lessons/${lessonId}/blocks`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blocks: payloadBlocks }),
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message = extractErrorMessage(
          payload,
          `Kunde inte spara blocken (status ${response.status}).`
        );
        throw new Error(message);
      }

      const blocksValue =
        payload && typeof payload === 'object' ? (payload as { blocks?: unknown }).blocks : undefined;

      const parsedBlocks = Array.isArray(blocksValue)
        ? blocksValue.map((block, index) => parseBlockPayload(block, `sparat block ${index + 1}`))
        : [];

      courseStore.setLessonBlocks(lessonId, parsedBlocks);
      setBlockDirtyFlag(lessonId, false);
      setBlockError(lessonId, null);
      setBlockSuccessFlag(lessonId, true);
    } catch (error) {
      console.error('Failed to save lesson blocks', error);
      setBlockError(lessonId, (error as Error).message);
      setBlockDirtyFlag(lessonId, true);
    } finally {
      setBlockSavingFlag(lessonId, false);
    }
  }

  function handleAddBlock(type: BlockType) {
    if (!selectedLesson) {
      return;
    }

    const lessonId = selectedLesson.lessonId;

    const newBlock: Block = {
      blockId: generateBlockId(),
      type,
      content: createDefaultContent(type),
      position: selectedLesson.blocks.length,
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const changed = updateBlocksForLesson(lessonId, (blocks) => [...blocks, newBlock]);
    if (changed) {
      scheduleLessonBlocksSave(lessonId);
    }
  }

  function mutateBlock(
    lessonId: string,
    blockId: string,
    mutator: (block: Block) => Block | null
  ) {
    const changed = updateBlocksForLesson(lessonId, (blocks) => {
      const updated = [] as Block[];
      let changed = false;

      for (const block of blocks) {
        if (block.blockId !== blockId) {
          updated.push(block);
          continue;
        }

        const result = mutator(block);
        if (result) {
          updated.push(result);
        }
        changed = true;
      }

      return changed ? updated : blocks;
    });
    return changed;
  }

  function handleDeleteBlock(lessonId: string, blockId: string) {
    const changed = mutateBlock(lessonId, blockId, () => null);
    if (changed) {
      scheduleLessonBlocksSave(lessonId, 200);
    }
  }

  function handleBlockTextChange(lessonId: string, blockId: string, value: string) {
    const changed = mutateBlock(lessonId, blockId, (block) => {
      if (isListContent(block.content)) {
        return block;
      }

      const nextContent = isHeadingContent(block.content)
        ? { ...block.content, text: value }
        : { text: value };

      return {
        ...block,
        content: nextContent,
        updatedAt: nowIso(),
      };
    });

    if (changed) {
      scheduleLessonBlocksSave(lessonId);
    }
  }

  function handleHeadingLevelChange(lessonId: string, blockId: string, level: number) {
    const normalized = Math.min(Math.max(Math.round(level), 1), 6);

    const changed = mutateBlock(lessonId, blockId, (block) => {
      if (!isHeadingContent(block.content)) {
        return block;
      }

      return {
        ...block,
        content: { ...block.content, level: normalized },
        updatedAt: nowIso(),
      };
    });

    if (changed) {
      scheduleLessonBlocksSave(lessonId);
    }
  }

  function handleListItemsChange(lessonId: string, blockId: string, value: string) {
    const items = value.replace(/\r/g, '').split('\n');

    const changed = mutateBlock(lessonId, blockId, (block) => {
      if (!isListContent(block.content)) {
        return block;
      }

      return {
        ...block,
        content: { ...block.content, items },
        updatedAt: nowIso(),
      };
    });

    if (changed) {
      scheduleLessonBlocksSave(lessonId);
    }
  }

  function handleListStyleChange(
    lessonId: string,
    blockId: string,
    style: 'bulleted' | 'numbered'
  ) {
    const changed = mutateBlock(lessonId, blockId, (block) => {
      if (!isListContent(block.content)) {
        return block;
      }

      return {
        ...block,
        content: { ...block.content, style },
        updatedAt: nowIso(),
      };
    });

    if (changed) {
      scheduleLessonBlocksSave(lessonId);
    }
  }

  async function handleCreateCourseSubmit(event: SubmitEvent) {
    event.preventDefault();

    if (!validateCreateCourseForm()) {
      return;
    }

    isCreatingCourse = true;
    createCourseErrors = {};

    try {
      const response = await fetch(`${apiBase}/courses`, {
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
      courseStore.setCourse({ ...course, modules: [] as Module[] });
      persistLastCourseId(course.courseId);
      initialLoadError = null;
      showCreateCourseDialog = false;
      newModuleTitle = '';
      lessonDrafts = {};
      lessonErrors = {};
      lessonPending = {};
      moduleError = null;
      clearAllBlockTimers();
      blockDirty = {};
      blockSaving = {};
      blockErrors = {};
      blockSuccess = {};
      lastSelectedLessonId = null;
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
        const response = await fetch(`${apiBase}/courses/${currentCourse.courseId}/modules`, {
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
        const response = await fetch(`${apiBase}/modules/${moduleId}/lessons`, {
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

  async function persistModuleOrder(moduleIds: string[]) {
    if (!currentCourse) {
      return;
    }

    moduleOrderSavingCount += 1;
    moduleError = null;

    try {
      const response = await fetch(`${apiBase}/courses/${currentCourse.courseId}/modules/order`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ moduleIds }),
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message = extractErrorMessage(
          payload,
          `Kunde inte spara modulordning (status ${response.status}).`
        );
        throw new Error(message);
      }
    } catch (error) {
      moduleError = (error as Error).message;
      if (currentCourse) {
        await loadCourseFromBackend(currentCourse.courseId);
      }
    } finally {
      moduleOrderSavingCount = Math.max(0, moduleOrderSavingCount - 1);
    }
  }

  function handleModuleDragStart(event: DragEvent, moduleId: string) {
    draggingModuleId = moduleId;
    moduleDragOverId = moduleId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', moduleId);
    }
  }

  function handleModuleDragOver(event: DragEvent, moduleId: string) {
    if (!draggingModuleId || draggingModuleId === moduleId) {
      return;
    }

    event.preventDefault();
    moduleDragOverId = moduleId;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleModuleDropZoneDragOver(event: DragEvent) {
    if (!draggingModuleId) {
      return;
    }

    event.preventDefault();
    moduleDragOverId = null;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleModuleDrop(event: DragEvent, targetModuleId: string | null) {
    if (!draggingModuleId || !currentCourse) {
      return;
    }

    event.preventDefault();

    const modules = currentCourse.modules;
    const fromIndex = modules.findIndex((module) => module.moduleId === draggingModuleId);
    if (fromIndex === -1) {
      draggingModuleId = null;
      moduleDragOverId = null;
      return;
    }

    const newOrder = [...modules];
    const [movedModule] = newOrder.splice(fromIndex, 1);
    const targetIndex =
      targetModuleId === null
        ? newOrder.length
        : newOrder.findIndex((module) => module.moduleId === targetModuleId);

    if (targetIndex < 0) {
      newOrder.push(movedModule);
    } else {
      newOrder.splice(targetIndex, 0, movedModule);
    }

    const moduleIds = newOrder.map((module) => module.moduleId);
    courseStore.reorderModules(moduleIds);
    void persistModuleOrder(moduleIds);

    draggingModuleId = null;
    moduleDragOverId = null;
  }

  function handleModuleDragEnd() {
    draggingModuleId = null;
    moduleDragOverId = null;
  }

  async function handleDeleteModule(moduleId: string) {
    if (!currentCourse || moduleDeletePending[moduleId]) {
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Vill du ta bort modulen? Alla lektioner i modulen tas också bort.'
      );
      if (!confirmed) {
        return;
      }
    }

    moduleDeletePending = { ...moduleDeletePending, [moduleId]: true };
    moduleError = null;

    try {
      const response = await fetch(`${apiBase}/modules/${moduleId}`, {
        method: 'DELETE',
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message = extractErrorMessage(
          payload,
          `Kunde inte ta bort modulen (status ${response.status}).`
        );
        throw new Error(message);
      }

      courseStore.removeModule(moduleId);
    } catch (error) {
      moduleError = (error as Error).message;
      if (currentCourse) {
        await loadCourseFromBackend(currentCourse.courseId);
      }
    } finally {
      const { [moduleId]: _removed, ...rest } = moduleDeletePending;
      moduleDeletePending = rest;
    }
  }

  function handleLessonDragStart(event: DragEvent, moduleId: string, lessonId: string) {
    draggingLesson = { moduleId, lessonId };
    lessonDragOver = { moduleId, lessonId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', lessonId);
    }
  }

  function handleLessonDragOver(event: DragEvent, moduleId: string, lessonId: string) {
    if (!draggingLesson || draggingLesson.moduleId !== moduleId || draggingLesson.lessonId === lessonId) {
      return;
    }

    event.preventDefault();
    lessonDragOver = { moduleId, lessonId };
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleLessonDropZoneDragOver(event: DragEvent, moduleId: string) {
    if (!draggingLesson || draggingLesson.moduleId !== moduleId) {
      return;
    }

    event.preventDefault();
    lessonDragOver = { moduleId, lessonId: null };
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleLessonDrop(event: DragEvent, moduleId: string, targetLessonId: string | null) {
    if (!draggingLesson || draggingLesson.moduleId !== moduleId || !currentCourse) {
      return;
    }

    if (targetLessonId === draggingLesson.lessonId) {
      draggingLesson = null;
      lessonDragOver = null;
      return;
    }

    event.preventDefault();

    const module = currentCourse.modules.find((item) => item.moduleId === moduleId);
    if (!module) {
      draggingLesson = null;
      lessonDragOver = null;
      return;
    }

    const lessons = module.lessons ?? [];
    const fromIndex = lessons.findIndex((lesson) => lesson.lessonId === draggingLesson?.lessonId);
    if (fromIndex === -1) {
      draggingLesson = null;
      lessonDragOver = null;
      return;
    }

    const newOrder = [...lessons];
    const [movedLesson] = newOrder.splice(fromIndex, 1);
    const targetIndex =
      targetLessonId === null
        ? newOrder.length
        : newOrder.findIndex((lesson) => lesson.lessonId === targetLessonId);

    if (targetIndex < 0) {
      newOrder.push(movedLesson);
    } else {
      newOrder.splice(targetIndex, 0, movedLesson);
    }

    const lessonIds = newOrder.map((lesson) => lesson.lessonId);
    courseStore.reorderLessons(moduleId, lessonIds);
    void persistLessonOrder(moduleId, lessonIds);

    draggingLesson = null;
    lessonDragOver = null;
  }

  function handleLessonDragEnd() {
    draggingLesson = null;
    lessonDragOver = null;
  }

  async function handleDeleteLesson(moduleId: string, lessonId: string) {
    if (lessonDeletePending[lessonId]) {
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Vill du ta bort lektionen?');
      if (!confirmed) {
        return;
      }
    }

    lessonDeletePending = { ...lessonDeletePending, [lessonId]: true };
    lessonErrors = { ...lessonErrors, [moduleId]: undefined };

    try {
      const response = await fetch(`${apiBase}/lessons/${lessonId}`, {
        method: 'DELETE',
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message = extractErrorMessage(
          payload,
          `Kunde inte ta bort lektionen (status ${response.status}).`
        );
        throw new Error(message);
      }

      courseStore.removeLesson(moduleId, lessonId);
      lessonErrors = { ...lessonErrors, [moduleId]: undefined };
      clearBlockTimer(lessonId);
      clearBlockSuccessTimer(lessonId);
      setBlockDirtyFlag(lessonId, false);
      setBlockSavingFlag(lessonId, false);
      setBlockError(lessonId, null);
      setBlockSuccessFlag(lessonId, false);
    } catch (error) {
      lessonErrors = { ...lessonErrors, [moduleId]: (error as Error).message };
      if (currentCourse) {
        await loadCourseFromBackend(currentCourse.courseId);
      }
    } finally {
      const { [lessonId]: _removed, ...rest } = lessonDeletePending;
      lessonDeletePending = rest;
    }
  }

  function handleModuleDraftChange(moduleId: string, value: string) {
    lessonDrafts = { ...lessonDrafts, [moduleId]: value };
  }

  async function persistLessonOrder(moduleId: string, lessonIds: string[]) {
    if (!currentCourse) {
      return;
    }

    const currentCount = lessonOrderSaving[moduleId] ?? 0;
    lessonOrderSaving = { ...lessonOrderSaving, [moduleId]: currentCount + 1 };
    lessonErrors = { ...lessonErrors, [moduleId]: undefined };

    try {
      const response = await fetch(`${apiBase}/modules/${moduleId}/lessons/order`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lessonIds }),
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message = extractErrorMessage(
          payload,
          `Kunde inte spara lektionsordning (status ${response.status}).`
        );
        throw new Error(message);
      }

      lessonErrors = { ...lessonErrors, [moduleId]: undefined };
    } catch (error) {
      lessonErrors = { ...lessonErrors, [moduleId]: (error as Error).message };
      if (currentCourse) {
        await loadCourseFromBackend(currentCourse.courseId);
      }
    } finally {
      const currentValue = lessonOrderSaving[moduleId] ?? 1;
      const nextValue = Math.max(0, currentValue - 1);
      if (nextValue > 0) {
        lessonOrderSaving = { ...lessonOrderSaving, [moduleId]: nextValue };
      } else {
        const { [moduleId]: _removed, ...rest } = lessonOrderSaving;
        lessonOrderSaving = rest;
      }
    }
  }
</script>


<svelte:head>
  <title>Course Builder</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  <header class="page-header">
    <div>
      <h1>Course Builder</h1>
      <p class="lead">Skapa kursstrukturer med moduler, lektioner och block-baserat innehåll.</p>
    </div>

    <div class="header-actions">
      <button class="primary" type="button" onclick={openCreateCourseDialog}>
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

  {#if isLoadingCourse}
    <p class="status-message">Laddar kursstruktur…</p>
  {/if}

  {#if initialLoadError}
    <p class="alert">{initialLoadError}</p>
  {/if}

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
            <section
              class="module"
              class:active={module.moduleId === courseState.selectedModuleId}
              class:dragging={draggingModuleId === module.moduleId}
              class:drop-target={
                moduleDragOverId === module.moduleId && draggingModuleId !== module.moduleId
              }
              draggable="true"
              ondragstart={(event) => handleModuleDragStart(event, module.moduleId)}
              ondragover={(event) => handleModuleDragOver(event, module.moduleId)}
              ondrop={(event) => handleModuleDrop(event, module.moduleId)}
              ondragend={handleModuleDragEnd}
              role="listitem"
            >
              <header>
                <div class="module-header">
                  <button
                    type="button"
                    class="module-trigger"
                    onclick={() => courseStore.selectModule(module.moduleId)}
                  >
                    <span class="drag-hint" aria-hidden="true">↕︎</span>
                    <span class="module-trigger-text">
                      <span class="module-index">Modul {index + 1}</span>
                      <span class="module-title">{module.title}</span>
                    </span>
                  </button>
                  <div class="module-actions">
                    <button
                      type="button"
                      class="icon-button danger"
                      onclick={(event) => {
                        event.stopPropagation();
                        void handleDeleteModule(module.moduleId);
                      }}
                      disabled={Boolean(moduleDeletePending[module.moduleId])}
                      aria-label={`Ta bort ${module.title}`}
                    >
                      {moduleDeletePending[module.moduleId] ? 'Tar bort…' : 'Ta bort'}
                    </button>
                  </div>
                </div>
              </header>

              <div class="lessons">
                {#if module.lessons.length === 0}
                  <p class="empty">Inga lektioner ännu.</p>
                {:else}
                  <ul>
                    {#each module.lessons as lesson, lessonIndex}
                      <li
                        class="lesson-item"
                        class:dragging={draggingLesson?.lessonId === lesson.lessonId}
                        class:drop-target={
                          lessonDragOver?.moduleId === module.moduleId &&
                          lessonDragOver?.lessonId === lesson.lessonId &&
                          draggingLesson?.lessonId !== lesson.lessonId
                        }
                        draggable="true"
                        ondragstart={(event) =>
                          handleLessonDragStart(event, module.moduleId, lesson.lessonId)}
                        ondragover={(event) =>
                          handleLessonDragOver(event, module.moduleId, lesson.lessonId)}
                        ondrop={(event) => handleLessonDrop(event, module.moduleId, lesson.lessonId)}
                        ondragend={handleLessonDragEnd}
                      >
                        <div class="lesson-row">
                          <button
                            type="button"
                            class="lesson-select"
                            class:active={
                              lesson.lessonId === courseState.selectedLessonId &&
                              module.moduleId === courseState.selectedModuleId
                            }
                            onclick={() => courseStore.selectLesson(module.moduleId, lesson.lessonId)}
                          >
                            <span class="lesson-index">Lektion {lessonIndex + 1}</span>
                            <span class="lesson-title">{lesson.title}</span>
                          </button>
                          <button
                            type="button"
                            class="icon-button danger"
                            onclick={(event) => {
                              event.stopPropagation();
                              void handleDeleteLesson(module.moduleId, lesson.lessonId);
                            }}
                            disabled={Boolean(lessonDeletePending[lesson.lessonId])}
                            aria-label={`Ta bort ${lesson.title}`}
                          >
                            {lessonDeletePending[lesson.lessonId] ? 'Tar bort…' : 'Ta bort'}
                          </button>
                        </div>
                      </li>
                    {/each}
                    {#if draggingLesson && draggingLesson.moduleId === module.moduleId}
                      <li
                        class="lesson-drop-zone"
                        ondragover={(event) => handleLessonDropZoneDragOver(event, module.moduleId)}
                        ondrop={(event) => handleLessonDrop(event, module.moduleId, null)}
                      >
                        Släpp här för att placera sist
                      </li>
                    {/if}
                  </ul>
                {/if}

                <form
                  class="lesson-form"
                  onsubmit={(event) => {
                    event.preventDefault();
                    handleAddLesson(module.moduleId);
                  }}
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
                    oninput={(event) =>
                      handleModuleDraftChange(module.moduleId, (event.target as HTMLInputElement).value)}
                    disabled={Boolean(lessonPending[module.moduleId])}
                  />
                  <button type="submit" disabled={Boolean(lessonPending[module.moduleId])}>
                    {lessonPending[module.moduleId] ? 'Sparar…' : 'Spara'}
                  </button>
                  {#if lessonErrors[module.moduleId]}
                    <p class="form-error">{lessonErrors[module.moduleId]}</p>
                  {/if}
                  {#if lessonOrderSaving[module.moduleId]}
                    <p class="inline-status">Sparar lektionsordning…</p>
                  {/if}
                </form>
              </div>
            </section>
          {/each}

          {#if draggingModuleId}
            <div
              class="module-drop-zone"
              ondragover={handleModuleDropZoneDragOver}
              ondrop={(event) => handleModuleDrop(event, null)}
              role="button"
              aria-label="Släpp för att placera modulen sist"
              tabindex="0"
            >
              Släpp här för att placera modulen sist
            </div>
          {/if}
        </div>

        {#if moduleOrderSaving}
          <p class="module-status">Sparar modulordning…</p>
        {/if}

        <form
          class="module-form"
          onsubmit={(event) => {
            event.preventDefault();
            handleAddModule();
          }}
        >
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
          <div class="detail-card lesson-detail">
            <header class="lesson-detail-header">
              <div>
                <h2>{selectedLesson.title}</h2>
                <p class="muted">
                  Tillhör modul: {selectedModule?.title ?? 'Okänd modul'} • Position: {selectedLesson.position + 1}
                </p>
              </div>
              <div class="lesson-status" data-state={
                blockSaving[selectedLesson.lessonId]
                  ? 'saving'
                  : blockErrors[selectedLesson.lessonId]
                    ? 'error'
                    : blockDirty[selectedLesson.lessonId]
                      ? 'dirty'
                      : blockSuccess[selectedLesson.lessonId]
                        ? 'success'
                        : 'idle'
              }>
                {#if blockSaving[selectedLesson.lessonId]}
                  <span>Sparar block…</span>
                {:else if blockErrors[selectedLesson.lessonId]}
                  <span>Fel: {blockErrors[selectedLesson.lessonId]}</span>
                {:else if blockDirty[selectedLesson.lessonId]}
                  <span>Ändringar väntar på sparning…</span>
                {:else if blockSuccess[selectedLesson.lessonId]}
                  <span>Alla block sparade.</span>
                {:else}
                  <span>Blocken är synkroniserade.</span>
                {/if}

                <button
                  type="button"
                  class="ghost small"
                  onclick={() => triggerImmediateBlockSave(selectedLesson!.lessonId)}
                  disabled={
                    Boolean(!blockDirty[selectedLesson.lessonId] && !blockSaving[selectedLesson.lessonId])
                  }
                >
                  Spara nu
                </button>
              </div>
            </header>

            <div class="block-toolbar">
              <span>Lägg till block:</span>
              <button type="button" class="ghost" onclick={() => handleAddBlock('text')}>
                Text
              </button>
              <button type="button" class="ghost" onclick={() => handleAddBlock('heading')}>
                Rubrik
              </button>
              <button type="button" class="ghost" onclick={() => handleAddBlock('list')}>
                Lista
              </button>
            </div>

            <div class="block-list" role="list">
              {#if selectedLesson.blocks.length === 0}
                <p class="empty">Inga block ännu. Lägg till ett block för att komma igång.</p>
              {/if}

              {#each selectedLesson.blocks as block, index (block.blockId)}
                <article class="block-card" data-type={block.type} role="listitem">
                  <header>
                    <div class="block-header">
                      <span class="block-label">Block {index + 1} · {getBlockTypeLabel(block.type)}</span>
                      <span class="block-meta">Version {block.version}</span>
                    </div>

                    <button
                      type="button"
                      class="ghost danger small"
                      onclick={() => handleDeleteBlock(selectedLesson!.lessonId, block.blockId)}
                    >
                      Ta bort
                    </button>
                  </header>

                  {#if block.type === 'text'}
                    <label class="sr-only" for={`block-${block.blockId}-text`}>
                      Textblock {index + 1}
                    </label>
                    <textarea
                      id={`block-${block.blockId}-text`}
                      rows="4"
                      value={isTextContent(block.content) ? block.content.text : ''}
                      oninput={(event) =>
                        handleBlockTextChange(
                          selectedLesson!.lessonId,
                          block.blockId,
                          event.currentTarget.value
                        )
                      }
                    ></textarea>
                  {:else if block.type === 'heading'}
                    <div class="heading-controls">
                      <label for={`block-${block.blockId}-level`}>Rubriknivå</label>
                      <select
                        id={`block-${block.blockId}-level`}
                        value={isHeadingContent(block.content) ? block.content.level : 2}
                        onchange={(event) =>
                          handleHeadingLevelChange(
                            selectedLesson!.lessonId,
                            block.blockId,
                            Number(event.currentTarget.value)
                          )
                        }
                      >
                        {#each Array.from({ length: 6 }) as _, levelIndex}
                          <option value={levelIndex + 1}>H{levelIndex + 1}</option>
                        {/each}
                      </select>
                    </div>

                    <label class="sr-only" for={`block-${block.blockId}-heading`}>
                      Rubriktext {index + 1}
                    </label>
                    <input
                      id={`block-${block.blockId}-heading`}
                      type="text"
                      value={isHeadingContent(block.content) ? block.content.text : ''}
                      oninput={(event) =>
                        handleBlockTextChange(
                          selectedLesson!.lessonId,
                          block.blockId,
                          event.currentTarget.value
                        )
                      }
                      placeholder="Rubriktext"
                    />
                  {:else}
                    <div class="heading-controls">
                      <label for={`block-${block.blockId}-style`}>Listtyp</label>
                      <select
                        id={`block-${block.blockId}-style`}
                        value={isListContent(block.content) ? block.content.style : 'bulleted'}
                        onchange={(event) =>
                          handleListStyleChange(
                            selectedLesson!.lessonId,
                            block.blockId,
                            event.currentTarget.value === 'numbered' ? 'numbered' : 'bulleted'
                          )
                        }
                      >
                        <option value="bulleted">Punktlista</option>
                        <option value="numbered">Nummerlista</option>
                      </select>
                    </div>

                    <label for={`block-${block.blockId}-items`}>
                      Listpunkter (en per rad)
                    </label>
                    <textarea
                      id={`block-${block.blockId}-items`}
                      rows="4"
                      value={isListContent(block.content) ? block.content.items.join('\n') : ''}
                      oninput={(event) =>
                        handleListItemsChange(
                          selectedLesson!.lessonId,
                          block.blockId,
                          event.currentTarget.value
                        )
                      }
                    ></textarea>
                  {/if}
                </article>
              {/each}
            </div>
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
      <button class="primary" type="button" onclick={openCreateCourseDialog}>
        Starta ny kurs
      </button>
    </section>
  {/if}
</main>

{#if showCreateCourseDialog}
  <div class="modal-root">
    <div class="modal-scrim" aria-hidden="true" onclick={closeCreateCourseDialog}></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-course-title">
      <form class="modal-content" onsubmit={handleCreateCourseSubmit}>
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
          <button type="button" class="ghost" onclick={closeCreateCourseDialog} disabled={isCreatingCourse}>
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

  .status-message {
    margin: -0.5rem 0 0;
    color: #475467;
    font-size: 0.95rem;
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

  .ghost.small {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    border-radius: 0.55rem;
  }

  .ghost.danger {
    border-color: #fee2e2;
    color: #b91c1c;
  }

  .ghost.danger:hover,
  .ghost.danger:focus-visible {
    background: #fee2e2;
    color: #7f1d1d;
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
    transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out, background 0.2s ease-in-out;
  }

  .module.dragging {
    opacity: 0.65;
  }

  .module.drop-target {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    background: #eef2ff;
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

  .module-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .module-trigger {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }

  .module-trigger:hover,
  .module-trigger:focus-visible {
    color: #1d4ed8;
  }

  .module-trigger-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .drag-hint {
    font-size: 1.2rem;
    color: #94a3b8;
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

  .module-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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

  .lesson-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .lesson-item {
    list-style: none;
  }

  .lesson-item.dragging {
    opacity: 0.65;
  }

  .lesson-item.drop-target .lesson-select {
    background: rgba(37, 99, 235, 0.12);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.4);
  }

  .lesson-select {
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

  .lesson-select.active {
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

  .icon-button {
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 0.8rem;
    padding: 0.35rem 0.55rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background 0.2s ease-in-out, color 0.2s ease-in-out;
  }

  .icon-button:hover,
  .icon-button:focus-visible {
    background: #e2e8f0;
    color: #1f2937;
  }

  .icon-button.danger {
    color: #b91c1c;
  }

  .icon-button.danger:hover,
  .icon-button.danger:focus-visible {
    background: #fee2e2;
    color: #7f1d1d;
  }

  .icon-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .lesson-drop-zone {
    margin-top: 0.25rem;
    padding: 0.55rem 0.75rem;
    border: 1px dashed #a5b4fc;
    border-radius: 0.65rem;
    color: #4338ca;
    background: rgba(99, 102, 241, 0.08);
    font-size: 0.85rem;
    text-align: center;
  }

  .module-drop-zone {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 2px dashed #93c5fd;
    border-radius: 0.75rem;
    color: #1d4ed8;
    background: rgba(37, 99, 235, 0.08);
    font-size: 0.9rem;
    text-align: center;
  }

  .module-status {
    margin: 0.75rem 0 0;
    font-size: 0.85rem;
    color: #475467;
  }

  .inline-status {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    color: #475467;
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

  .lesson-detail {
    gap: 1.5rem;
  }

  .lesson-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    width: 100%;
  }

  .lesson-status {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    background: #eef2f6;
    color: #475467;
    font-size: 0.9rem;
    flex-wrap: wrap;
  }

  .lesson-status[data-state='saving'] {
    background: #f4ebff;
    color: #6941c6;
  }

  .lesson-status[data-state='error'] {
    background: #fee2e2;
    color: #b91c1c;
  }

  .lesson-status[data-state='dirty'] {
    background: #fff7ed;
    color: #b45309;
  }

  .lesson-status[data-state='success'] {
    background: #dcfce7;
    color: #047857;
  }

  .lesson-status .ghost {
    margin-left: auto;
  }

  .block-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    background: #f8fafc;
    border: 1px dashed #cbd5f5;
    border-radius: 0.85rem;
    padding: 0.75rem 1rem;
  }

  .block-toolbar span {
    font-weight: 600;
    color: #475467;
  }

  .block-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: 100%;
  }

  .block-card {
    border: 1px solid #e2e8f0;
    border-radius: 0.9rem;
    background: #f9fafb;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .block-card[data-type='heading'] {
    background: #f8f0ff;
  }

  .block-card[data-type='list'] {
    background: #f0f9ff;
  }

  .block-card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .block-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .block-label {
    font-weight: 600;
    color: #1f2937;
  }

  .block-meta {
    font-size: 0.75rem;
    color: #64748b;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .block-card label {
    font-weight: 600;
    color: #475467;
    font-size: 0.9rem;
  }

  .block-card textarea,
  .block-card input,
  .block-card select {
    width: 100%;
    border-radius: 0.65rem;
    border: 1px solid #d2d6dc;
    padding: 0.55rem 0.75rem;
    font-size: 0.95rem;
    font-family: inherit;
    background: #fff;
    transition: border 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  }

  .block-card textarea:focus-visible,
  .block-card input:focus-visible,
  .block-card select:focus-visible {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }

  .block-card textarea {
    min-height: 120px;
    resize: vertical;
    line-height: 1.5;
  }

  .heading-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }

  .heading-controls label {
    margin: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
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
