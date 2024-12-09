import { FontAwesome } from "@expo/vector-icons";
import { useContext } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
} from "react-native";

import { GoalContext } from "@/components/context/GoalContext";
import { TrackerContext } from "@/components/context/TrackerContext";
import BoxesViz from "@/components/gpu-viz/BoxesViz";
import TilesViz from "@/components/gpu-viz/TilesViz";
import { useBuffer, useRoot } from "@/components/gpu/utils";
import { View } from "@/components/Themed";
import { u32 } from "typegpu/data";
import Colors from "../../constants/Colors";

function TrackerVizPanel() {
  const [goalState] = useContext(GoalContext);
  const goalBuffer = useBuffer(u32, goalState, ["uniform"], "goal");

  return (
    <View style={styles.vizPanel}>
      <ScrollView
        horizontal
        pagingEnabled
        persistentScrollbar
        showsHorizontalScrollIndicator
        scrollEnabled
      >
        <View style={styles.vizContainer}>
          <Text style={{ ...styles.boldText, paddingLeft: 20 }}>Today</Text>
          <View style={styles.viz}>
            <BoxesViz goalBuffer={goalBuffer} />
          </View>
        </View>
        <View style={styles.vizContainer}>
          <Text style={{ ...styles.boldText, paddingLeft: 20 }}>
            This month
          </Text>
          <View style={styles.viz}>
            <TilesViz goalBuffer={goalBuffer} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function TrackerInputPanel() {
  const [_, setTrackerState] = useContext(TrackerContext);
  const colorScheme = useColorScheme();

  // console.log(setTrackerState, colorScheme);

  return (
    <View style={styles.input}>
      <View style={{ ...styles.row, gap: 50 }}>
        <FontAwesome
          name="book"
          size={50}
          color={Colors[colorScheme ?? "light"].button}
          style={{
            verticalAlign: "middle",
            textAlign: "center",
            alignItems: "center",
          }}
        />

        <View style={styles.row}>
          <Pressable
            style={styles.buttonContainer}
            onPress={() =>
              setTrackerState((list) => [
                ...list.splice(0, list.length - 1),
                Math.max(0, list[list.length - 1] - 1),
              ])
            }
          >
            {({ pressed }) => (
              <FontAwesome
                name="minus"
                style={{ ...styles.button, opacity: pressed ? 0.2 : 1 }}
              />
            )}
          </Pressable>

          <Pressable
            style={styles.buttonContainer}
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
                style={{ ...styles.button, opacity: pressed ? 0.2 : 1 }}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function TrackerScreen() {
  const [trackerState] = useContext(TrackerContext);
  const [goalState] = useContext(GoalContext);
  const root = useRoot();

  // console.log(trackerState, goalState, root);

  return (
    <View style={styles.container}>
      <TrackerVizPanel />
      <View style={{ width: "100%", alignItems: "center", gap: 40 }}>
        <Text style={styles.boldText}>
          Count: {trackerState[trackerState.length - 1]}/{goalState}
        </Text>
        <TrackerInputPanel />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 20,
    paddingTop: 0,
  },

  input: {
    padding: 30,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.lightTint,
    borderRadius: 20,
    width: "100%",
  },

  vizPanel: {
    flex: 1,
  },

  vizContainer: {
    paddingVertical: 40,
    justifyContent: "space-between",
  },

  viz: {
    width: Dimensions.get("window").width - 40,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },

  button: {
    backgroundColor: Colors.light.button,
    borderRadius: 40,
    padding: 15,
    fontSize: 15,
    color: "white",
  },

  buttonContainer: {
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  row: {
    flexDirection: "row",
    alignContent: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "inherit",
  },

  boldText: {
    fontWeight: "bold",
    fontSize: 20,
    color: Colors.light.tint,
  },
});
