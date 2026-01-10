import { useProfileSettings } from "@/core/supabase";
import { Badge, Link } from "@/shared/ui";

import { SettingItem } from "../setting-item";

export const ServingsSetting = () => {
  const profileSettings = useProfileSettings();

  const servings = profileSettings.data?.servings ?? 2;

  return (
    <Link href="/settings/servings">
      <SettingItem
        icon="counter"
        title="Serving Size"
        right={<Badge borderRadius={6}>{servings}</Badge>}
      />
    </Link>
  );
};
