import { useIngredientsFilterStore } from "@/features/ingredients";
import { FilterCard } from "@/features/ingredients/components/ingredients-filter-modal/filter-card";
import { useTags } from "@/shared/supabase";

export const ComponentFilterCard = () => {
  const filterStore = useIngredientsFilterStore();

  const tags = useTags("component");

  return (
    <FilterCard
      description="Filter by dish component type"
      onChange={(value) => filterStore.setComponent(value[0] ?? "")}
      onClear={() => filterStore.resetFilter("component")}
      options={tags.data?.map((item) => item.name) ?? []}
      title="Component"
      value={filterStore.component ? [filterStore.component] : []}
    />
  );
};
