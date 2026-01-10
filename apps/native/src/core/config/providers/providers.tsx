import "react-native-reanimated";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PropsWithChildren } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { QueryClientProvider } from "@/core/react-query";
import { AuthProvider } from "@/core/supabase";
import { ThemeProvider } from "@/shared/theme";

export const Providers = (props: PropsWithChildren) => {
  const { children } = props;

  return (
    <ThemeProvider>
      <GestureHandlerRootView>
        <QueryClientProvider>
          <BottomSheetModalProvider>
            {/*<RevenuecatProviders>*/}
            {/*  <AuthProvider>{children}</AuthProvider>*/}
            {/*</RevenuecatProviders>*/}
            <AuthProvider>{children}</AuthProvider>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
};
