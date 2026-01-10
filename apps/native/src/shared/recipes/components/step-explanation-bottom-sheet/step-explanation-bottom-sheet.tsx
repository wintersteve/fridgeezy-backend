import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { useTheme } from "@/shared/theme";
import { BottomSheet, TextInput } from "@/shared/ui";

import { useStepExplanationStore } from "../../hooks/use-step-explanation-store";
import { ChatMessageList } from "../chat-message-list";

import type { RefObject } from "react";

export interface StepExplanationBottomSheetProps {
  recipeId: string;
  recipeName: string;
  stepNumber: number | null;
  instruction: string | null;
  visible: boolean;
  onDismiss: () => void;
  ref?: RefObject<BottomSheetModal | null>;
}

export const StepExplanationBottomSheet = (
  props: StepExplanationBottomSheetProps,
) => {
  const { recipeId, stepNumber, instruction, visible, onDismiss, ref } = props;

  const { colors } = useTheme();

  const stepExplanationStore = useStepExplanationStore();

  const [inputText, setInputText] = useState("");

  const scrollViewRef = useRef<ScrollView>(null);

  // Get messages for this specific step
  const chatKey =
    recipeId && stepNumber != null ? `${recipeId}-${stepNumber}` : "";

  const messages = stepExplanationStore.messages[chatKey] || [];

  const isStreaming = messages.some((m) => m.isStreaming);

  const handleSend = () => {
    if (!inputText.trim() || !recipeId || stepNumber == null) return;

    // Add user message
    stepExplanationStore.addMessage(recipeId, stepNumber, {
      role: "user",
      content: inputText.trim(),
      timestamp: Date.now(),
    });

    setInputText("");

    // Scroll to bottom after brief delay
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    // TODO: Future - trigger SSE request for AI response
  };

  useEffect(() => {
    if (visible && stepNumber != null && instruction != null) {
      ref?.current?.present();
    } else {
      ref?.current?.dismiss();
    }
  }, [visible, stepNumber, instruction, ref]);

  if (stepNumber == null || instruction == null) return null;

  return (
    <BottomSheet
      enablePanDownToClose
      ref={ref}
      snapPoints={["90%"]}
      onDismiss={onDismiss}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView>
          <View style={{ flexGrow: 1 }}>
            <ChatMessageList
              messages={messages}
              scrollViewRef={scrollViewRef}
            />
          </View>
          <View
            style={{
              borderTopColor: colors.outlineVariant,
              paddingHorizontal: 16,
              paddingTop: 12,
              backgroundColor: colors.surface,
            }}
          >
            <TextInput
              autoFocus
              maxLength={500}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ask about this step..."
              disabled={isStreaming}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
};
