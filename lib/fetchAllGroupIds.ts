import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export async function fetchAllGroupIds(): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'groups'));
  return snapshot.docs.map(doc => doc.id);
}
