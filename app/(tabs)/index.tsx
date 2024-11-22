import { Pressable, StyleSheet, useColorScheme } from "react-native";

import { Text, View } from "@/components/Themed";
import { useContext } from "react";
import { TrackerContext } from "../_layout";
import Colors from "../../constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import { FlatList } from "react-native";

function TrackerVizPanel() {
  const [trackerState, _] = useContext(TrackerContext);

  return (
    <View style={styles.viz}>
      <FlatList
        style={{ flexGrow: 0 }}
        data={trackerState.toReversed()}
        keyExtractor={(state, index) => `${state}_${index}`}
        renderItem={(value) => (
          <Text
            style={{
              color: "white",
              ...styles.title,
              padding: 20,
            }}
          >
            {value.item}
          </Text>
        )}
      />
    </View>
  );
}

function TrackerInputPanel() {
  const [_, setTrackerState] = useContext(TrackerContext);
  const colorScheme = useColorScheme();

  return (
    <View style={styles.input}>
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

        <FontAwesome
          name="coffee"
          size={50}
          color={Colors[colorScheme ?? "light"].button}
          style={{
            verticalAlign: "middle",
            textAlign: "center",
            alignItems: "center",
          }}
        />

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
  },

  input: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  viz: {
    flex: 2,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.lightTint,
    borderRadius: 20,
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
  },

  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
});
