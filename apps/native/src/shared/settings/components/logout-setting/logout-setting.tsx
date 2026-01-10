import { useRouter } from "expo-router";

import { supabase } from "@/core/supabase";

import { SettingItem } from "../setting-item";

export const LogoutSetting = () => {
  const router = useRouter();

  const handlePress = async () => {
    await supabase.auth.signOut();

    router.push("/welcome");
  };

  return <SettingItem icon="logout" title="Logout" onPress={handlePress} />;
};
