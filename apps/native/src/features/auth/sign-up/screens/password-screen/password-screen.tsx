import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, TextInput as RNTextInput, View } from "react-native";

import { supabase } from "@/core/supabase";
import { InputLayout } from "@/features/auth";
import { Button, PasswordInput } from "@/shared/ui";

import { PasswordRequirements } from "../../../components/password-requirements";
import { getPasswordRequirements } from "../../../utils/get-password-requirements";

export const PasswordScreen = () => {
  const { email } = useLocalSearchParams<{ email: string }>();

  const passwordRef = useRef<RNTextInput>(null);

  const router = useRouter();

  const [password, setPassword] = useState("");

  const [error, setError] = useState("");

  const validate = () => {
    if (!password) {
      setError("Password is required");
      return false;
    }

    const requirements = getPasswordRequirements(password);

    const allRequirementsMet = requirements.every((req) => req.met);

    if (!allRequirementsMet) {
      setError("Password does not meet all requirements");
      return false;
    }

    setError("");
    return true;
  };

  const handleContinue = async () => {
    const isValid = validate();

    if (!isValid) return;

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) Alert.alert("Login failed", error.message);

    if (router.canDismiss()) router.dismissAll();

    router.replace("/(onboarding)/details");
  };

  const handleChangeText = (patch: Record<string, string>) => {
    setPassword(patch.password);
  };

  return (
    <InputLayout
      description={
        <View style={{ paddingTop: 8 }}>
          <PasswordRequirements password={password} />
        </View>
      }
      input={
        <PasswordInput
          ref={passwordRef}
          error={error}
          value={password}
          onChangeText={(password) => handleChangeText({ password })}
          onSubmitEditing={handleContinue}
        />
      }
      button={
        <Button disabled={!password} onPress={handleContinue}>
          Continue
        </Button>
      }
    />
  );
};
