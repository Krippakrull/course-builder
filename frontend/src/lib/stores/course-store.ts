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

function createModule(title: string, position: number): Module {
  return {
    moduleId: crypto.randomUUID(),
    title,
    position,
    lessons: [],
  };
}

function createLesson(title: string, position: number): Lesson {
  return {
    lessonId: crypto.randomUUID(),
    title,
    position,
  };
}

function createCourseStore() {
  const { subscribe, update, set } = writable(createInitialState());

  return {
    subscribe,
    reset() {
      set(createInitialState());
    },
    setCourse(course: Course | CourseSummary) {
      const modules = 'modules' in course ? course.modules : [];

      set({
        course: {
          ...course,
          modules,
        },
        selectedModuleId: modules.at(0)?.moduleId ?? null,
        selectedLessonId: modules.at(0)?.lessons.at(0)?.lessonId ?? null,
      });
    },
    addModule(title: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const module = createModule(title, state.course.modules.length);
        return {
          ...state,
          course: {
            ...state.course,
            modules: [...state.course.modules, module],
          },
          selectedModuleId: module.moduleId,
          selectedLessonId: null,
        };
      });
    },
    addLesson(moduleId: string, title: string) {
      update((state) => {
        if (!state.course) {
          return state;
        }

        const modules = state.course.modules.map((module) => {
          if (module.moduleId !== moduleId) {
            return module;
          }

          const lesson = createLesson(title, module.lessons.length);
          return {
            ...module,
            lessons: [...module.lessons, lesson],
          };
        });

        const selectedModule = modules.find((module) => module.moduleId === moduleId);
        const selectedLessonId = selectedModule?.lessons.at(-1)?.lessonId ?? null;

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
