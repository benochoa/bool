import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { authedSource } from '@/lib/storageAuth';
import { Image } from 'expo-image';
import React, { useRef } from 'react';
import {
  Dimensions, Share, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle,
} from 'react-native';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { GroupMember } from '@/lib/fetchGroup';
import { MemberRect } from './memberManagement';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Member row subcomponent — names arrive with the group fetch, no fetching here.
function MemberRow({ name, profilePicUrl, isGroupLeader, onPress, onLongPress }: {
  name: string; profilePicUrl: string | null; isGroupLeader: boolean;
  onPress: () => void; onLongPress?: (rect: MemberRect) => void;
}) {
  const rowRef = useRef<React.ComponentRef<typeof TouchableOpacity>>(null);
  return (
    <TouchableOpacity
      ref={rowRef}
      style={styles.memberRow}
      onPress={onPress}
      onLongPress={() => rowRef.current?.measureInWindow((x, y, width, height) => onLongPress?.({ x, y, width, height }))}
    >
      {profilePicUrl ? (
        <Image source={authedSource(profilePicUrl)} style={styles.memberCircle} contentFit="cover" />
      ) : (
        <View style={styles.memberCircle} />
      )}
      <Text style={styles.memberName}>{name}</Text>
      {isGroupLeader && (
        <View style={styles.crownWrap}>
          <FontAwesome6 name="crown" size={14} color="#000" solid />
        </View>
      )}
    </TouchableOpacity>
  );
}

// A blocked person's row: no name, no photo, and nothing to press — their post
// is exactly what a block is meant to put out of reach. Deliberately still a
// row rather than an omission, so the group's size stays honest. The crown is
// dropped with everything else: a name is recoverable from "the blocked one
// leads this group" if their group is one you already know.
function BlockedRow() {
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberCircle} />
      <Text style={styles.blockedName}>Blocked user</Text>
    </View>
  );
}

interface Props {
  members: GroupMember[];
  // Whoever wears the crown — groups.created_by.
  leaderId: string | null;
  onSelectMember: (id: string) => void;
  // Long-press to manage a member. Omit it and the rows are view-only, which
  // is what everywhere outside the group post's edit mode wants.
  onManageMember?: (member: GroupMember, rect: MemberRect) => void;
  // Renders the invite row beneath the members when set.
  inviteCode?: string | null;
  style?: StyleProp<ViewStyle>;
}

// The group's roster, as it appears at the bottom of a group post. Shared so
// the chat details modal shows exactly the same card.
export default function MembersCard({ members, leaderId, onSelectMember, onManageMember, inviteCode, style }: Props) {
  const { blockedIds } = useBlockedPeople();
  return (
    <View style={[styles.card, style]}>
      {members.map(m => (
        blockedIds.has(m.id) ? (
          <BlockedRow key={m.id} />
        ) : (
          <MemberRow
            key={m.id}
            name={m.name}
            profilePicUrl={m.profilePicUrl}
            isGroupLeader={m.id === leaderId}
            onPress={() => onSelectMember(m.id)}
            onLongPress={onManageMember ? (rect) => onManageMember(m, rect) : undefined}
          />
        )
      ))}
      {inviteCode && (
        <View style={styles.inviteRow}>
          <Text style={styles.inviteLabel}>Invite code: {inviteCode}</Text>
          <TouchableOpacity onPress={() => Share.share({ message: `Join my group on bool — use invite code ${inviteCode}` })}>
            <Text style={styles.shareText}>Share</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({

  // Unlike the Q&A cards, rows carry their own horizontal padding, so the card
  // itself only pads vertically.
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 16,
    overflow: 'hidden',
    paddingVertical: 16,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  memberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    marginRight: 12,
  },

  // Leader crown — pinned to the row's right edge, in line with the name.
  crownWrap: {
    position: 'absolute',
    right: 18,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  memberName: {
    ...Type.body,
    color: '#000',
  },

  // Grey and italic so the row reads as a placeholder rather than as somebody
  // who named themselves "Blocked user".
  blockedName: {
    ...Type.body,
    color: Palette.muted,
    fontStyle: 'italic',
  },

  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 16,
  },

  inviteLabel: {
    ...Type.label,
    color: '#555',
  },

  shareText: {
    ...Type.label,
    fontFamily: FontFamily.bold,
    color: '#43a047',
  },

});
