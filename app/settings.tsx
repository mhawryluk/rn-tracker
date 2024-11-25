import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet, TextInput } from "react-native";

import { Text, View } from "@/components/Themed";
import { useContext } from "react";
import { GoalContext } from "@/components/context/GoalContext";
import Colors from "@/constants/Colors";

export default function SettingsModal() {
  const [goalState, setGoalState] = useContext(GoalContext);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.title}>Goal: </Text>
        <TextInput
          style={styles.numberInput}
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

      <StatusBar style={Platform.OS === "ios" ? "light" : "auto"} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 20,
    fontWeight: "bold",
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

  numberInput: {
    fontSize: 20,
    fontWeight: "bold",
  },
});
