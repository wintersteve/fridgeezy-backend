import { useProfileDietaryPreferences } from "@/core/supabase";
import { useIngredientsFilterStore } from "@/features/ingredients";
import { FilterCard } from "@/features/ingredients/components/ingredients-filter-modal/filter-card";
import { DietaryTag } from "@/shared/entities";
import { useDietaryPreferencesEditor } from "@/shared/supabase";

export const DietaryFilterCard = () => {
  const store = useIngredientsFilterStore();

  const editor = useDietaryPreferencesEditor();

  const preferences = useProfileDietaryPreferences();

  const settings = store.restrictions?.map((item) => item);

  const value = !!settings?.length
    ? settings
    : preferences.data?.map((item) => item.tag.name);

  const handleClear = () => {
    store.resetFilter("restrictions");
  };

  return (
    <FilterCard
      description="Let use know about your dietary preferences"
      onChange={(value) => store.setRestrictions(value as DietaryTag[])}
      onClear={handleClear}
      options={editor.tags?.map((item) => item.name) ?? []}
      title="Dietary"
      value={value ?? []}
    />
  );
};
