import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, TextInput as RNTextInput } from "react-native";

import { supabase } from "@/core/supabase";
import { InputLayout } from "@/features/auth";
import { Button, PasswordInput } from "@/shared/ui";

export const PasswordScreen = () => {
  const [isLoading, setIsLoading] = useState(false);

  const { email } = useLocalSearchParams<{ email: string }>();

  const passwordRef = useRef<RNTextInput>(null);

  const { canDismiss, dismissAll, replace } = useRouter();

  const [form, setForm] = useState({ email, password: "" });

  const [error, setError] = useState({ email: "", password: "" });

  const validate = () => {
    if (!form.email || !form.password) {
      setError({
        email: !form.email ? "Email is required" : "",
        password: !form.password ? "Password is required" : "",
      });
      return false;
    }
    return true;
  };

  const handleLogin = async () => {
    const isValid = validate();
    if (isValid) {
      setIsLoading(true);
      setError({ email: "", password: "" });

      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (error) {
        Alert.alert("Login failed", error.message);
        setIsLoading(false);
      } else {
        setIsLoading(false);
        if (canDismiss()) dismissAll();
        replace("/");
      }
    }
  };

  const handleChangeText = (patch: Record<string, string>) => {
    setForm({ ...form, ...patch });
  };

  return (
    <InputLayout
      button={
        <Button
          disabled={!form.password}
          loading={isLoading}
          onPress={handleLogin}
        >
          Log in
        </Button>
      }
      input={
        <PasswordInput
          ref={passwordRef}
          error={error.password}
          value={form.password}
          onChangeText={(password) => handleChangeText({ password })}
          onSubmitEditing={handleLogin}
        />
      }
      description="Good to see you again! Enter your password to access your account."
    />
  );
};
