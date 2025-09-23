import { writable } from 'svelte/store';
import type { Block, Course, CourseSummary, Lesson, Module } from '$lib/types/course';

export type CourseStoreState = {
  course: Course | null;
  selectedModuleId: string | null;
  selectedLessonId: string | null;
};

function createInitialState(): CourseStoreState {
  return {
    course: null,
    selectedModuleId: null,
    selectedLessonId: null,
  };
}

function sortBlocks(blocks: Block[]): Block[] {
  return [...blocks]
    .sort((a, b) => a.position - b.position)
    .map((block, index) => ({
      ...block,
      position: index,
    }));
}

function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons]
    .sort((a, b) => a.position - b.position)
    .map((lesson, index) => ({
      ...lesson,
      position: index,
      blocks: sortBlocks(lesson.blocks ?? []),
    }));
}

function sortModules(modules: Module[]): Module[] {
  return [...modules]
    .map((module) => ({
      ...module,
      lessons: sortLessons(module.lessons ?? []),
    }))
    .sort((a, b) => a.position - b.position)
    .map((module, index) => ({
      ...module,
      position: index,
    }));
}

function resolveSelection(
  modules: Module[],
  previousModuleId: string | null,
  previousLessonId: string | null
) {
  const moduleExists = previousModuleId
    ? modules.some((module) => module.moduleId === previousModuleId)
    : false;

  const selectedModuleId = moduleExists
    ? (previousModuleId as string)
    : modules.at(0)?.moduleId ?? null;

  const selectedLessonId = selectedModuleId
    ? (() => {
        const selectedModule = modules.find((module) => module.moduleId === selectedModuleId);
        if (!selectedModule) {
          return null;
        }

        if (
          previousLessonId &&
          selectedModule.lessons.some((lesson) => lesson.lessonId === previousLessonId)
        ) {
          return previousLessonId;
        }

        return selectedModule.lessons.at(0)?.lessonId ?? null;
      })()
    : null;

  return { selectedModuleId, selectedLessonId };
}

function createCourseStore() {
  const { subscribe, update, set } = writable(createInitialState());

  return {
    subscribe,
    reset() {
      set(createInitialState());
    },
    setCourse(course: Course | CourseSummary) {
      const modules = 'modules' in course ? sortModules(course.modules ?? []) : [];

      set({
        course: {
          ...course,
          modules,
        },
        selectedModuleId: modules.at(0)?.moduleId ?? null,
        selectedLessonId: modules.at(0)?.lessons.at(0)?.lessonId ?? null,
      });
    },
    addModule(module: Module) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = sortModules([
          ...state.course.modules.filter((item) => item.moduleId !== module.moduleId),
          {
            ...module,
            lessons: sortLessons(module.lessons ?? []),
          },
        ]);

        const { selectedModuleId, selectedLessonId } = resolveSelection(
          modules,
          module.moduleId,
          module.lessons.at(0)?.lessonId ?? null
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    addLesson(moduleId: string, lesson: Lesson) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = state.course.modules.map((module) => {
          if (module.moduleId !== moduleId) {
            return module;
          }

          return {
            ...module,
            lessons: sortLessons([
              ...module.lessons.filter((item) => item.lessonId !== lesson.lessonId),
              lesson,
            ]),
          };
        });

        const sortedModules = sortModules(modules);
        const { selectedModuleId, selectedLessonId } = resolveSelection(
          sortedModules,
          moduleId,
          lesson.lessonId
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules: sortedModules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    selectModule(moduleId: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        return {
          ...state,
          selectedModuleId: moduleId,
          selectedLessonId: null,
        };
      });
    },
    removeModule(moduleId: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const filteredModules = state.course.modules.filter((module) => module.moduleId !== moduleId);
        const modules = sortModules(filteredModules);
        const { selectedModuleId, selectedLessonId } = resolveSelection(
          modules,
          state.selectedModuleId === moduleId ? null : state.selectedModuleId,
          state.selectedModuleId === moduleId ? null : state.selectedLessonId
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    removeLesson(moduleId: string, lessonId: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = state.course.modules.map((module) => {
          if (module.moduleId !== moduleId) {
            return module;
          }

          return {
            ...module,
            lessons: sortLessons(module.lessons.filter((lesson) => lesson.lessonId !== lessonId)),
          };
        });

        const sortedModules = sortModules(modules);
        const { selectedModuleId, selectedLessonId } = resolveSelection(
          sortedModules,
          state.selectedModuleId,
          state.selectedLessonId === lessonId ? null : state.selectedLessonId
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules: sortedModules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    reorderModules(moduleIds: string[]) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const moduleMap = new Map(state.course.modules.map((module) => [module.moduleId, module]));
        const reordered: Module[] = [];

        for (const moduleId of moduleIds) {
          const module = moduleMap.get(moduleId);
          if (module) {
            reordered.push({
              ...module,
              position: reordered.length,
              lessons: sortLessons(module.lessons ?? []),
            });
            moduleMap.delete(moduleId);
          }
        }

        const remaining = Array.from(moduleMap.values()).map((module, index) => ({
          ...module,
          position: reordered.length + index,
          lessons: sortLessons(module.lessons ?? []),
        }));

        const modules = [...reordered, ...remaining];
        const { selectedModuleId, selectedLessonId } = resolveSelection(
          modules,
          state.selectedModuleId,
          state.selectedLessonId
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    reorderLessons(moduleId: string, lessonIds: string[]) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = state.course.modules.map((module) => {
          if (module.moduleId !== moduleId) {
            return module;
          }

          const lessonMap = new Map(module.lessons.map((lesson) => [lesson.lessonId, lesson]));
          const reorderedLessons: Lesson[] = [];

          for (const lessonId of lessonIds) {
            const lesson = lessonMap.get(lessonId);
            if (lesson) {
              reorderedLessons.push({
                ...lesson,
                position: reorderedLessons.length,
              });
              lessonMap.delete(lessonId);
            }
          }

          const remainingLessons = Array.from(lessonMap.values()).map((lesson, index) => ({
            ...lesson,
            position: reorderedLessons.length + index,
          }));

          return {
            ...module,
            lessons: sortLessons([...reorderedLessons, ...remainingLessons]),
          };
        });

        const sortedModules = sortModules(modules);
        const { selectedModuleId, selectedLessonId } = resolveSelection(
          sortedModules,
          state.selectedModuleId,
          state.selectedLessonId
        );

        return {
          ...state,
          course: {
            ...state.course,
            modules: sortedModules,
          },
          selectedModuleId,
          selectedLessonId,
        };
      });
    },
    selectLesson(moduleId: string, lessonId: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        return {
          ...state,
          selectedModuleId: moduleId,
          selectedLessonId: lessonId,
        };
      });
    },
    setLessonBlocks(lessonId: string, blocks: Block[]) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = state.course.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => {
            if (lesson.lessonId !== lessonId) {
              return lesson;
            }

            return {
              ...lesson,
              blocks: sortBlocks(blocks),
            };
          }),
        }));

        return {
          ...state,
          course: {
            ...state.course,
            modules: sortModules(modules),
          },
        };
      });
    },
  };
}

export const courseStore = createCourseStore();
