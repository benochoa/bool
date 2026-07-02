import { StyleSheet, View } from 'react-native';
import IndividualPost from '@/components/individualPost';

export default function TestScreen() {
  return (
    <View style={styles.container}>

      <IndividualPost personPath="Data/People/Voelk" />

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

});
