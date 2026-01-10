import { useIngredientsFilterStore } from "@/features/ingredients";
import {
  CourseFilterBottomSheet,
  CuisineFilterBottomSheet,
  DietaryFilterBottomSheet,
} from "@/shared/tags";
import { Chip, Row, ScrollView } from "@/shared/ui";

export interface RecipeFiltersProps {
  disabled?: boolean;
  onShowAllFilters?: () => void;
}

export const RecipeFilters = (props: RecipeFiltersProps) => {
  const { disabled = false, onShowAllFilters } = props;

  const filterStore = useIngredientsFilterStore();

  const activeFilterCount =
    filterStore.restrictions.length +
    filterStore.blacklist.length +
    (filterStore.cuisine ? 1 : 0) +
    (filterStore.course ? 1 : 0) +
    (filterStore.component ? 1 : 0);

  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ paddingHorizontal: 14 }}
      style={{ marginHorizontal: -14 }}
    >
      <Row centered spacing={8}>
        <DietaryFilterBottomSheet disabled={disabled} />
        <CuisineFilterBottomSheet disabled={disabled} />
        <CourseFilterBottomSheet disabled={disabled} />
        <Chip
          selected={activeFilterCount > 0 ? activeFilterCount : undefined}
          borderRadius={8}
          disabled={disabled}
          icon="tune-variant"
          mode="outlined"
          onPress={onShowAllFilters}
        >
          Show all filters
        </Chip>
      </Row>
    </ScrollView>
  );
};
