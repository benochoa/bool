import { StyleSheet, View, Text, Image, ScrollView, Dimensions } from 'react-native';
import individualImageRegistry from './individualImageRegistry';
import individualTextRegistry from './individualTextRegistry';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  personPath: string;
}

export default function IndividualPost({ personPath }: Props) {

  // Individual data from registry
  const data = individualTextRegistry[personPath];
  const images: any[] = individualImageRegistry[personPath] ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Name */}
      <View style={styles.card}>
        <Text style={styles.name}>{data?.name}</Text>
      </View>

      {/* Photos - horizontal scroll */}
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

      {/* Q&A - horizontal swipe one at a time */}
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

  // Name
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },

  // Photos
  image: {
    width: CARD_WIDTH - 32,
    height: 300,
    resizeMode: 'cover',
    borderRadius: 8,
  },

  // Q&A
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

});
