import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView as RNScrollView,
    StyleSheet,
    TextInput as RNTextInput,
    View,
} from "react-native";
import { IconButton, Text } from "react-native-paper";

import {
    useDeletePromptVariables,
    useInsertPrompt,
    useInsertPromptVariables,
    usePromptVariableTypes,
    usePrompts,
    useUpdatePrompt,
    InsertPromptVariablePayload,
    PromptVariableType,
    TagType,
} from "../../src/core/supabase";
import { PromptFormatter } from "../../src/shared/prompts";
import { useTheme } from "../../src/shared/theme";
import {
    BottomSheet,
    Button,
    Chip,
    Row,
    ScrollView,
} from "../../src/shared/ui";

type LocalVariable = {
    label: string;
    position: number;
    variable_type: PromptVariableType;
    tag_type: TagType | null;
};

type VariableOption = {
    label: string;
    variable_type: PromptVariableType;
    tag_type: TagType | null;
    placeholder: string;
};

type VariableConfig = {
    label: string;
    tag_type: TagType | null;
    placeholder: string;
};

const VARIABLE_CONFIG: Record<string, VariableConfig> = {
    ingredient: {
        label: "Ingredient",
        tag_type: null,
        placeholder: "ingredient",
    },
    tag_cuisine: {
        label: "Cuisine",
        tag_type: "cuisine",
        placeholder: "cuisine",
    },
    tag_dietary: {
        label: "Dietary",
        tag_type: "dietary",
        placeholder: "dietary",
    },
    tag_course: {
        label: "Course",
        tag_type: "course",
        placeholder: "course",
    },
    tag_component: {
        label: "Component",
        tag_type: "component",
        placeholder: "component",
    },
    text: {
        label: "Free Text",
        tag_type: null,
        placeholder: "",
    },
    component: {
        label: "Component",
        tag_type: null,
        placeholder: "component",
    },
    course: {
        label: "Course",
        tag_type: null,
        placeholder: "course",
    },
    type: {
        label: "Type",
        tag_type: null,
        placeholder: "type",
    },
};

export default function CreatePromptScreen() {
    const { colors } = useTheme();
    const navigation = useNavigation();
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string }>();

    const prompts = usePrompts();
    const promptVariableTypes = usePromptVariableTypes();
    const insertPrompt = useInsertPrompt();
    const updatePrompt = useUpdatePrompt();
    const insertPromptVariables = useInsertPromptVariables();
    const deletePromptVariables = useDeletePromptVariables();

    const editingPrompt = id ? prompts.data?.find((p) => p.id === id) : null;

    const variableOptions = useMemo<VariableOption[]>(() => {
        if (!promptVariableTypes.data) return [];

        return promptVariableTypes.data
            .map((item) => {
                const key = item.variable_type;
                const config = VARIABLE_CONFIG[key];

                if (!config) return null;

                return {
                    label: config.label,
                    variable_type: key as PromptVariableType,
                    tag_type: config.tag_type,
                    placeholder: config.placeholder,
                };
            })
            .filter((option): option is VariableOption => option !== null);
    }, [promptVariableTypes.data]);

    const [promptText, setPromptText] = useState("");
    const [variables, setVariables] = useState<LocalVariable[]>([]);
    const [customLabel, setCustomLabel] = useState("");

    const textInputRef = useRef<RNTextInput>(null);
    const customLabelBottomSheetRef = useRef<BottomSheetModal>(null);

    const isEditing = Boolean(editingPrompt);
    const isValid = promptText.trim().length > 0;
    const isMutating =
        insertPrompt.isPending ||
        updatePrompt.isPending ||
        insertPromptVariables.isPending ||
        deletePromptVariables.isPending;

    useEffect(() => {
        if (editingPrompt) {
            setPromptText(editingPrompt.prompt);
            const existingVars =
                editingPrompt.prompt_variables?.map((v, index) => ({
                    label: v.label,
                    position: index,
                    variable_type: v.variable_type,
                    tag_type: v.tag_type,
                })) ?? [];
            setVariables(existingVars);
        }
    }, [editingPrompt]);

    const handleSave = useCallback(async () => {
        if (!promptText.trim()) return;

        try {
            if (editingPrompt) {
                await updatePrompt.mutateAsync({
                    id: editingPrompt.id,
                    prompt: promptText.trim(),
                });

                await deletePromptVariables.mutateAsync(editingPrompt.id);
                if (variables.length > 0) {
                    const variablePayloads: InsertPromptVariablePayload[] =
                        variables.map((v, index) => ({
                            prompt_id: editingPrompt.id,
                            label: v.label,
                            position: index,
                            variable_type: v.variable_type,
                            tag_type: v.tag_type,
                        }));
                    await insertPromptVariables.mutateAsync(variablePayloads);
                }
            } else {
                const newPrompt = await insertPrompt.mutateAsync({
                    prompt: promptText.trim(),
                });

                if (variables.length > 0) {
                    const variablePayloads: InsertPromptVariablePayload[] =
                        variables.map((v, index) => ({
                            prompt_id: newPrompt.id,
                            label: v.label,
                            position: index,
                            variable_type: v.variable_type,
                            tag_type: v.tag_type,
                        }));
                    await insertPromptVariables.mutateAsync(variablePayloads);
                }
            }

            router.back();
        } catch (error) {
            console.error("Error saving prompt:", error);
        }
    }, [
        promptText,
        variables,
        editingPrompt,
        updatePrompt,
        deletePromptVariables,
        insertPrompt,
        insertPromptVariables,
        router,
    ]);

    useEffect(() => {
        navigation.setOptions({
            headerTitle: "",
            headerRight: () => (
                <IconButton icon="close-thick" onPress={() => router.back()} />
            ),
        });
    }, [navigation, isEditing, isValid, isMutating, handleSave, router]);

    const handleVariablePress = (option: VariableOption) => {
        if (option.variable_type === "text") {
            Keyboard.dismiss();
            customLabelBottomSheetRef.current?.present();
            return;
        }

        const placeholder = `{{${option.placeholder}}}`;
        setPromptText((prev) => prev + placeholder);
        setVariables((prev) => [
            ...prev,
            {
                label: option.placeholder,
                position: prev.length,
                variable_type: option.variable_type,
                tag_type: option.tag_type,
            },
        ]);
    };

    const handleInsertCustomVariable = () => {
        if (!customLabel.trim()) return;

        const label = customLabel.trim().toLowerCase().replace(/\s+/g, "_");
        const placeholder = `{{${label}}}`;
        setPromptText((prev) => prev + placeholder);
        setVariables((prev) => [
            ...prev,
            {
                label,
                position: prev.length,
                variable_type: "text",
                tag_type: null,
            },
        ]);
        setCustomLabel("");
        customLabelBottomSheetRef.current?.dismiss();
        setTimeout(() => {
            textInputRef.current?.focus();
        }, 100);
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={100}
        >
            {/* Top: Horizontal ScrollView with variable chips */}
            <View style={styles.variablesContainer}>
                <RNScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.variablesContent}
                    keyboardShouldPersistTaps="always"
                >
                    {variableOptions.map((option) => (
                        <Chip
                            key={option.label}
                            mode="outlined"
                            onPress={() => handleVariablePress(option)}
                            style={styles.chip}
                        >
                            {option.label}
                        </Chip>
                    ))}
                </RNScrollView>
            </View>

            {/* Middle: Large text display */}
            <ScrollView style={styles.displayContainer}>
                <PromptFormatter
                    disabled={!promptText.length}
                    value={
                        promptText.length
                            ? promptText
                            : "Give me a {{cuisine}} recipe, where {{ingredient}} is the main character."
                    }
                />
            </ScrollView>

            {/* Bottom: Text input above keyboard */}
            <Row
                centered
                style={{ marginBottom: 0, marginLeft: 0, marginRight: 12 }}
                wrap={false}
            >
                <View
                    style={[
                        styles.inputContainer,
                        {
                            backgroundColor: colors.background,
                            borderColor: colors.outline,

                            padding: 12,
                        },
                    ]}
                >
                    <RNTextInput
                        autoFocus
                        ref={textInputRef}
                        style={[
                            styles.textInput,
                            {
                                backgroundColor: colors.surface,
                                color: colors.onSurface,
                                fontFamily: "Poppins",
                            },
                        ]}
                        value={promptText}
                        onChangeText={setPromptText}
                        placeholder="Find recipes using ingredients you already have"
                        placeholderTextColor={colors.onSurfaceDisabled}
                    />
                </View>
                <View
                    style={{
                        backgroundColor: colors.primaryContainer,
                        borderRadius: 100,
                        padding: 0,
                    }}
                >
                    <IconButton
                        iconColor={colors.primary}
                        icon="check-bold"
                        onPress={handleSave}
                        disabled={!isValid || isMutating}
                        loading={isMutating}
                    />
                </View>
            </Row>

            {/* Custom label bottom sheet */}
            <BottomSheet ref={customLabelBottomSheetRef} snapPoints={["35%"]}>
                <View style={styles.sheetContent}>
                    <Text
                        variant="titleLarge"
                        style={[styles.sheetTitle, { color: colors.onSurface }]}
                    >
                        Custom Variable
                    </Text>
                    <Text
                        variant="bodyMedium"
                        style={[
                            styles.sheetDescription,
                            { color: colors.onSurfaceVariant },
                        ]}
                    >
                        Enter a label for your custom variable
                    </Text>

                    <BottomSheetTextInput
                        style={[
                            styles.customLabelInput,
                            {
                                color: colors.onSurface,
                                backgroundColor: colors.surfaceVariant,
                                borderColor: colors.outline,
                            },
                        ]}
                        value={customLabel}
                        onChangeText={setCustomLabel}
                        placeholder="e.g. protein, spice level"
                        placeholderTextColor={colors.onSurfaceVariant}
                        autoFocus
                    />

                    <Button
                        mode="contained"
                        onPress={handleInsertCustomVariable}
                        disabled={!customLabel.trim()}
                        style={styles.insertButton}
                    >
                        Insert{" "}
                        {customLabel.trim()
                            ? `{{${customLabel.trim().toLowerCase().replace(/\s+/g, "_")}}}`
                            : "Variable"}
                    </Button>
                </View>
            </BottomSheet>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    variablesContainer: {
        paddingTop: 12,
    },
    variablesContent: {
        paddingHorizontal: 16,
    },
    chip: {
        borderRadius: 10,
        marginRight: 4,
    },
    displayContainer: {
        flex: 1,
        paddingVertical: 24,
        paddingHorizontal: 18,
    },
    promptDisplay: {
        lineHeight: 36,
    },
    inputContainer: { flex: 1 },
    textInput: {
        borderRadius: 20,
        fontSize: 13,
        padding: 20,
    },
    sheetContent: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 8,
    },
    sheetTitle: {
        textAlign: "center",
        fontWeight: "600",
    },
    sheetDescription: {
        textAlign: "center",
        marginTop: 4,
        marginBottom: 20,
    },
    customLabelInput: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        marginBottom: 16,
    },
    insertButton: {
        borderRadius: 12,
    },
});
