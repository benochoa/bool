import { StyleSheet, View, Text, Image, ScrollView, Dimensions } from 'react-native';
import groupImageRegistry from './groupImageRegistry';
import groupTextRegistry from './groupTextRegistry';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  groupPath: string;
}

export default function GroupPost({ groupPath }: Props) {

  // Group data from registry
  const data = groupTextRegistry[groupPath];
  const images: any[] = groupImageRegistry[groupPath] ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Group name */}
      <View style={styles.card}>
        <Text style={styles.name}>{data?.name}</Text>
      </View>

      {/* Group pic - horizontal scroll */}
      <View style={styles.card}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
        >
          {images.map((src, i) => (
            <Image key={i} source={src} style={styles.image} />
          ))}
        </ScrollView>
      </View>

      {/* Group Q&A - horizontal swipe one at a time */}
      <View style={styles.card}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
        >
          {data?.qa.map((item, i) => (
            <View key={i} style={styles.qaItem}>
              <Text style={styles.question}>{item.question}</Text>
              <Text style={styles.answer}>{item.answer}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Group members */}
      <View style={styles.card}>
        {data?.members.map((path, i) => (
          <Text key={i} style={styles.memberPath}>{path}</Text>
        ))}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  content: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
  },

  // Shared card box
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    marginTop: 16,
    overflow: 'hidden',
    padding: 16,
  },

  // Group name
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },

  // Group pic
  image: {
    width: CARD_WIDTH - 32,
    height: 300,
    resizeMode: 'cover',
    borderRadius: 8,
  },

  // Group Q&A
  qaItem: {
    width: CARD_WIDTH - 32,
  },

  question: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },

  answer: {
    fontSize: 16,
    color: '#000',
    marginTop: 4,
  },

  // Group members
  memberPath: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },

});
