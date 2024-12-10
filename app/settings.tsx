import { StatusBar } from "expo-status-bar";
import { Platform, Pressable, StyleSheet, TextInput } from "react-native";

import { GoalContext } from "@/components/context/GoalContext";
import { TrackerContext } from "@/components/context/TrackerContext";
import { Text, View } from "@/components/Themed";
import Colors from "@/constants/Colors";
import { useContext } from "react";

export default function SettingsModal() {
  const [goalState, setGoalState] = useContext(GoalContext);
  const [_, setTrackerState] = useContext(TrackerContext);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.title}>Goal: </Text>
        <TextInput
          style={styles.text}
          keyboardType="numeric"
          defaultValue={String(goalState)}
          onChangeText={(value) => {
            const parsed = Number.parseInt(value);
            if (parsed && parsed > 0) {
              setGoalState(parsed);
            }
          }}
        />
      </View>

      <Pressable
        style={styles.button}
        onPress={() => {
          setTrackerState((list) => [...list.splice(0, list.length - 1), 0]);
        }}
      >
        {({ pressed }) => (
          <Text style={{ ...styles.text, opacity: pressed ? 0.5 : 1 }}>
            Reset today's count
          </Text>
        )}
      </Pressable>

      <StatusBar style={Platform.OS === "ios" ? "light" : "auto"} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },

  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },

  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },

  row: {
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    backgroundColor: Colors.light.lightTint,
    borderRadius: 15,
    padding: 20,
  },

  text: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },

  button: {
    backgroundColor: Colors.light.button,
    borderRadius: 15,
    padding: 15,
    fontSize: 15,
    color: "white",
  },
});
