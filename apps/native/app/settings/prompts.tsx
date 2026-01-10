import { useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { IconButton } from "react-native-paper";

import {
    useDeletePrompt,
    usePrompts,
    useReorderPrompts,
} from "../../src/core/supabase";
import { Tables } from "../../src/shared/supabase/types";
import { Button, EmptyCard, ScrollView, Section } from "../../src/shared/ui";
import { PromptCard } from "../../src/shared/ui/components/prompt-card";

type Prompt = Tables<"prompts">;

export default function PromptsScreen() {
    const navigation = useNavigation();
    const router = useRouter();

    const prompts = usePrompts();
    const deletePrompt = useDeletePrompt();
    const reorderPrompts = useReorderPrompts();

    const sortedPrompts = [...(prompts.data ?? [])].sort(
        (a, b) => a.position - b.position
    );

    const canAddMore = sortedPrompts.length < 3;

    useEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <IconButton
                    icon="plus-thick"
                    size={20}
                    onPress={handleOpenAdd}
                    disabled={!canAddMore}
                    style={{ margin: 0 }}
                />
            ),
        });
    }, [navigation, canAddMore]);

    const handleOpenAdd = () => {
        router.push("/settings/prompt-create");
    };

    const handleOpenEdit = (prompt: Prompt) => {
        router.push(`/settings/prompt-create?id=${prompt.id}`);
    };

    const handleDelete = (prompt: Prompt) => {
        Alert.alert(
            "Delete Prompt",
            "Are you sure you want to delete this prompt?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deletePrompt.mutate(prompt.id),
                },
            ]
        );
    };

    const handleMoveUp = (index: number) => {
        if (index <= 0) return;

        const current = sortedPrompts[index];
        const above = sortedPrompts[index - 1];

        reorderPrompts.mutate([
            { id: current.id, position: above.position },
            { id: above.id, position: current.position },
        ]);
    };

    const handleMoveDown = (index: number) => {
        if (index >= sortedPrompts.length - 1) return;

        const current = sortedPrompts[index];
        const below = sortedPrompts[index + 1];

        reorderPrompts.mutate([
            { id: current.id, position: below.position },
            { id: below.id, position: current.position },
        ]);
    };

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView}>
                <Section
                    title={`${sortedPrompts.length} of 3 Prompts`}
                    style={styles.section}
                >
                    {sortedPrompts.length === 0 ? (
                        <EmptyCard
                            title="Empty"
                            description="You don't have any prompts at the moment. Press add a prompt."
                        ></EmptyCard>
                    ) : (
                        <View>
                            {sortedPrompts.map((item, index) => (
                                <PromptCard
                                    key={item.id}
                                    prompt={item.prompt}
                                    isFirst={index === 0}
                                    isLast={index === sortedPrompts.length - 1}
                                    onMoveUp={() => handleMoveUp(index)}
                                    onMoveDown={() => handleMoveDown(index)}
                                    onDelete={() => handleDelete(item)}
                                    onPress={() => handleOpenEdit(item)}
                                />
                            ))}
                        </View>
                    )}
                </Section>
            </ScrollView>
            <Button
                compact
                onPress={handleOpenAdd}
                style={{ marginHorizontal: 12, marginBottom: 40 }}
            >
                Add a Prompt
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    section: {
        marginHorizontal: 12,
        marginTop: 8,
    },
    emptyCard: {
        padding: 24,
        alignItems: "center",
    },
});
