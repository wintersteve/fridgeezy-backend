import { useState } from "react";
import { View } from "react-native";
import {
  Text,
  TextInput as RNPTextInput,
  TextInputProps as RNPTextInputProps,
} from "react-native-paper";

import { useTheme } from "@/shared/theme";

export interface TextInputProps
  extends Omit<RNPTextInputProps, "error" | "label"> {
  error?: string;
  icon?: string;
  label?: string;
}

export const TextInput = (props: TextInputProps) => {
  const { error = false, icon, label, mode = "flat", value, ...rest } = props;

  const { colors } = useTheme();

  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={{ flexGrow: 1 }}>
      {error && (
        <Text
          variant="labelSmall"
          style={{ color: colors.error, marginLeft: 1, marginBottom: 6 }}
        >
          {error}
        </Text>
      )}
      <RNPTextInput
        autoCapitalize="none"
        value={value}
        style={{ marginHorizontal: -4 }}
        mode="outlined"
        keyboardAppearance="light"
        outlineStyle={[
          { backgroundColor: "transparent" },
          mode === "flat"
            ? {
                backgroundColor: colors.surface,
                borderColor: isFocused
                  ? colors.onSurface
                  : colors.surfaceDisabled,
                borderWidth: 1,
                borderRadius: 20,
              }
            : {
                borderColor: isFocused
                  ? colors.secondaryContainer
                  : colors.onSurfaceVariant,
                borderRadius: 20,
                borderWidth: 4,
              },
          error && { borderColor: colors.error },
        ]}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        left={
          icon && (
            <RNPTextInput.Icon
              color={colors.onSurfaceVariant}
              size={20}
              icon={icon}
            />
          )
        }
        {...rest}
        placeholder={label}
        placeholderTextColor={
          isFocused ? colors.onSurface : colors.onSurfaceVariant
        }
        textColor={isFocused ? colors.onSurface : colors.onSurfaceVariant}
        contentStyle={{
          fontFamily: "Poppins_500Medium",
          fontSize: 11,
          left: icon ? -12 : 4,
        }}
        theme={{ colors: { primary: colors.onBackground } }}
      />
    </View>
  );
};
