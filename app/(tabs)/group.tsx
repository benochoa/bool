import { StyleSheet, View, Text, TouchableOpacity, Modal } from 'react-native';
import { useState } from 'react';
import GroupPost from '@/components/groupPost';

export default function GroupScreen() {

  // State
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  return (
    <View style={styles.container}>

      {/* Green circle button */}
      <TouchableOpacity style={styles.addButton} onPress={() => setMenuOpen(o => !o)}>
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>

      {/* Dropdown menu */}
      {menuOpen && (
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuText}>Join a group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setCreating(true); }}>
            <Text style={styles.menuText}>Create a group</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Empty state */}
      <Text style={styles.emptyText}>You are not in any groups yet. Create one or join your friends!</Text>

      {/* Create group modal */}
      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <GroupPost editable={true} onClose={() => setCreating(false)} />
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },

  // Green circle
  addButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
  },

  addButtonText: {
    fontSize: 28,
    color: '#fff',
    lineHeight: 32,
  },

  // Dropdown
  menu: {
    position: 'absolute',
    top: 112,
    left: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },

  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },

  menuText: {
    fontSize: 16,
    color: '#000',
  },

  // Empty state
  emptyText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    paddingHorizontal: 40,
  },

});