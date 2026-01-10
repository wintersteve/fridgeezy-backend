import {
  COMMON_ALLERGENS,
  COURSE_TYPES,
  CUISINES,
  DIETARY_TAGS,
  DISH_COMPONENTS,
  MEAL_TIMES,
} from "../constants";

export interface Ingredient {
  id: string;
  unit: string;
  quantity: string;
}

export interface Ingredients {
  count: number;
  items: Ingredient[];
}

export interface Tags {
  common: string[];
  cuisines: string[];
}

export interface CaloriesDetail {
  carbs: number;
  calories: number;
  fat: number;
  protein: number;
}

export interface Calories {
  absolute: CaloriesDetail;
  relative: CaloriesDetail;
}

export interface Recipe {
  description: string;
  calories: Calories;
  id: string;
  image: string;
  ingredients: Ingredients;
  instructions: string[];
  name: string;
  servings: number;
  tags: Tags;
  time: number;
}

export type Cuisine = (typeof CUISINES)[number];

export type DietaryTag = (typeof DIETARY_TAGS)[number];

export type MealTime = (typeof MEAL_TIMES)[number];

export type CourseType = (typeof COURSE_TYPES)[number];

export type DishComponent = (typeof DISH_COMPONENTS)[number];

export type CommonAllergen = (typeof COMMON_ALLERGENS)[number];
