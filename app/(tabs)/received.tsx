import { StyleSheet, View, Text } from 'react-native';

export default function ReceivedScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Received</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FF6600',
  },
});
