const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('C:/Users/jackv/OneDrive/Desktop/key.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const groupQuestions = [
  "What does a typical hangout look like for your group?",
  "What's something your group is really good at together?",
  "How did you all meet?",
  "What kind of people fit in well with your group?",
  "What's the most memorable thing your group has done together?",
  "What do you guys usually do on weekends?",
  "Is your group more chill or more active?",
  "What's something you're all looking forward to doing?",
  "How often does your group hang out?",
  "What makes your group different from other groups?",
];

const individualQuestions = [
  "What's your go-to way to spend a free afternoon?",
  "What kind of people do you vibe with most?",
  "What are you usually up to on a Friday night?",
  "How would your closest friends describe you?",
  "What's something you're always down to do?",
  "What does a perfect day look like for you?",
  "What are you passionate about right now?",
  "What kind of group are you looking to be a part of?",
  "What's one thing people are always surprised to learn about you?",
  "What do you bring to a group dynamic?",
];

async function main() {
  console.log('Uploading question banks...');

  await db.collection('questions').doc('group').set({ questions: groupQuestions });
  console.log('Uploaded group questions');

  await db.collection('questions').doc('individual').set({ questions: individualQuestions });
  console.log('Uploaded individual questions');

  console.log('Done!');
}

main().catch(console.error);