import {
  StyleSheet, View, Text, Image, ScrollView, Dimensions,
  TouchableOpacity, Modal, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform
} from 'react-native';
import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/supabaseClient';
import { fetchGroup, GroupData } from '../lib/fetchGroup';
import { fetchPerson } from '../lib/fetchPerson';
import IndividualPost from './individualPost';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Helpers (editable mode only)
async function getNextGroupId(): Promise<string> {
  const { data } = await supabase.from('groups').select('id');
  const nums = (data ?? [])
    .map(row => row.id as string)
    .filter(id => /^Group-\d+$/.test(id))
    .map(id => parseInt(id.split('-')[1]));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `Group-${next}`;
}

async function fetchRandomGroupQuestions(): Promise<string[]> {
  const { data } = await supabase
    .from('questions')
    .select('questions')
    .eq('category', 'group')
    .single();
  const all: string[] = data?.questions ?? [];
  return [...all].sort(() => Math.random() - 0.5).slice(0, 3);
}

// Member row subcomponent
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

interface Props {
  groupId?: string;
  editable?: boolean;
  onClose?: () => void;
}

export default function GroupPost({ groupId, editable = false, onClose }: Props) {

  // State - read mode
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(!editable);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  // State - editable mode
  const [groupName, setGroupName] = useState('');
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '', '']);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [editingName, setEditingName] = useState(false);
  const [editingAnswerIndex, setEditingAnswerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fetch data (read mode) or questions (editable mode)
  useEffect(() => {
    if (editable) {
      fetchRandomGroupQuestions().then(qs => setQuestions(qs));
    } else if (groupId) {
      fetchGroup(groupId).then(result => {
        setData(result);
        setLoading(false);
      });
    }
  }, [groupId, editable]);

  async function pickPhoto(index: number) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const updated = [...photos];
      updated[index] = result.assets[0].uri;
      setPhotos(updated);
    }
  }

  async function handleSave() {
    if (!groupName.trim()) {
      Alert.alert('Missing name', 'Please enter a group name.');
      return;
    }
    setSaving(true);
    const newGroupId = await getNextGroupId();

    for (let i = 0; i < photos.length; i++) {
      const uri = photos[i];
      if (!uri) continue;
      const response = await fetch(uri);
      const blob = await response.blob();
      await supabase.storage
        .from('groups')
        .upload(`${newGroupId}/img${i + 1}.png`, blob, { contentType: 'image/png' });
    }

    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }));
    await supabase.from('groups').insert({ id: newGroupId, name: groupName.trim(), qa });

    setSaving(false);
    setSaved(true);
  }

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >

      {/* Back arrow (editable mode) */}
      {editable && onClose && (
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      )}

      {/* Name card */}
      <View style={styles.card}>
        {editable && (
          <TouchableOpacity style={styles.pencilButton} onPress={() => setEditingName(e => !e)}>
            <Text style={styles.pencil}>✏️</Text>
          </TouchableOpacity>
        )}
        {editable && editingName ? (
          <TextInput
            style={styles.nameInput}
            placeholder="Group name"
            placeholderTextColor="#aaa"
            value={groupName}
            onChangeText={setGroupName}
            autoFocus
          />
        ) : (
          <Text style={[styles.name, editable && !groupName && styles.placeholder]}>
            {editable ? (groupName || 'Group name') : data?.name}
          </Text>
        )}
      </View>

      {/* Photos card */}
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {editable ? (
            photos.map((uri, i) => (
              <View key={i} style={styles.photoSlot}>
                <TouchableOpacity style={styles.pencilButton} onPress={() => pickPhoto(i)}>
                  <Text style={styles.pencil}>✏️</Text>
                </TouchableOpacity>
                {uri ? (
                  <Image source={{ uri }} style={styles.image} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderText}>Tap to add photo</Text>
                  </View>
                )}
              </View>
            ))
          ) : (
            data?.imageUrls.map((url, i) => (
              <Image key={i} source={{ uri: url }} style={styles.image} />
            ))
          )}
        </ScrollView>
      </View>

      {/* Q&A card */}
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {editable ? (
            questions.map((q, i) => (
              <View key={i} style={styles.qaItem}>
                <TouchableOpacity style={styles.pencilButton} onPress={() => setEditingAnswerIndex(editingAnswerIndex === i ? null : i)}>
                  <Text style={styles.pencil}>✏️</Text>
                </TouchableOpacity>
                <Text style={styles.question}>{q}</Text>
                {editingAnswerIndex === i ? (
                  <TextInput
                    style={styles.answerInput}
                    placeholder="Your answer"
                    placeholderTextColor="#aaa"
                    value={answers[i]}
                    onChangeText={text => {
                      const updated = [...answers];
                      updated[i] = text;
                      setAnswers(updated);
                    }}
                    multiline
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.answer, !answers[i] && styles.placeholder]}>
                    {answers[i] || 'Tap to answer'}
                  </Text>
                )}
              </View>
            ))
          ) : (
            data?.qa.map((item, i) => (
              <View key={i} style={styles.qaItem}>
                <Text style={styles.question}>{item.question}</Text>
                <Text style={styles.answer}>{item.answer}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Members card */}
      <View style={styles.card}>
        {editable ? (
          <Text style={styles.membersPlaceholder}>Members — coming soon</Text>
        ) : (
          data?.members.map((personId, i) => (
            <MemberRow key={i} personId={personId} onPress={() => setSelectedMember(personId)} />
          ))
        )}
      </View>

      {/* Save button (editable mode) */}
      {editable && !saved && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>✓</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Member profile modal (read mode) */}
      {!editable && (
        <Modal
          visible={selectedMember !== null}
          animationType="slide"
          onRequestClose={() => setSelectedMember(null)}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity style={styles.backButton} onPress={() => setSelectedMember(null)}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            {selectedMember && <IndividualPost personId={selectedMember} />}
          </View>
        </Modal>
      )}

    </ScrollView>
    </KeyboardAvoidingView>
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
    paddingBottom: 100,
  },

  // Shared card
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

  pencilButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },

  pencil: {
    fontSize: 18,
  },

  // Name
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },

  nameInput: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 4,
  },

  placeholder: {
    color: '#aaa',
  },

  // Photos
  photoSlot: {
    width: CARD_WIDTH - 32,
  },

  image: {
    width: CARD_WIDTH - 32,
    height: 300,
    resizeMode: 'cover',
    borderRadius: 8,
  },

  photoPlaceholder: {
    width: CARD_WIDTH - 32,
    height: 300,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoPlaceholderText: {
    color: '#aaa',
    fontSize: 16,
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

  answerInput: {
    fontSize: 16,
    color: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginTop: 4,
    paddingVertical: 4,
  },

  // Members
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

  membersPlaceholder: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
  },

  // Save button
  saveButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },

  saveButtonText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },

  // Modal / back
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