import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useMemo, useState } from "react";
import "react-native-reanimated";
import { Text } from "react-native";

import { GoalContext } from "@/components/context/GoalContext";
import { RootContext } from "@/components/context/RootContext";
import { TrackerContext } from "@/components/context/TrackerContext";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { useDevice } from "react-native-wgpu";
import tgpu from "typegpu/experimental";
import ConfettiViz from "@/components/gpu-viz/ConfettiViz";

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  const today = new Date(Date.now());
  const colorScheme = useColorScheme();
  const [trackerState, setTrackerState] = useState(
    Array(today.getDate())
      .fill(0)
      .map(() => Math.round(Math.random() * 10))
  );
  const [goalState, setGoalState] = useState<number>(10);

  const { device } = useDevice();
  const root = useMemo(
    () => (device ? tgpu.initFromDevice({ device }) : null),
    [device]
  );

  if (root === null) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <TrackerContext.Provider value={[trackerState, setTrackerState]}>
        <GoalContext.Provider value={[goalState, setGoalState]}>
          <RootContext.Provider value={root}>
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
            {trackerState[trackerState.length - 1] >= goalState ? (
              <ConfettiViz />
            ) : null}
          </RootContext.Provider>
        </GoalContext.Provider>
      </TrackerContext.Provider>
    </ThemeProvider>
  );
}
