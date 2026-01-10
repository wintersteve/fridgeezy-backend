import { usePrompts } from "@/core/supabase";
import { Badge, Link } from "@/shared/ui";

import { SettingItem } from "../setting-item";

export const PromptsSetting = () => {
  const prompts = usePrompts();

  return (
    <Link href="/settings/prompts">
      <SettingItem
        icon="message-text-outline"
        title="Favorite Prompts"
        right={<Badge borderRadius={6}>{prompts.data?.length ?? 0}</Badge>}
      />
    </Link>
  );
};
