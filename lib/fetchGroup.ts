import { doc, getDoc } from 'firebase/firestore';
import { ref, listAll, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebaseConfig';

export interface GroupData {
  name: string;
  qa: { question: string; answer: string }[];
  members: string[];
  imageUrls: string[];
}

export async function fetchGroup(groupId: string): Promise<GroupData | null> {

  // Fetch text data from Firestore
  const snapshot = await getDoc(doc(db, 'groups', groupId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();

  // List images from Storage
  const folderRef = ref(storage, data.storageFolder);
  const result = await listAll(folderRef);
  const imageUrls = await Promise.all(result.items.map(item => getDownloadURL(item)));

  return {
    name: data.name,
    qa: data.qa,
    members: data.members,
    imageUrls,
  };
}
