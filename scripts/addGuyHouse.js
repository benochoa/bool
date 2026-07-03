const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const path = require('path');

const serviceAccount = require('C:/Users/jackv/OneDrive/Desktop/key.json');

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'bool-345a4.firebasestorage.app',
});

const db = getFirestore();
const bucket = getStorage().bucket();

const screenshotsDir = 'C:/Users/jackv/OneDrive/Pictures/Screenshots';

const people = [
  {
    id: 'Person-7',
    name: 'Chuddee',
    imageFile: 'Screenshot 2026-07-02 215011.png',
    qa: [
      { question: "What's your go-to way to spend a free afternoon?", answer: "Honestly just vibing outside with the crew, maybe tossing a ball around." },
      { question: "What kind of people do you click with?", answer: "People who are real with you and don't take everything too seriously." },
      { question: "What are you usually doing on a Friday night?", answer: "Either out doing something spontaneous or locked in watching a game." },
    ],
  },
  {
    id: 'Person-8',
    name: 'Huddy',
    imageFile: 'Screenshot 2026-07-02 215022.png',
    qa: [
      { question: "How do you like to recharge after a long week?", answer: "Good food, good company — doesn't need to be anything crazy." },
      { question: "What's something you're always down to do?", answer: "Hoop, play cards, or find somewhere new to eat." },
      { question: "What do you look for in new people you meet?", answer: "Energy and realness. If you got those two things we're good." },
    ],
  },
  {
    id: 'Person-9',
    name: 'Wilder',
    imageFile: 'Screenshot 2026-07-02 215030.png',
    qa: [
      { question: "What does a perfect day look like for you?", answer: "Up early, get something done, then be outside the rest of the day." },
      { question: "How would your friends describe you?", answer: "Probably the one who always has a plan but is also down for anything." },
      { question: "What kind of group are you looking for?", answer: "Guys who actually show up and make things happen, not just talk about it." },
    ],
  },
];

const group = {
  id: 'Group-3',
  name: 'Guy House',
  imageFile: 'Screenshot 2026-07-02 215038.png',
  members: ['Person-7', 'Person-8', 'Person-9'],
  qa: [
    { question: "What's the vibe like in your house?", answer: "Chill but always something going on — never a dull moment." },
    { question: "What do you guys usually get up to on weekends?", answer: "Sports, food runs, having people over — pretty much whatever comes up." },
    { question: "What kind of people are you looking to meet?", answer: "Anyone who's fun to be around and actually follows through on plans." },
  ],
};

async function uploadImage(localPath, storagePath) {
  await bucket.upload(localPath, {
    destination: storagePath,
    metadata: { contentType: 'image/png' },
  });
  await bucket.file(storagePath).makePublic();
  console.log(`  Uploaded image: ${storagePath}`);
}

async function main() {
  console.log('Adding Guy House and members...');

  // Upload people
  for (const person of people) {
    const localPath = path.join(screenshotsDir, person.imageFile);
    const storagePath = `People/${person.id}/img1.png`;
    await uploadImage(localPath, storagePath);

    await db.collection('people').doc(person.id).set({
      name: person.name,
      qa: person.qa,
      storageFolder: `People/${person.id}`,
    });
    console.log(`  Added person: ${person.id} (${person.name})`);
  }

  // Upload group
  const groupLocalPath = path.join(screenshotsDir, group.imageFile);
  const groupStoragePath = `Groups/${group.id}/img1.png`;
  await uploadImage(groupLocalPath, groupStoragePath);

  await db.collection('groups').doc(group.id).set({
    name: group.name,
    qa: group.qa,
    members: group.members,
    storageFolder: `Groups/${group.id}`,
  });
  console.log(`  Added group: ${group.id} (${group.name})`);

  console.log('Done!');
}

main().catch(console.error);