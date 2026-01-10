import { useRouter } from "expo-router";
import { useState } from "react";

import { useUserEmail } from "@/core/supabase";
import { Button, TextInput } from "@/shared/ui";

import { InputLayout } from "../../layouts/input-layout";

export const LoginScreen = () => {
  const router = useRouter();

  const [email, setEmail] = useState("");

  const [error, setError] = useState("");

  const userEmail = useUserEmail();

  const isValidEmail = (value: string) => {
    if (!value) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  const validate = () => {
    if (!email) {
      setError("Email is required");
      return false;
    }

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address");
      return false;
    }

    return true;
  };

  const handleContinue = async () => {
    const isValid = validate();

    if (!isValid) return;

    const hasUser = await userEmail.mutateAsync(email);

    if (hasUser) {
      router.push(`/(auth)/login/password?email=${email}`);
    } else {
      router.push(`/(auth)/sign-up/password?email=${email}`);
    }
  };

  const handleChangeText = (patch: Record<string, string>) => {
    setEmail(patch.email);
  };

  return (
    <InputLayout
      button={
        <Button
          disabled={!isValidEmail(email)}
          loading={userEmail.isPending}
          onPress={handleContinue}
        >
          Continue
        </Button>
      }
      input={
        <TextInput
          autoFocus
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="none"
          autoComplete="off"
          label="Email"
          autoCapitalize="none"
          placeholder="Enter your email address..."
          error={error}
          value={email}
          returnKeyType="next"
          onChangeText={(email) => handleChangeText({ email })}
          onSubmitEditing={handleContinue}
          blurOnSubmit={false}
        />
      }
      description="Enter your email address to continue. We’ll use it to create your
          account or log you in."
    />
  );
};
