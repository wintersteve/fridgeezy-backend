import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type MenuCourse = Tables<"menu_courses">;

export type MenuCourseInsertPayload = TablesInsert<"menu_courses">;

export type MenuCourseUpdatePayload = TablesUpdate<"menu_courses">;
