import { useRouter } from "expo-router";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDietaryPreferencesEditor } from "../../src/shared/supabase";
import { useTheme } from "../../src/shared/theme";
import { Button, Card, ScrollView, Tags } from "../../src/shared/ui";

export default function Screen() {
    const theme = useTheme();

    const router = useRouter();

    const insets = useSafeAreaInsets();

    const editor = useDietaryPreferencesEditor();

    const handleConfirm = async () => {
        await editor.save();
        router.back();
    };

    return (
        <View
            style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
            }}
        >
            <ScrollView style={{ flex: 1 }}>
                <Text
                    variant="headlineMedium"
                    style={{
                        color: theme.colors.onBackgroundVariant,
                        marginLeft: 6,
                        marginBottom: 4,
                    }}
                >
                    {editor.selected.length} Selected
                </Text>
                <Card contentStyle={{ padding: 12 }}>
                    <Tags
                        data={editor.tags}
                        isLoading={editor.isLoading}
                        onPress={editor.toggle}
                        selected={editor.selected}
                    />
                </Card>
            </ScrollView>
            <Button
                loading={editor.isMutating}
                onPress={handleConfirm}
                style={{ marginBottom: insets.bottom }}
            >
                Confirm
            </Button>
        </View>
    );
}
