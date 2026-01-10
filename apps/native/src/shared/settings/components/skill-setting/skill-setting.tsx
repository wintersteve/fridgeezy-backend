import { useProfileSettings } from "@/core/supabase";
import { Database } from "@/shared/supabase/types";
import { Badge, Link } from "@/shared/ui";

import { SettingItem } from "../setting-item";

type DifficultyType = Database["public"]["Enums"]["difficulty_type"];

const DIFFICULTY_TO_LEVEL: Record<DifficultyType, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export const SkillSetting = () => {
  const profileSettings = useProfileSettings();

  const skillLevel =
    DIFFICULTY_TO_LEVEL[profileSettings.data?.difficulty ?? "easy"];

  const ICON: Record<number, string> = {
    1: "star-outline",
    2: "star-half",
    3: "star",
  };

  return (
    <Link href="/settings/skill">
      <SettingItem
        icon={ICON[skillLevel]}
        title="Skill Level"
        right={<Badge borderRadius={6}>{skillLevel}</Badge>}
      />
    </Link>
  );
};
