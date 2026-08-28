import { Image } from 'expo-image';
import { authedSource } from '@/lib/storageAuth';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SpeechBubble } from '@/assets/symbols/SpeechBubble';
import { FontFamily, Type } from '@/constants/theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
const CARD_HEIGHT = 200;

// The same red as the tab dots, so the unread count reads as the same "waiting
// on you" mark they do rather than as its own signal.
const ALERT_RED = '#FF3B30';

interface Props {
  groupName: string;
  firstImageUrl: string | null;
  suggesterPicUrl: string | null;
  onPress: () => void;
  hideSuggesterPic?: boolean;
  // A little more air under the tile. Pending and Sent read better looser than
  // the flat single list on Received.
  loose?: boolean;
  // Opens your own group's private discussion about this group. The button is
  // drawn whenever this is given, badge or no badge — it's a way in, not a
  // notification, so it can't come and go with the unread count.
  onOpenDiscussion?: () => void;
  // Unread messages in that discussion. 0 draws no badge.
  discussionUnread?: number;
}

export default function GroupPostPreview({ groupName, firstImageUrl, suggesterPicUrl, onPress, hideSuggesterPic, loose, onOpenDiscussion, discussionUnread = 0 }: Props) {
  return (
    <TouchableOpacity style={[styles.card, loose && styles.cardLoose]} onPress={onPress} activeOpacity={0.9}>

      {/* Photo layer */}
      {!firstImageUrl ? (
        <View style={styles.placeholder} />
      ) : (
        <Image source={authedSource(firstImageUrl)} style={styles.photo} contentFit="cover" />
      )}

      {/* Suggester profile pic — top-right, stays in color even on greyed-out tiles.
          Suppressed entirely on screens with no suggester to attribute (Received). */}
      {hideSuggesterPic ? null : suggesterPicUrl ? (
        <Image
          source={authedSource(suggesterPicUrl)}
          style={styles.suggesterPic}
          contentFit="cover"
        />
      ) : (
        <View style={styles.suggesterPicPlaceholder} />
      )}

      {/* Group name — bottom-left, over the photo. Stops short of the discussion
          button when there is one, so a long name doesn't run under it. */}
      <Text
        style={[styles.name, onOpenDiscussion && styles.nameBesideButton]}
        numberOfLines={1}
      >
        {groupName}
      </Text>

      {/* Bottom-right. Its own touchable inside the card's, so tapping the
          circle opens the discussion while tapping anywhere else opens the
          group. hitSlop because 40px is under the comfortable tap target and
          the card underneath will happily take the miss. */}
      {onOpenDiscussion && (
        <TouchableOpacity
          style={styles.discussionButton}
          onPress={onOpenDiscussion}
          activeOpacity={0.8}
          hitSlop={8}
        >
          <SpeechBubble size={20} color="#000" />
          {discussionUnread > 0 && (
            <View style={styles.discussionBadge}>
              <Text style={styles.discussionBadgeText}>
                {discussionUnread > 99 ? '99+' : discussionUnread}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#eee',
  },

  cardLoose: {
    marginBottom: 20,
  },

  photo: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },

  placeholder: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#ddd',
  },

  suggesterPic: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
  },

  suggesterPicPlaceholder: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#bbb',
  },

  name: {
    ...Type.title,
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Clears the 40px button plus its 12px margin, and a little air besides.
  nameBesideButton: {
    right: 64,
  },

  discussionButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hangs off the corner of the circle rather than sitting inside it, so the
  // icon stays centred whether or not there's a number on it.
  discussionBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: ALERT_RED,
    alignItems: 'center',
    justifyContent: 'center',
    // Separates the red from the white circle when the two overlap the photo.
    borderWidth: 1.5,
    borderColor: '#fff',
  },

  discussionBadgeText: {
    ...Type.caption,
    fontFamily: FontFamily.bold,
    fontSize: 11,
    color: '#fff',
  },
});