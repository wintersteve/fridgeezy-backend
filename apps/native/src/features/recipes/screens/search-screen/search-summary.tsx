import { Text } from "react-native-paper";

import { useIngredientsFilterStore } from "@/features/ingredients";
import {
  COMMON_ALLERGENS,
  CommonAllergen,
  COURSE_TYPES,
  CUISINES,
  DIETARY_TAGS,
  DietaryTag,
} from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

import { FilterLink } from "./filter-link";

interface SearchSummaryProps {
  ingredients: string[];
  onIngredientsChange: (ingredients: string[]) => void;
}

export const SearchSummary = (props: SearchSummaryProps) => {
  const { ingredients, onIngredientsChange } = props;

  const theme = useTheme();

  const filterStore = useIngredientsFilterStore();

  const formatList = (items: string[], lowercase = false) => {
    const formatted = items.map((item) => item.replace(/_/g, " ")).join(", ");
    return lowercase ? formatted.toLowerCase() : formatted;
  };

  const hasCuisine = filterStore.cuisine !== "";
  const hasCourse = filterStore.course !== "";
  const hasRestrictions = filterStore.restrictions.length > 0;
  const hasBlacklist = filterStore.blacklist.length > 0;
  const hasIngredients = ingredients.length > 0;

  const cuisineLabel = hasCuisine
    ? filterStore.cuisine.replace(/_/g, " ").toLowerCase()
    : null;
  const courseLabel = hasCourse
    ? filterStore.course.replace(/_/g, " ").toLowerCase() + "s"
    : "dishes";
  const restrictionsLabel = hasRestrictions
    ? formatList(filterStore.restrictions, true)
    : null;
  const blacklistLabel = hasBlacklist
    ? formatList(filterStore.blacklist, true)
    : null;
  const ingredientsLabel = hasIngredients
    ? formatList(ingredients, true)
    : null;

  return (
    <Row style={{ marginHorizontal: 20, flexWrap: "wrap" }}>
      <Text style={{ color: theme.colors.onSurfaceVariant }}>
        Searching for{" "}
      </Text>

      {hasCuisine && (
        <>
          <FilterLink
            description="Select your preferred cuisines"
            label={cuisineLabel!}
            onChange={(value) => filterStore.setCuisine(value[0] ?? "")}
            options={CUISINES}
            title="Cuisine"
            value={filterStore.cuisine ? [filterStore.cuisine] : []}
          />
          <Text> </Text>
        </>
      )}

      <FilterLink
        description="Filter by course type"
        label={courseLabel}
        onChange={(value) => filterStore.setCourse(value[0] ?? "")}
        options={COURSE_TYPES}
        title="Course"
        value={filterStore.course ? [filterStore.course] : []}
      />

      {hasRestrictions && (
        <>
          <Text> that are </Text>
          <FilterLink
            description="Select your dietary preferences"
            label={restrictionsLabel!}
            onChange={(value) =>
              filterStore.setRestrictions(value as DietaryTag[])
            }
            options={DIETARY_TAGS}
            title="Preferences"
            value={filterStore.restrictions}
          />
        </>
      )}

      {hasIngredients && (
        <>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            {hasRestrictions ? ", with " : " with "}
          </Text>
          <FilterLink
            description="Select which ingredients to include"
            label={ingredientsLabel!}
            onChange={onIngredientsChange}
            options={ingredients}
            title="Ingredients"
            value={ingredients}
          />
        </>
      )}

      {hasBlacklist && (
        <>
          <Text style={{ color: theme.colors.onBackground }}>, excluding </Text>
          <FilterLink
            description="Exclude ingredients you dislike or are allergic to"
            label={blacklistLabel!}
            onChange={(value) =>
              filterStore.setBlacklist(value as CommonAllergen[])
            }
            options={COMMON_ALLERGENS}
            title="Blacklist"
            value={filterStore.blacklist}
          />
        </>
      )}

      <Text>.</Text>
    </Row>
  );
};
