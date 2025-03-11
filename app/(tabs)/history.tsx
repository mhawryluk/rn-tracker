import { FlatList, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { GoalContext } from '@/components/context/GoalContext';
import Colors from '@/constants/Colors';
import { useContext } from 'react';
import { TrackerContext } from '../../components/context/TrackerContext';

export default function HistoryTab() {
  const [trackerState] = useContext(TrackerContext);
  const [goalState] = useContext(GoalContext);

  return (
    <View style={styles.container}>
      <FlatList
        style={{ flexGrow: 0, width: '80%' }}
        data={trackerState.toReversed()}
        keyExtractor={(state, index) => `${state}_${index}`}
        renderItem={(value) => {
          const date = new Date(
            (new Date() as unknown as number) -
              1000 * 60 * 60 * 24 * value.index,
          );
          return (
            <Text
              style={{
                color: 'white',
                ...styles.title,
                padding: 20,
                width: '100%',
                backgroundColor:
                  value.item < goalState
                    ? Colors.light.tint
                    : Colors.light.lightTint,
                textAlign: 'center',
                borderRadius: 100,
                marginVertical: 10,
                opacity: (value.item / goalState) * 0.5 + 0.5,
              }}
            >
              {date.getDate()}/{date.getMonth()}/{date.getFullYear()}:{' '}
              {value.item}
            </Text>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
});
