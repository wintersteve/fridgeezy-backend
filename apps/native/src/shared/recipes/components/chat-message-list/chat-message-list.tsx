import { useEffect } from "react";
import { ScrollView, View } from "react-native";

import { EmptyCard } from "@/shared/ui";

import { MessageBubble } from "../message-bubble";

import type { Message } from "../../hooks/use-step-explanation-store";
import type { RefObject } from "react";

export interface ChatMessageListProps {
  messages: Message[];
  scrollViewRef: RefObject<ScrollView>;
}

export const ChatMessageList = (props: ChatMessageListProps) => {
  const { messages, scrollViewRef } = props;

  useEffect(() => {
    const scrollToBottom = () => {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    };

    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollViewRef]);

  if (messages.length === 0) {
    return (
      <View style={{ marginHorizontal: 12 }}>
        <EmptyCard
          icon="comment-question"
          title="Chat"
          description="Ask me anything about this step"
        />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 6,
      }}
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </ScrollView>
  );
};
