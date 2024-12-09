import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Dispatch, useEffect, useMemo, useState } from "react";
import React, { createContext, type SetStateAction } from "react";
import "react-native-reanimated";

export const TrackerContext = createContext<
  [number[], Dispatch<SetStateAction<number[]>>]
>([[], () => {}]);

import { useColorScheme } from "@/components/useColorScheme";
import { useDevice } from "react-native-wgpu";
import tgpu from "typegpu/experimental";
import { RootContext } from "@/components/context/RootContext";
import ConfettiViz from "@/components/gpu-viz/ConfettiViz";

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
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const [trackerState, setTrackerState] = useState<number[]>([
    3, 2, 8, 0, 7, 0,
  ]);

  const { device } = useDevice();
  const root = useMemo(
    () => (device ? tgpu.initFromDevice({ device }) : null),
    [device]
  );

  if (root === null) {
    return null;
  }

  return (
    <RootContext.Provider value={root}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <TrackerContext.Provider value={[trackerState, setTrackerState]}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="settings"
              options={{ presentation: "modal", title: "Settings" }}
            />
          </Stack>
          {true ? <ConfettiViz /> : null}
        </TrackerContext.Provider>
      </ThemeProvider>
    </RootContext.Provider>
  );
}
