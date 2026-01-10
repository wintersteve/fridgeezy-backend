import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { createContext, ReactNode, useEffect, useState } from "react";

import { supabase } from "../../constants";

export interface AuthProviderProps {
  children: ReactNode;
}

type AuthContextType = {
  user: any;
  session: any;
  isLoading: boolean;
};

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

export const AuthProvider = (props: AuthProviderProps) => {
  const { children } = props;

  const queryClient = useQueryClient();

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  const { canDismiss, dismissAll, replace } = useRouter();

  useEffect(() => {
    // Set up auth state listener FIRST to avoid missing events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user || null);

      if (event === "SIGNED_OUT") {
        if (canDismiss()) dismissAll();
        queryClient.clear();
        replace("/welcome");
      }
    });

    // Then get the initial session from storage
    // Note: autoRefreshToken handles token refresh automatically
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user || null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
