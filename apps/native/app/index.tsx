import { Redirect } from "expo-router";

import { useAuth, useProfile, useUser } from "../src/core/supabase";

export default function Screen() {
    const auth = useAuth();

    const user = useUser();

    const profile = useProfile();

    // Determine if we're ready to navigate
    const isReady =
        !auth.isLoading &&
        (auth.user ? !user.isLoading && !profile.isLoading : true);

    // Keep splash visible while loading
    if (!isReady) {
        return null;
    }

    // Not authenticated
    if (!auth.user || user.error) {
        return <Redirect href="/welcome" />;
    }

    // Check onboarding
    if (Boolean(profile.data) && !profile.data?.onboarding_completed) {
        return <Redirect href="/(onboarding)/details" />;
    }

    // Fully authenticated and onboarded
    return <Redirect href="/(tabs)" />;
}
