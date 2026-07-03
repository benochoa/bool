import { StyleSheet, View, Text, Image, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { fetchPerson, PersonData } from '../lib/fetchPerson';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  personId: string;
}

export default function IndividualPost({ personId }: Props) {

  // State
  const [data, setData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch person data from Firebase
  useEffect(() => {
    fetchPerson(personId).then(result => {
      setData(result);
      setLoading(false);
    });
  }, [personId]);

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Name */}
      <View style={styles.card}>
        <Text style={styles.name}>{data?.name}</Text>
      </View>

      {/* Photos - horizontal scroll */}
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {data?.imageUrls.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={styles.image} />
          ))}
        </ScrollView>
      </View>

      {/* Q&A - horizontal swipe one at a time */}
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
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

  loader: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 100,
  },

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
