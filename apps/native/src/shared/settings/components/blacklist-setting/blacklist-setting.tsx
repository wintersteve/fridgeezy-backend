import { useIngredientsFilterStore } from "@/features/ingredients";
import { Badge, Link } from "@/shared/ui";

import { SettingItem } from "../setting-item";

export const BlacklistSetting = () => {
  const { blacklist } = useIngredientsFilterStore();

  return (
    <Link href="/settings/blacklist">
      <SettingItem
        icon="food-variant-off"
        title="Disliked Ingredients"
        right={<Badge borderRadius={6}>{blacklist.length}</Badge>}
      />
    </Link>
  );
};
