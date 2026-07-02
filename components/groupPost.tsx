import { StyleSheet, View, Text, Image, ScrollView, Dimensions, TouchableOpacity, Modal } from 'react-native';
import { useState } from 'react';
import groupImageRegistry from './groupImageRegistry';
import groupTextRegistry from './groupTextRegistry';
import IndividualPost from './individualPost';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  groupPath: string;
}

export default function GroupPost({ groupPath }: Props) {

  // Group data from registry
  const data = groupTextRegistry[groupPath];
  const images: any[] = groupImageRegistry[groupPath] ?? [];

  // State
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

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
          <TouchableOpacity key={i} style={styles.memberRow} onPress={() => setSelectedMember(path)}>
            <View style={styles.memberCircle} />
            <Text style={styles.memberName}>{path.split('/').pop()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Member profile modal */}
      <Modal
        visible={selectedMember !== null}
        animationType="slide"
        onRequestClose={() => setSelectedMember(null)}
      >
        <View style={styles.modalContainer}>

          {/* Back arrow */}
          <TouchableOpacity style={styles.backButton} onPress={() => setSelectedMember(null)}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          {/* Individual profile */}
          {selectedMember && <IndividualPost personPath={selectedMember} />}

        </View>
      </Modal>

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

  // Member row
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  memberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    marginRight: 12,
  },

  memberName: {
    fontSize: 16,
    color: '#000',
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },

  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },

  backArrow: {
    fontSize: 28,
    color: '#000',
  },

});
