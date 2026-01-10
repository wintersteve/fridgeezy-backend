import { View } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

import type { Message } from "../../hooks/use-step-explanation-store";

export interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble = (props: MessageBubbleProps) => {
  const { message } = props;
  const { colors } = useTheme();

  const isUser = message.role === "user";

  const formattedTime = new Date(message.timestamp).toLocaleTimeString(
    "en-US",
    {
      hour: "numeric",
      minute: "2-digit",
    },
  );

  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        backgroundColor: isUser ? colors.primary : colors.surfaceVariant,
        borderRadius: 16,
        borderBottomRightRadius: isUser ? 4 : 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxWidth: "80%",
        marginBottom: 4,
      }}
    >
      <Text
        variant="bodyMedium"
        style={{ color: isUser ? "#FFFFFF" : colors.onSurface }}
      >
        {message.content}
      </Text>

      <Text
        variant="labelSmall"
        style={{
          color: isUser ? "rgba(255, 255, 255, 0.7)" : colors.onSurfaceVariant,
          fontSize: 10,
          marginTop: 2,
          alignSelf: isUser ? "flex-end" : "flex-start",
        }}
      >
        {formattedTime}
      </Text>
    </View>
  );
};
