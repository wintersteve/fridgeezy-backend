import { useIngredientsFilterStore } from "@/features/ingredients";
import { FilterCard } from "@/features/ingredients/components/ingredients-filter-modal/filter-card";

const DIFFICULTY_OPTIONS = ["easy", "medium", "hard"];

export const DifficultyFilterCard = () => {
  const filterStore = useIngredientsFilterStore();

  return (
    <FilterCard
      description="Filter recipes by cooking difficulty level"
      onChange={(value) => filterStore.setDifficulty(value[0] ?? null)}
      options={DIFFICULTY_OPTIONS}
      title="Difficulty"
      value={filterStore.difficulty ? [filterStore.difficulty] : []}
    />
  );
};
