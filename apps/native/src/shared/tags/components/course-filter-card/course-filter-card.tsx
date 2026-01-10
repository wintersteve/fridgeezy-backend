import { useIngredientsFilterStore } from "@/features/ingredients";
import { FilterCard } from "@/features/ingredients/components/ingredients-filter-modal/filter-card";
import { useTags } from "@/shared/supabase";

export const CourseFilterCard = () => {
  const filterStore = useIngredientsFilterStore();

  const tags = useTags("course");

  return (
    <FilterCard
      description="Filter by course type"
      onChange={(value) => filterStore.setCourse(value[0] ?? "")}
      onClear={() => filterStore.resetFilter("course")}
      options={tags.data?.map((item) => item.name) ?? []}
      title="Course"
      value={filterStore.course ? [filterStore.course] : []}
    />
  );
};
