import GroupPost from '@/components/groupPost';
import { StyleSheet, View } from 'react-native';

export default function Test2Screen() {
  return (
    <View style={styles.container}>

      <GroupPost groupPath="Data/Groups/Group-1" />

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

});
