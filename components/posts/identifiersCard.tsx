import { FontFamily, Palette, Type } from '@/constants/theme';
import {
  CITIES, COLLEGES, GENDER_OPTIONS, GROUP_AGE_OPTIONS, Identifiers,
  PERSON_AGE_OPTIONS, suggest,
} from '@/lib/identifiers';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Four fields, same for a person and a group — only the age options differ.
const FIELDS = ['Age', 'Gender', 'City', 'College'] as const;
type Field = typeof FIELDS[number];

interface ViewProps {
  identifiers: Identifiers;
}

// View mode: the values as a plain list. College is the one optional field, so
// its row is dropped entirely when unset rather than left blank.
export function IdentifiersView({ identifiers }: ViewProps) {
  const rows: [Field, string | null][] = [
    ['Age', identifiers.age],
    ['Gender', identifiers.gender],
    ['City', identifiers.city],
    ['College', identifiers.college],
  ];

  return (
    <View style={styles.viewCard}>
      {rows.map(([label, value]) => value ? (
        <View key={label} style={styles.viewRow}>
          <Text style={styles.viewLabel}>{label}</Text>
          <Text style={styles.viewValue} numberOfLines={1}>{value}</Text>
        </View>
      ) : null)}
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

  // Type-ahead — city and college. Whatever is typed is a valid answer, so the
  // suggestions are a shortcut rather than the set of allowed values.
  function renderTypeAhead(field: Field, list: string[]) {
    const matches = suggest(list, query);
    return (
      <View style={styles.typeAhead}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={`Type a ${field.toLowerCase()}...`}
          placeholderTextColor="#aaa"
          autoFocus
          returnKeyType="done"
          // Committing what was typed, matched or not.
          onSubmitEditing={() => choose(field, query.trim())}
          onBlur={() => { if (query.trim()) choose(field, query.trim()); }}
        />
        <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="handled">
          {matches.map(match => (
            <TouchableOpacity key={match} style={styles.suggestion} onPress={() => choose(field, match)}>
              <Text style={styles.suggestionText} numberOfLines={1}>{match}</Text>
            </TouchableOpacity>
          ))}
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
          <View key={field} style={styles.editField}>
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
            {isOpen && field === 'Gender' && renderOptions('Gender', GENDER_OPTIONS)}
            {isOpen && field === 'City' && renderTypeAhead('City', CITIES)}
            {isOpen && field === 'College' && renderTypeAhead('College', COLLEGES)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // View mode — matches the Q&A card's white box.
  viewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
  },

  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },

  viewLabel: {
    ...Type.label,
    color: '#888',
  },

  viewValue: {
    ...Type.body,
    fontFamily: FontFamily.semiBold,
    color: '#000',
    flexShrink: 1,
    textAlign: 'right',
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
    flexGrow: 0,
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
    flexGrow: 0,
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
});