import { StyleSheet, View } from 'react-native';
import IndividualPost from '@/components/individualPost';

export default function TestScreen() {
  return (
    <View style={styles.container}>

      <IndividualPost personId="Person-1" />

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

});
