export type CourseSummary = {
  courseId: string;
  title: string;
  language: string;
  createdAt: string;
  updatedAt: string;
};

export type Lesson = {
  lessonId: string;
  title: string;
  position: number;
};

export type Module = {
  moduleId: string;
  title: string;
  position: number;
  lessons: Lesson[];
};

export type Course = CourseSummary & {
  modules: Module[];
};
