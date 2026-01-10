import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePrompt } from "../../src/core/supabase";
import {
    PromptFormatter,
    PromptVariableBottomSheet,
    PromptVariableBottomSheetRef,
    TagType,
    VariableType,
} from "../../src/shared/prompts";
import { Button, Card, ErrorBoundary, Layout } from "../../src/shared/ui";

interface ActiveVariable {
    label: string;
    variableType: VariableType;
    tagType: TagType | null;
}

export default function Screen() {
    const { id } = useLocalSearchParams<{ id: string }>();

    const insets = useSafeAreaInsets();

    const prompt = usePrompt({ id });

    const [selectedValues, setSelectedValues] = useState<
        Record<string, string>
    >({});
    const [activeVariable, setActiveVariable] = useState<ActiveVariable | null>(
        null
    );

    const bottomSheetRef = useRef<PromptVariableBottomSheetRef>(null);

    const handlePress = (key: string) => {
        const variable = prompt.data?.prompt_variables?.find(
            (v) => v.label === key
        );

        if (variable) {
            setActiveVariable({
                label: variable.label,
                variableType: variable.variable_type as VariableType,
                tagType: variable.tag_type as TagType | null,
            });
            bottomSheetRef.current?.open();
        }
    };

    const handleSelect = (value: string) => {
        if (activeVariable) {
            setSelectedValues((prev) => ({
                ...prev,
                [activeVariable.label]: value,
            }));
        }
    };

    const getDisplayPrompt = () => {
        if (!prompt.data?.prompt) return "";

        let displayPrompt = prompt.data.prompt;
        for (const [label, value] of Object.entries(selectedValues)) {
            displayPrompt = displayPrompt.replace(`${label}`, value);
        }
        return displayPrompt;
    };

    if (prompt.isLoading) return null;

    if (!prompt.data?.prompt) return <ErrorBoundary />;

    return (
        <Layout
            contentInsetAdjustmentBehavior="automatic"
            enableSafeArea={false}
            spacing={0}
        >
            <Card
                contentStyle={{ padding: 20 }}
                style={{
                    marginHorizontal: 12,
                    marginTop: 12,
                }}
            >
                <PromptFormatter
                    onPress={handlePress}
                    variant="headlineSmall"
                    value={getDisplayPrompt()}
                />
            </Card>
            <Button
                style={{
                    marginHorizontal: 12,
                    marginTop: "auto",
                    marginBottom: insets.bottom,
                }}
            >
                Confirm
            </Button>
            {activeVariable && (
                <PromptVariableBottomSheet
                    ref={bottomSheetRef}
                    onSelect={handleSelect}
                    value={selectedValues[activeVariable.label]}
                    variableType={activeVariable.variableType}
                    tagType={activeVariable.tagType}
                />
            )}
        </Layout>
    );
}
