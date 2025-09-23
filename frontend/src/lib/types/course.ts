export type CourseSummary = {
  courseId: string;
  title: string;
  language: string;
  createdAt: string;
  updatedAt: string;
};

export type BlockType = 'text' | 'heading' | 'list';

export type TextBlockContent = {
  text: string;
};

export type HeadingBlockContent = {
  text: string;
  level: number;
};

export type ListBlockContent = {
  items: string[];
  style: 'bulleted' | 'numbered';
};

export type BlockContent = TextBlockContent | HeadingBlockContent | ListBlockContent;

export type Block = {
  blockId: string;
  type: BlockType;
  content: BlockContent;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Lesson = {
  lessonId: string;
  title: string;
  position: number;
  blocks: Block[];
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
