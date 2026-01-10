import { ExpoRoot } from "expo-router";
import { useMemo } from "react";

export default function App() {
    const ctx = useMemo(() => require.context("./", true), []);
    return <ExpoRoot context={ctx} />;
}
