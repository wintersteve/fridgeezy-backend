import { useState } from "react";
import { TextInput as RNPTextInput } from "react-native-paper";

import { TextInput, TextInputProps } from "../text-input";

export type PasswordInputProps = TextInputProps;

export const PasswordInput = (props: PasswordInputProps) => {
  const { error, ref, value, onChangeText, onSubmitEditing } = props;

  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextInput
      autoFocus
      secureTextEntry={!isVisible}
      label="Password"
      textContentType="password"
      placeholder="Enter your password..."
      blurOnSubmit={false}
      ref={ref}
      error={error}
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmitEditing}
      right={
        <RNPTextInput.Icon
          icon={isVisible ? "eye-off" : "eye"}
          style={{ right: 4 }}
          onPress={() => setIsVisible(!isVisible)}
        />
      }
    />
  );
};
