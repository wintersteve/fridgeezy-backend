import { useNavigation } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    useProfileSettings,
    useUpdateProfileSettings,
} from "../../src/core/supabase";
import { DifficultyType, SkillsCard } from "../../src/shared/skills";
import { Button, Section } from "../../src/shared/ui";

export default function SkillLevelScreen() {
    const navigation = useNavigation();

    const insets = useSafeAreaInsets();

    const profileSettings = useProfileSettings();
    const updateProfileSettings = useUpdateProfileSettings();

    const [difficulty, setDifficulty] = useState<DifficultyType | undefined>();

    const currentDifficulty = difficulty ?? profileSettings.data?.difficulty;
    const hasChanged =
        difficulty !== undefined &&
        difficulty !== profileSettings.data?.difficulty;

    const handleConfirm = () => {
        if (hasChanged && difficulty) {
            updateProfileSettings.mutate({ difficulty });
        }
        navigation.goBack();
    };

    return (
        <View style={{ flex: 1, paddingTop: 8 }}>
            <Section
                title="Default Difficulty"
                style={{ marginHorizontal: 12 }}
            >
                <SkillsCard
                    value={currentDifficulty!}
                    onChange={setDifficulty}
                />
            </Section>
            <Button
                disabled={!hasChanged}
                style={{ marginBottom: insets.bottom, marginHorizontal: 20 }}
                onPress={handleConfirm}
            >
                Confirm
            </Button>
        </View>
    );
}
