import { Pressable, StyleSheet, useColorScheme } from "react-native";

import { View } from "@/components/Themed";
import { useContext } from "react";
import { TrackerContext } from "../_layout";
import Colors from "../../constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import TilesViz from "@/components/gpu-viz/TilesViz";

function TrackerVizPanel() {
  return (
    <View style={styles.viz}>
      <TilesViz />
    </View>
  );
}

function TrackerInputPanel() {
  const [_, setTrackerState] = useContext(TrackerContext);
  const colorScheme = useColorScheme();

  return (
    <View style={styles.input}>
      <View style={{ ...styles.row, gap: 50 }}>
        <FontAwesome
          name="coffee"
          size={50}
          color={Colors[colorScheme ?? "light"].button}
          style={{
            opacity: 0.4,
            verticalAlign: "middle",
            textAlign: "center",
            alignItems: "center",
          }}
        />

        <View style={styles.row}>
          <Pressable
            onPress={() =>
              setTrackerState((list) => [
                ...list.splice(0, list.length - 1),
                list[list.length - 1] - 1,
              ])
            }
          >
            {({ pressed }) => (
              <FontAwesome
                name="minus"
                style={{ ...styles.button, opacity: pressed ? 0.2 : 0.8 }}
              />
            )}
          </Pressable>

          <Pressable
            onPress={() =>
              setTrackerState((list) => [
                ...list.splice(0, list.length - 1),
                list[list.length - 1] + 1,
              ])
            }
          >
            {({ pressed }) => (
              <FontAwesome
                name="plus"
                style={{ ...styles.button, opacity: pressed ? 0.2 : 0.8 }}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function TrackerScreen() {
  return (
    <View style={styles.container}>
      <TrackerVizPanel />
      <TrackerInputPanel />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    gap: 50,
  },

  input: {
    padding: 30,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.lightTint,
    borderRadius: 20,
    width: "100%",
  },

  viz: {
    width: "100%",
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 20,
    overflow: "hidden",
  },

  button: {
    backgroundColor: Colors.light.button,
    borderRadius: 40,
    padding: 15,
    fontSize: 15,
    color: "white",
  },

  row: {
    flexDirection: "row",
    alignContent: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "inherit",
  },
});
