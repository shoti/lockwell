---
title: Keep sensitive conversations private
description: Signal in depth: checking you're talking to the right person, hiding your number, disappearing messages, groups, and what Signal and your phone still reveal.
summary: Signal protects what you write, not who you are or what is on the other person's phone. Check who you are talking to, hide your number and know the limits.
audience: high-risk
group: basics
order: 4
time: 40
progress: session
reviewed: 2026-11-12
status: published
---

The [messaging guide](/guides/messaging/) covers the basics: a PIN, linked devices, and why Signal is the safer choice. This guide goes further, for conversations that could put you or someone else at risk. Signal encrypts what you write end to end. It can't protect messages on an unlocked or infected phone, stop the other person from keeping a copy, or hide that you are using your phone.

## Check that you are talking to the right person {#safety-numbers .essential}

Each one-to-one Signal chat has a safety number. If yours matches your contact's, nobody is sitting in the middle of the conversation. Signal notes that it doesn't prove who the person is.

### Signal

1. Open the chat, tap the contact's name at the top, and select **View Safety Number**.
2. Compare it in person by scanning each other's QR code. If you can't meet, compare the numbers through another channel, such as a video call where you recognise the person.
3. If they match, tap **Mark as verified**. From then on, if the number changes, Signal asks you to approve it before you can send a message.
4. A change usually means a new phone or reinstalling Signal. If it changes often or unexpectedly, check again through another channel before you continue sensitive talk.
5. Newer versions can also show a green **Encryption verified** mark (**View Safety Number → Verify automatically**). It works only when Signal has your contact's phone number, so with usernames or hidden numbers, compare by hand.

Verification proves the connection, not the person: someone with your contact's unlocked phone is still "verified".

## Hide your phone number {#username-not-number .essential}

Your Signal number is linked to your SIM and often to your name. With a username, people can reach you without learning the number.

### iPhone {.ios}

1. Tap your profile icon, then **Settings**, then your profile, then the @ symbol, and create a username. It needs at least two digits at the end.
2. In **Settings → Privacy → Phone Number**, set **Who can see my number** to **Nobody**, then **Who can find me by my number** to **Nobody**. You must set the first before the second.

### Android {.android}

1. Tap your profile icon, then your profile, then the @ symbol, and create a username. It needs at least two digits at the end.
2. In **Settings → Privacy → Phone Number**, set **Who can see my number** to **Nobody**, then **Who can find me by my number** to **Nobody**. You must set the first before the second.

### Signal

1. Share the username as a QR code or link, not the number.
2. People who have your number saved in their contacts still see it, whatever you set.
3. If you chatted with someone by number and then message them by username, the chats merge and they learn that both are you.
4. To block someone without them seeing your number, hide your number first, then block.
5. Keep your username. If you change or drop it, someone else can claim it after about a week and use it to pose as you.

Signal still needs a phone number to sign up, and the number is how your account is recovered. Signal is testing sign-up without a number in an Android beta: there is no way back if you lose its keys.

## Set disappearing messages as the default {#disappearing-default .essential}

A default timer makes every new chat disappear without you remembering to turn it on. It protects against someone who later gets hold of a phone, not against the person you are talking to.

### iPhone {.ios}

1. Open **Settings → Privacy → Disappearing messages** (the screen may be called **Default timer for new chats**), choose a time, and tap **Set**.

### Android {.android}

1. Open **Settings → Privacy → Disappearing messages → Default timer for new chats**, choose a time, and tap **Save**.

### Signal

1. A timer affects only messages sent after you set it. Older messages, sent and received, stay on both phones: delete them by hand and ask your contact to do the same. Then set a timer in each existing chat under **chat settings → Disappearing messages**.
2. Anyone in a chat can change its timer, unless admins restrict it in a group.
3. Signal backups leave out only messages due to disappear within 24 hours. A longer timer doesn't keep a message out of your backup or your contact's.

Signal itself warns that disappearing messages are "not for situations where your contact is your adversary": the other person can photograph the screen with another camera.

## Lock your Signal number {#registration-lock .essential}

Registration Lock stops someone who takes over your phone number, for example with a new SIM, from moving your Signal account to their phone. The basic steps are in [Protect your account with a PIN or password](/guides/messaging/#account-pin).

### iPhone {.ios}

1. Tap your profile icon, then **Settings → Account**, and turn on **Registration Lock**.

### Android {.android}

1. Tap your profile icon, then **Account**, and turn on **Registration Lock**.

### Signal

1. Use a long PIN with letters, not the short number Signal suggests: **Settings → Account → Change your PIN → Create alphanumeric PIN**. Signal sets no limit on its length.
2. Keep the PIN in your password manager. If you forget it with the lock on, you can be locked out for up to 7 days, and after that you lose your profile and some settings.
3. Keep the phone number paid and in your hands. Without it, Signal can't give you back the account.
4. Signal support never messages you. The only official chat is the one named "Signal" and marked **Official Chat**: you can't reply to it, and it never asks for anything. Never share an SMS code, PIN or recovery key.

Registration Lock locks you out too if you lose the PIN. It doesn't help if someone has your unlocked phone.

## Hide messages from people near your phone {#notifications-and-screens .recommended}

A locked phone can still show who wrote and what, and the app switcher can show your last screen.

### iPhone {.ios}

1. In Signal, tap your profile icon, then **Settings → Notifications → Show**, and choose **No Name or Content**.
2. In **Settings → Privacy**, turn on **Hide Screen in App Switcher**.
3. In **Settings → Chats**, turn off **Share Contacts with iOS**, so your Signal contacts don't appear in suggestions in other apps.

### Android {.android}

1. In Signal, tap your profile icon, then **Notifications → Show**, and choose **No name or message**.
2. In **Settings → Privacy**, turn on **Screen Security** and **Incognito Keyboard**.
3. Remove keyboards you don't use: a keyboard app can read what you type, and Signal says the incognito setting is "a best effort, not a guarantee".

Screen security stops screenshots on your own phone only. None of this helps once the phone is unlocked or infected: anything on it can then be read.

## Keep groups tight {#groups .recommended}

In a group, everyone shares the risk of its weakest member. Any member's phone can be taken, and any member can take screenshots.

### Signal

1. Keep sensitive groups small, and check the member list now and then. Admins can remove people who no longer need to be there: tap their name, then **Remove from group**.
2. Make only people you have verified admins, and in the group's **Permissions** let only admins add members and change group details.
3. If the group has a link, turn on **Approve New Members**, and reset the link if it reaches the wrong people: **group chat settings → Group Link → Reset Link**. Turn the link off when you no longer need it.
4. If two members have the same name, Signal shows a warning banner. Check through another channel who is who.
5. Set a disappearing timer for the group, and let only admins change it.

Signal doesn't keep a record of your groups, but every member's phone does.

## Know what Signal and your phone still reveal {#metadata .recommended}

Signal says it can produce only the date you registered and when you last connected. Your mobile operator and internet provider can see when you use Signal and where your phone is. Your contacts' phones show who you talk to and when.

### Signal

1. Turn on **Always relay calls** (**Settings → Privacy → Advanced**). Otherwise, a contact you call, or who calls you, can see your internet address. Relayed calls may sound a little worse.
2. Leave **Allow from anyone** (**Settings → Privacy → Advanced**, under sealed sender) off. Signal says it brings an "increased risk of abuse".
3. Keep **Generate link previews** off in **Settings → Chats**: a preview tells the website you shared its link.
4. Keep Signal on your phone only if you can. Freedom of the Press Foundation notes that malware has a harder time on an updated phone than on a computer, and Signal can copy all your chats to each linked device.

End-to-end encryption protects what you say, not the fact that you said it. If you call from a mobile phone, your location is part of the record.

## Decide when not to write it down {#when-not-to-text .recommended}

EFF says the most private way to talk is often in person, without phones. Some things are safer not written at all.

### All conversations

1. For the most sensitive talks, meet in person in a place not linked to your contact's home or work, and leave your phones behind: a phone can show where you both were.
2. Before you write something, ask what happens if the other person's phone is taken, or if they share it.
3. Ask the people you talk to sensitively to protect their Signal too: a PIN, Registration Lock and disappearing messages.

A meeting can be watched too. If you think you are being followed, CPJ advises calling the meeting off.
