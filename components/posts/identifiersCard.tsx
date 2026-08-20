import { FontFamily, Palette, Type } from '@/constants/theme';
import {
  CITIES, COLLEGES, GROUP_AGE_OPTIONS, GROUP_GENDER_OPTIONS, Identifiers,
  PERSON_AGE_OPTIONS, PERSON_GENDER_OPTIONS, suggest,
} from '@/lib/identifiers';
import { BirthdayCake } from '@/assets/symbols/BirthdayCake';
import { GraduationCap } from '@/assets/symbols/GraduationCap';
import { Person } from '@/assets/symbols/Person';
import { Skyscraper } from '@/assets/symbols/Skyscraper';
import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// The icons stand in for the labels, so they're drawn at text weight rather
// than as decoration.
const ICON_SIZE = 27;
const ICON_COLOR = '#555';

// Four fields, same for a person and a group — only the age and gender options
// differ.
const FIELDS = ['Age', 'Gender', 'City', 'College'] as const;
type Field = typeof FIELDS[number];

interface ViewProps {
  identifiers: Identifiers;
}

// View mode: one bar, each field an icon beside its value, divided from the
// next. No written labels — a cake, a head, a skyline and a mortarboard say
// which is which, and four labels wouldn't fit across a card anyway. College is
// the one optional field, so it drops out entirely when unset.
const ICONS = {
  Age: BirthdayCake,
  Gender: Person,
  City: Skyscraper,
  College: GraduationCap,
} as const;

export function IdentifiersView({ identifiers }: ViewProps) {
  // Two rows of two, pairing a short value with a long one: age and gender need
  // a few characters, city and college need room, so each row spends its width
  // where it's needed instead of splitting evenly four ways.
  function item(field: Field, value: string | null, wide: boolean) {
    if (!value) return null;
    const Icon = ICONS[field];
    return (
      <View style={[styles.viewItem, wide ? styles.viewItemWide : styles.viewItemNarrow]}>
        <Icon size={ICON_SIZE} color={ICON_COLOR} />
        <Text style={styles.viewValue} numberOfLines={1}>{value}</Text>
      </View>
    );
  }

  function row(left: ReactNode, right: ReactNode) {
    if (!left && !right) return null;
    return (
      <View style={styles.viewRow}>
        {left}
        {/* Only between two present values — a missing College leaves Gender
            alone on its row rather than trailing a rule. */}
        {left && right && <View style={styles.viewDivider} />}
        {right}
      </View>
    );
  }

  const topRow = row(item('Age', identifiers.age, false), item('City', identifiers.city, true));
  const bottomRow = row(item('Gender', identifiers.gender, false), item('College', identifiers.college, true));

  return (
    <View style={styles.viewCard}>
      {topRow}
      {/* A rule under each column rather than one across the card, so it
          separates age from gender and city from college without cutting
          through the gap between the two halves. Each segment appears only
          where there's something on both sides of it. */}
      {topRow && bottomRow && (
        <View style={styles.viewRow}>
          <View style={styles.viewItemNarrow}>
            {identifiers.age && identifiers.gender && <View style={styles.viewHLine} />}
          </View>
          <View style={styles.viewDividerGap} />
          <View style={styles.viewItemWide}>
            {identifiers.city && identifiers.college && <View style={styles.viewHLine} />}
          </View>
        </View>
      )}
      {bottomRow}
    </View>
  );
}

interface EditProps {
  identifiers: Identifiers;
  onChange: (next: Identifiers) => void;
  // A group's ages are bands; a person's are single years.
  variant: 'person' | 'group';
  // Lets the post scroll this card clear of the keyboard, the way Q&A does.
  onFocusField?: () => void;
}

// Edit mode: four rows, each opening its own picker in place. Only one is ever
// open — the card is 224pt tall in the reorder slot, so an open picker takes
// the space the other rows were using rather than making the card taller.
export function IdentifiersEdit({ identifiers, onChange, variant, onFocusField }: EditProps) {
  const [open, setOpen] = useState<Field | null>(null);
  // What's been typed into a type-ahead but not yet committed to a value.
  const [query, setQuery] = useState('');

  const ageOptions = variant === 'person' ? PERSON_AGE_OPTIONS : GROUP_AGE_OPTIONS;
  const genderOptions = variant === 'person' ? PERSON_GENDER_OPTIONS : GROUP_GENDER_OPTIONS;

  function choose(field: Field, value: string) {
    const key = field.toLowerCase() as keyof Identifiers;
    onChange({ ...identifiers, [key]: value });
    setOpen(null);
    setQuery('');
  }

  function openField(field: Field) {
    setOpen(field);
    // The type-aheads start from what's already there, so reopening City to
    // fix a typo doesn't mean retyping it.
    setQuery(field === 'City' ? identifiers.city ?? '' : field === 'College' ? identifiers.college ?? '' : '');
    onFocusField?.();
  }

  // A fixed list — age and gender.
  function renderOptions(field: Field, options: string[]) {
    return (
      <ScrollView style={styles.optionList} keyboardShouldPersistTaps="handled">
        <View style={styles.optionWrap}>
          {options.map(option => (
            <TouchableOpacity
              key={option}
              style={styles.optionChip}
              onPress={() => choose(field, option)}
            >
              <Text style={styles.optionText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }

  // Type-ahead — city and college. College takes whatever is typed, since no
  // list of them is ever complete. City is `strict`: only a listed entry
  // counts, so two groups in the same place hold the same string and the feed
  // can compare them directly instead of guessing whether "Boston" and
  // "boston, ma" are one city or two.
  function renderTypeAhead(field: Field, list: string[], strict = false) {
    const matches = suggest(list, query);
    const typed = query.trim();
    // Matched loosely but stored as the list spells it, so what lands on the
    // row is canonical however it was typed.
    const exact = list.find(entry => entry.toLowerCase() === typed.toLowerCase()) ?? null;

    function commit() {
      if (exact) { choose(field, exact); return; }
      if (!strict && typed) choose(field, typed);
      // Strict with nothing matched: deliberately does nothing, leaving the
      // picker up. Closing here would swallow the tap on the suggestion that
      // caused the blur in the first place.
    }

    return (
      <View style={styles.typeAhead}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={strict ? `Search ${field.toLowerCase()}...` : `Type a ${field.toLowerCase()}...`}
          placeholderTextColor="#aaa"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={commit}
          onBlur={commit}
        />
        <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="handled">
          {matches.map(match => (
            <TouchableOpacity key={match} style={styles.suggestion} onPress={() => choose(field, match)}>
              <Text style={styles.suggestionText} numberOfLines={1}>{match}</Text>
            </TouchableOpacity>
          ))}
          {/* Says why nothing happened, rather than leaving a typed-out name
              sitting there looking accepted. */}
          {strict && typed.length > 0 && matches.length === 0 && (
            <Text style={styles.noMatch}>No {field.toLowerCase()} by that name — pick one from the list.</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.editCard}>
      {FIELDS.map(field => {
        const key = field.toLowerCase() as keyof Identifiers;
        const value = identifiers[key];
        const isOpen = open === field;
        // Everything collapses while one field is open, so the picker has the
        // card to itself.
        if (open !== null && !isOpen) return null;

        return (
          <View key={field} style={[styles.editField, isOpen && styles.editFieldOpen]}>
            <TouchableOpacity
              style={styles.editRow}
              onPress={() => isOpen ? setOpen(null) : openField(field)}
            >
              <Text style={styles.editLabel}>
                {field}
                {field !== 'College' && <Text style={styles.required}> *</Text>}
              </Text>
              <Text
                style={[styles.editValue, !value && styles.editValueEmpty]}
                numberOfLines={1}
              >
                {value ?? 'Select'}
              </Text>
            </TouchableOpacity>

            {isOpen && field === 'Age' && renderOptions('Age', ageOptions)}
            {isOpen && field === 'Gender' && renderOptions('Gender', genderOptions)}
            {isOpen && field === 'City' && renderTypeAhead('City', CITIES, true)}
            {isOpen && field === 'College' && renderTypeAhead('College', COLLEGES)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // View mode — one bar of icon/value pairs, always a single line. Items share
  // the card's width evenly rather than sizing to their contents, so the bar
  // fills the card whatever is in it.
  viewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    gap: 12,
  },

  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  viewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },

  // A third of the row for age and gender, two thirds for city and college.
  viewItemNarrow: {
    flex: 1,
  },

  viewItemWide: {
    flex: 2,
  },

  // Full height of the row rather than a fixed length, so it stays tied to the
  // items either side of it.
  viewDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#e2e2e2',
  },

  // Stands in for the vertical rule's width on the divider row, so the two
  // horizontal segments line up with the columns above and below them.
  viewDividerGap: {
    width: 1,
  },

  viewHLine: {
    height: 1,
    marginHorizontal: 6,
    backgroundColor: '#e2e2e2',
  },

  viewValue: {
    ...Type.body,
    fontFamily: FontFamily.semiBold,
    color: '#000',
    // Shrinks before the icon does, so a long value truncates rather than
    // pushing its own icon out of the item.
    flexShrink: 1,
  },

  // Edit mode — sized to the reorder slot, so it never grows past its card.
  editCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },

  editField: {
    flex: 0,
  },

  // The open field is the only one left on the card, so it takes what the
  // others were using — without this its picker has no height to scroll in.
  editFieldOpen: {
    flex: 1,
  },

  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
  },

  editLabel: {
    ...Type.label,
    color: '#888',
  },

  required: {
    color: Palette.confirm,
  },

  editValue: {
    ...Type.body,
    fontFamily: FontFamily.semiBold,
    color: '#000',
    flexShrink: 1,
    textAlign: 'right',
  },

  editValueEmpty: {
    fontFamily: FontFamily.regular,
    color: '#bbb',
  },

  // Chips rather than a list: age has thirteen options, and a wrapped grid
  // shows them all without a scroll most of the time.
  optionList: {
    flex: 1,
  },

  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 8,
  },

  optionChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#f2f2f4',
  },

  optionText: {
    ...Type.body,
    color: '#000',
  },

  typeAhead: {
    flex: 1,
  },

  input: {
    ...Type.body,
    color: '#000',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    marginBottom: 6,
  },

  suggestions: {
    flex: 1,
  },

  suggestion: {
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },

  suggestionText: {
    ...Type.body,
    color: '#333',
  },

  noMatch: {
    ...Type.caption,
    color: Palette.muted,
    paddingVertical: 8,
  },
});