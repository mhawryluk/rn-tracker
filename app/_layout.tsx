import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useState } from "react";
import React from "react";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import { TrackerContext } from "@/components/context/TrackerContext";
import { GoalContext } from "@/components/context/GoalContext";
import Colors from "@/constants/Colors";

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: "(tabs)",
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const today = new Date(Date.now());
  const colorScheme = useColorScheme();
  const [trackerState, setTrackerState] = useState(
    Array(today.getDate())
      .fill(0)
      .map(() => Math.round(Math.random() * 10))
  );
  const [goalState, setGoalState] = useState<number>(10);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <TrackerContext.Provider value={[trackerState, setTrackerState]}>
        <GoalContext.Provider value={[goalState, setGoalState]}>
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: Colors[colorScheme ?? "light"].background,
              },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="settings"
              options={{ presentation: "modal", title: "Settings" }}
            />
          </Stack>
        </GoalContext.Provider>
      </TrackerContext.Provider>
    </ThemeProvider>
  );
}
