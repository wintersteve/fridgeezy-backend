import { useIngredientsFilterStore } from "../use-ingredients-filter-store";

export const useFilters = () => {
  const filterStore = useIngredientsFilterStore();

  return {
    cuisine: filterStore.cuisine,
    course: filterStore.course,
    restrictions: filterStore.restrictions,
  };
};
