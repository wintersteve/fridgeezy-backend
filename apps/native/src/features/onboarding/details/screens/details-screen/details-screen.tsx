import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useProfile, useUpdateProfile } from "@/core/supabase";
import { InputLayout } from "@/features/auth";
import { Button, TextInput } from "@/shared/ui";

export const DetailsScreen = () => {
  const router = useRouter();

  const profile = useProfile();

  const updateProfile = useUpdateProfile();

  const [name, setName] = useState(profile.data?.display_name ?? "");

  const [error, setError] = useState("");

  const validate = () => {
    if (!name) {
      setError(!name ? "Name is required" : "");
      return false;
    }

    return true;
  };

  const handleContinue = async () => {
    const isValid = validate();

    if (!isValid) return;

    await updateProfile.mutateAsync({ display_name: name });

    router.push("/(onboarding)/preferences");
  };

  const handleChangeText = (patch: Record<string, string>) => {
    setName(patch.email);
  };

  useEffect(() => {
    setName(profile.data?.display_name ?? "");
    // eslint-disable-next-line
  }, [profile.data?.id]);

  return (
    <InputLayout
      description="Tell us what you’d like to be called in the app, chef."
      input={
        <TextInput
          autoFocus
          autoCorrect={false}
          textContentType="none"
          autoComplete="off"
          label="Name"
          autoCapitalize="none"
          placeholder="Enter your email address..."
          error={error}
          value={name}
          onChangeText={(email) => handleChangeText({ email })}
          onSubmitEditing={handleContinue}
          blurOnSubmit={false}
        />
      }
      button={
        <Button disabled={!name} onPress={handleContinue}>
          Continue
        </Button>
      }
    />
  );
};
