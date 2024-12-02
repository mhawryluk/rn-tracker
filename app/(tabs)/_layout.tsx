import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import React from "react";
import { ColorSchemeName, Pressable } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { enableFreeze } from "react-native-screens";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

enableFreeze();

function SettingsModalLink({ colorScheme }: { colorScheme: ColorSchemeName }) {
  return (
    <Link href="/settings" asChild>
      <Pressable>
        {({ pressed }) => (
          <FontAwesome
            name="gear"
            size={25}
            color={Colors[colorScheme ?? "light"].tint}
            style={{ marginRight: 15, opacity: pressed ? 0.5 : 1 }}
          />
        )}
      </Pressable>
    </Link>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: Colors[colorScheme ?? "light"].background,
        },
        headerStyle: {
          backgroundColor: Colors[colorScheme ?? "light"].background,
        },
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          freezeOnBlur: true,
          title: "Tracker",
          tabBarIcon: ({ color }) => (
            <TabBarIcon name="sticky-note" color={color} />
          ),
          headerTintColor: Colors[colorScheme ?? "light"].tint,
          headerRight: () => <SettingsModalLink colorScheme={colorScheme} />,
        }}
      />
      <Tabs.Screen
        name="water"
        options={{
          title: "Water",
          freezeOnBlur: true,
          tabBarIcon: ({ color }) => <TabBarIcon name="glass" color={color} />,
          headerTintColor: Colors[colorScheme ?? "light"].tint,
          headerRight: () => <SettingsModalLink colorScheme={colorScheme} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          freezeOnBlur: true,
          tabBarIcon: ({ color }) => (
            <TabBarIcon name="clock-o" color={color} />
          ),
          headerTintColor: Colors[colorScheme ?? "light"].tint,
          headerRight: () => <SettingsModalLink colorScheme={colorScheme} />,
        }}
      />
    </Tabs>
  );
}
