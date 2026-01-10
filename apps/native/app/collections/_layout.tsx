import { Stack } from "expo-router";

import {
    getBaseHeaderOptions,
    getCustomLayoutOptions,
} from "../../src/shared/navigation";
import { useTheme } from "../../src/shared/theme";

export default function Layout() {
    const theme = useTheme();

    return (
        <Stack
            screenOptions={{
                ...getBaseHeaderOptions(theme.colors),
                headerShown: false,
            }}
        >
            <Stack.Screen name="[id]" options={getCustomLayoutOptions()} />
        </Stack>
    );
}
