import { writable } from 'svelte/store';
import type { Course, CourseSummary, Lesson, Module } from '$lib/types/course';

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

function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => a.position - b.position);
}

function sortModules(modules: Module[]): Module[] {
  return [...modules]
    .map((module) => ({
      ...module,
      lessons: sortLessons(module.lessons ?? []),
    }))
    .sort((a, b) => a.position - b.position);
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
          { ...module, lessons: sortLessons(module.lessons ?? []) },
        ]);

        return {
          ...state,
          course: {
            ...state.course,
            modules,
          },
          selectedModuleId: module.moduleId,
          selectedLessonId: module.lessons.at(0)?.lessonId ?? null,
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

        const selectedModule = modules.find((module) => module.moduleId === moduleId);
        const selectedLessonId = selectedModule?.lessons.find(
          (item) => item.lessonId === lesson.lessonId
        )?.lessonId ?? null;

        return {
          ...state,
          course: {
            ...state.course,
            modules,
          },
          selectedModuleId: moduleId,
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
  };
}

export const courseStore = createCourseStore();
