import { StyleSheet, View, Text, Image, ScrollView, Dimensions, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { fetchGroup, GroupData } from '../lib/fetchGroup';
import { fetchPerson } from '../lib/fetchPerson';
import IndividualPost from './individualPost';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  groupId: string;
}

function MemberRow({ personId, onPress }: { personId: string; onPress: () => void }) {
  const [name, setName] = useState('...');

  useEffect(() => {
    fetchPerson(personId).then(p => { if (p) setName(p.name); });
  }, [personId]);

  return (
    <TouchableOpacity style={styles.memberRow} onPress={onPress}>
      <View style={styles.memberCircle} />
      <Text style={styles.memberName}>{name}</Text>
    </TouchableOpacity>
  );
}

export default function GroupPost({ groupId }: Props) {

  // State
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  // Fetch group data from Firebase
  useEffect(() => {
    fetchGroup(groupId).then(result => {
      setData(result);
      setLoading(false);
    });
  }, [groupId]);

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Group name */}
      <View style={styles.card}>
        <Text style={styles.name}>{data?.name}</Text>
      </View>

      {/* Group pics - horizontal scroll */}
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {data?.imageUrls.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={styles.image} />
          ))}
        </ScrollView>
      </View>

      {/* Group Q&A - horizontal swipe one at a time */}
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

      {/* Group members */}
      <View style={styles.card}>
        {data?.members.map((personId, i) => (
          <MemberRow key={i} personId={personId} onPress={() => setSelectedMember(personId)} />
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
          {selectedMember && <IndividualPost personId={selectedMember} />}

        </View>
      </Modal>

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

  // Group name
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },

  // Group pics
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
