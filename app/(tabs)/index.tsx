import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useState } from 'react';

export default function ExploreScreen() {

  // Personal / Group toggle
  const [activeTab, setActiveTab] = useState<'Personal' | 'Group'>('Personal');

  return (
    <View style={styles.container}>

      {/* Title */}
      <Text style={styles.title}>Explore</Text>

      {/* Personal / Group buttons */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'Personal' && styles.tabButtonActive]}
          onPress={() => setActiveTab('Personal')}
        >
          <Text style={[styles.tabText, activeTab === 'Personal' && styles.tabTextActive]}>Personal</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'Group' && styles.tabButtonActive]}
          onPress={() => setActiveTab('Group')}
        >
          <Text style={[styles.tabText, activeTab === 'Group' && styles.tabTextActive]}>Group</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({

  // Page layout
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#fff',
    paddingTop: 60,
  },

  // Title
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000',
  },

  // Personal / Group buttons
  tabRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 32,
  },

  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
  },

  tabButtonActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },

  tabText: {
    fontSize: 16,
    color: '#000',
  },

  tabTextActive: {
    color: '#fff',
  },

});
