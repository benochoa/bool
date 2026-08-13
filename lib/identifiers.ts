import citiesData from '@/assets/data/cities.json';
import collegesData from '@/assets/data/colleges.json';

// The four facts a post carries besides its photos and answers. All text,
// including age: individuals store a number as a string ('21') and groups store
// a band ('21-23'), and neither '30+' nor '18-20' is a number.
export interface Identifiers {
  age: string | null;
  gender: string | null;
  city: string | null;
  college: string | null;
}

export const EMPTY_IDENTIFIERS: Identifiers = { age: null, gender: null, city: null, college: null };

// A person gives their own age; a group gives the band its members fall in —
// asking five people for one number has no answer.
export const PERSON_AGE_OPTIONS = [
  '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30+',
];

export const GROUP_AGE_OPTIONS = ['18-20', '21-23', '24-26', '27-29', '30+'];

// A person answers for themselves; a group answers for its members, so the
// same list reads plural there.
export const PERSON_GENDER_OPTIONS = ['Man', 'Woman', 'Other'];

export const GROUP_GENDER_OPTIONS = ['Men', 'Women', 'Other'];

export const CITIES: string[] = citiesData;
export const COLLEGES: string[] = collegesData;

// Suggestions for a type-ahead. Entries starting with what was typed come
// first — typing "san" should reach San Diego before Santa Rosa's neighbours —
// then anything containing it, so "bama" still finds Alabama.
export function suggest(list: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: string[] = [];
  const contains: string[] = [];
  for (const entry of list) {
    const lower = entry.toLowerCase();
    if (lower.startsWith(q)) starts.push(entry);
    else if (lower.includes(q)) contains.push(entry);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// The row shape. Both tables carry the same four columns, so a person and a
// group are written the same way; free-typed values are trimmed on the way in.
export function identifierColumns(identifiers: Identifiers) {
  return {
    age: identifiers.age,
    gender: identifiers.gender,
    city: identifiers.city?.trim() || null,
    college: identifiers.college?.trim() || null,
  };
}

// Age, gender and city are required; college is optional. Returns the missing
// labels so the caller can name them rather than just refusing.
export function missingIdentifiers(identifiers: Identifiers): string[] {
  const missing: string[] = [];
  if (!identifiers.age) missing.push('age');
  if (!identifiers.gender) missing.push('gender');
  if (!identifiers.city?.trim()) missing.push('city');
  return missing;
}