const sendToUsers = async (userIds, payload) => {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) return;

    const User  = require('../modules/user/user.model');
    const admin = require('../config/firebase');

    const users  = await User.find({ _id: { $in: userIds }, fcmToken: { $ne: null } }).select('fcmToken');
    const tokens = users.map(u => u.fcmToken).filter(Boolean);
    if (!tokens.length) return;

    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data || {},
    });
  } catch (err) {
    console.error('FCM error:', err.message);
  }
};

const sendToTopic = async (topic, payload) => {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) return;

    const admin = require('../config/firebase');
    await admin.messaging().send({
      topic,
      notification: { title: payload.title, body: payload.body },
      data: payload.data || {},
    });
  } catch (err) {
    console.error('FCM topic error:', err.message);
  }
};

module.exports = { sendToUsers, sendToTopic };