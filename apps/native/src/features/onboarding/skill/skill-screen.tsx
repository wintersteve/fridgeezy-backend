import { useRouter } from "expo-router";
import { useState } from "react";

import { useProfileSettings, useUpdateProfileSettings } from "@/core/supabase";
import { AuthLayout } from "@/features/auth";
import { DifficultyType, SkillsCard } from "@/shared/skills";
import { Button, ScrollView, Section } from "@/shared/ui";

export const SkillScreen = () => {
  const profileSettings = useProfileSettings();

  const updateProfileSettings = useUpdateProfileSettings();

  const [difficulty, setDifficulty] = useState<DifficultyType | undefined>();

  const currentDifficulty = difficulty ?? profileSettings.data?.difficulty;

  const hasChanged =
    difficulty !== undefined && difficulty !== profileSettings.data?.difficulty;

  const router = useRouter();

  const handleContinue = async () => {
    if (hasChanged && difficulty) {
      await updateProfileSettings.mutateAsync({ difficulty });
    }
    router.push("/(onboarding)/subscription");
  };

  return (
    <AuthLayout
      button={
        <Button
          disabled={updateProfileSettings.isPending}
          onPress={handleContinue}
        >
          Continue
        </Button>
      }
      description="Tell us how good you cook, so we can recommend recipes that fit your
          lifestyle.
"
    >
      <ScrollView style={{ flex: 1 }}>
        <Section title="Default Difficulty" style={{ marginHorizontal: 12 }}>
          <SkillsCard value={currentDifficulty!} onChange={setDifficulty} />
        </Section>
      </ScrollView>
    </AuthLayout>
  );
};
