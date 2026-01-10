import { Stack } from "expo-router";

import {
    getDefaultStackOptions,
    getSettingsCardOptions,
} from "../../src/shared/navigation";
import { useTheme } from "../../src/shared/theme";

export default function Layout() {
    const { colors } = useTheme();

    return (
        <Stack screenOptions={getDefaultStackOptions(colors)}>
            <Stack.Screen
                name="index"
                options={{
                    headerShown: true,
                    headerLargeTitle: true,
                    headerTitle: "Settings",
                }}
            />
            <Stack.Screen
                name="blacklist"
                options={getSettingsCardOptions("Blacklist")}
            />
            <Stack.Screen
                name="dietary"
                options={getSettingsCardOptions("Dietary Preferences")}
            />
            <Stack.Screen
                name="servings"
                options={getSettingsCardOptions("Serving Size")}
            />
            <Stack.Screen
                name="skill"
                options={getSettingsCardOptions("Skill Level")}
            />
            <Stack.Screen
                name="prompts"
                options={getSettingsCardOptions("Favorite Prompts")}
            />
            <Stack.Screen
                name="prompt-create"
                options={{
                    ...getSettingsCardOptions(""),
                    gestureEnabled: true,
                    presentation: "fullScreenModal",
                }}
            />
        </Stack>
    );
}
