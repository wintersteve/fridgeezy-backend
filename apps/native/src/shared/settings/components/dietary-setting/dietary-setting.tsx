import { useProfileDietaryPreferences } from "@/core/supabase";
import { Badge, Link } from "@/shared/ui";

import { SettingItem } from "../setting-item";

export const DietarySetting = () => {
  const dietaryPreferences = useProfileDietaryPreferences();

  return (
    <Link href="/settings/dietary">
      <SettingItem
        icon="barley-off"
        title="Dietary Preferences"
        right={
          <Badge borderRadius={6}>{dietaryPreferences.data?.length ?? 0}</Badge>
        }
      />
    </Link>
  );
};
