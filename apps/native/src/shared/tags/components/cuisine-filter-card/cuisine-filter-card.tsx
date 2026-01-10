import { useIngredientsFilterStore } from "@/features/ingredients";
import { FilterCard } from "@/features/ingredients/components/ingredients-filter-modal/filter-card";
import { useTags } from "@/shared/supabase";

export const CuisineFilterCard = () => {
  const filterStore = useIngredientsFilterStore();

  const tags = useTags("cuisine");

  return (
    <FilterCard
      description="Select your preferred cuisines"
      onChange={(value) => filterStore.setCuisine(value[0] ?? "")}
      onClear={() => filterStore.resetFilter("cuisine")}
      options={tags.data?.map((item) => item.name) ?? []}
      title="Cuisine"
      value={filterStore.cuisine ? [filterStore.cuisine] : []}
    />
  );
};
