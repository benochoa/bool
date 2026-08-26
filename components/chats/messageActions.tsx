import { FontFamily, Type } from '@/constants/theme';
import { BlurView } from 'expo-blur';
import { ReactNode } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Where the pressed bubble sits on screen, from measureInWindow.
export interface BubbleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The tapbacks on offer. Order is fixed, so the bar is in the same place every
// time you open it.
export const REACTION_EMOJIS = ['❤️', '😂', '😭', '😡', '👍', '👎'];

interface Props {
  rect: BubbleRect;
  mine: boolean;
  canCopy: boolean;
  // Whatever this user already put on the message, so the bar can show it.
  myReaction: string | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onReport: () => void;
  onClose: () => void;
  // The same bubble the list drew, handed in so the copy can't drift from the
  // original.
  children: ReactNode;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GAP = 10;
const ACTION_HEIGHT = 48;
const ACTIONS_WIDTH = 200;
const EMOJI_SIZE = 52;
const BAR_PADDING = 6;
const BAR_WIDTH = REACTION_EMOJIS.length * EMOJI_SIZE + BAR_PADDING * 2;
const BAR_HEIGHT = EMOJI_SIZE + BAR_PADDING * 2;
// The bar is centred on the screen rather than hung off its bubble's edge: at
// this size it's most of the screen's width, so there's nowhere for it to hang
// that wouldn't just be pinned to a margin anyway.
const BAR_LEFT = (SCREEN_WIDTH - BAR_WIDTH) / 2;
// Room kept clear at either end, so a bubble at the very top or bottom of the
// thread still has its menu fully on screen.
const TOP_INSET = 80;
const BOTTOM_INSET = 40;

export default function MessageActions({
  rect, mine, canCopy, myReaction, onReact, onReply, onCopy, onDelete, onReport, onClose, children,
}: Props) {
  const actions = [
    { label: 'Reply', onPress: onReply, destructive: false },
    canCopy ? { label: 'Copy', onPress: onCopy, destructive: false } : null,
    mine ? { label: 'Delete', onPress: onDelete, destructive: true } : null,
    // Only somebody else's: reporting your own message reports you.
    mine ? null : { label: 'Report', onPress: onReport, destructive: true },
  ].filter(a => a !== null);

  // The bubble is lifted at the position it already occupies, unless the bar
  // above or the menu below wouldn't fit — then the whole stack slides just far
  // enough to. The lower bound wins a tie, since losing the bar off the top of
  // the screen is worse than losing the last action off the bottom.
  const actionsHeight = actions.length * ACTION_HEIGHT;
  const top = Math.max(
    TOP_INSET + BAR_HEIGHT + GAP,
    Math.min(rect.y, SCREEN_HEIGHT - BOTTOM_INSET - actionsHeight - GAP - rect.height)
  );

  return (
    <View style={styles.overlay}>
      {/* Everything behind goes soft, and a press anywhere on it closes. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      </Pressable>

      <View style={[styles.emojiBar, { top: top - GAP - BAR_HEIGHT }]}>
        {REACTION_EMOJIS.map(emoji => (
          <TouchableOpacity
            key={emoji}
            style={[styles.emojiButton, emoji === myReaction && styles.emojiButtonMine]}
            onPress={() => onReact(emoji)}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.bubbleHolder, { left: rect.x, top, width: rect.width }]}>
        {children}
      </View>

      {/* Aligned to the same edge as the bubble it belongs to, so it reads as
          hanging off that message rather than floating in the middle. */}
      <View
        style={[
          styles.actions,
          { top: top + rect.height + GAP },
          mine
            ? { left: rect.x + rect.width - ACTIONS_WIDTH }
            : { left: rect.x },
        ]}
      >
        {actions.map((action, i) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.action, i > 0 && styles.actionDivided]}
            onPress={action.onPress}
          >
            <Text style={[styles.actionText, action.destructive && styles.actionTextDestructive]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },

  bubbleHolder: {
    position: 'absolute',
  },

  emojiBar: {
    position: 'absolute',
    left: BAR_LEFT,
    flexDirection: 'row',
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    padding: BAR_PADDING,
    backgroundColor: '#fff',
    borderRadius: BAR_HEIGHT / 2,
  },

  emojiButton: {
    width: EMOJI_SIZE,
    height: EMOJI_SIZE,
    borderRadius: EMOJI_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // The one already on this message, circled so tapping it again to remove it
  // is an obvious move.
  emojiButtonMine: {
    backgroundColor: '#ececf7',
  },

  emoji: {
    fontSize: 30,
  },

  actions: {
    position: 'absolute',
    width: ACTIONS_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },

  action: {
    height: ACTION_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  actionDivided: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  actionText: {
    ...Type.body,
    color: '#000',
  },

  actionTextDestructive: {
    fontFamily: FontFamily.semiBold,
    color: '#FF3B30',
  },
});