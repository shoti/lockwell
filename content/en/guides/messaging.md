---
title: Make your messaging apps private
description: Settings for Messenger, Viber, WhatsApp, Telegram and Signal: a PIN for your account, linked devices, backups, and what each app can and cannot read.
summary: Stop others from taking over your account or reading your chats, in the apps you already use.
audience: everyone
group: start
icon: chat
order: 3
time: 40
reviewed: 2026-11-14
status: published
---

Messaging accounts are a popular target. Whoever takes over your WhatsApp, Viber or Telegram can write to your friends in your name, usually to ask for money. This guide covers five apps widely used in Georgia. Do the three **Essential** items in the apps you use and skip the rest.

## Protect your account with a PIN or password {#account-pin .essential}

A takeover usually goes like this: someone enters your phone number on their own phone, the app sends the code to you, and a message asks you to pass it on. The message often comes from a friend whose account is already stolen. An extra PIN or password stops this, because the code alone is no longer enough.

![Never pass on a login code, even to a friend.](figure:account-takeover)

Save the PIN or password in your password manager and add a recovery email. If you forget it, you can be locked out for days.

### WhatsApp

1. Open **Settings → Account → Two-step verification**. On Android, **Settings** is in the ⋮ menu; on iPhone it may be called **You**.
2. Turn on two-step verification and create a password. Older versions of the app ask for a six-digit PIN instead.
3. Add an email address you can reach, so you can reset the password.

### Viber

1. Tap **More → Settings → Privacy → 2-step verification**.
2. Enter a six-digit PIN twice.
3. Add your email address and confirm it. Without it, a forgotten PIN can lock you out.

### Messenger

1. Messenger uses your Facebook account. In the Facebook app, open **Menu → Settings & privacy → Settings → Accounts Center → Password and security → Two-factor authentication**.
2. Choose your account and a method. The [accounts guide](/guides/accounts/#two-step) explains which method to pick.

### Telegram

1. Open **Settings → Privacy and Security → 2-Step Verification**.
2. Set a password and a recovery email. If you forget the password and have no recovery email, you can't sign in on a new device.

### Signal

1. Tap your profile picture, then **Account**. On iPhone, tap **Settings** first.
2. Create a PIN if you don't have one, then turn on **Registration Lock**.

> [!warning]
> Never pass on a code an app sends you, not even to a friend who asks. Their account may already be in someone else's hands. No messaging company asks for your code in a chat.

## Check which devices are linked {#linked-devices .essential}

All five apps can run on a computer or a second phone next to your own. Someone who held your unlocked phone for a minute, or talked you into scanning a QR code or typing in a code, may have linked their device and be reading along. WhatsApp removes a linked device after 30 days without use, Signal after 45. A device that is in use stays linked, as long as you keep using your phone too.

### WhatsApp

1. On Android, tap ⋮, then **Linked devices**. On iPhone, open **Settings**, then **Linked devices**.
2. Tap a device you don't recognise, then **Log out**.

### Viber

1. Tap **More → Settings → Account → Desktop and tablets**.
2. Select a device you don't recognise and tap **Deactivate**.

### Messenger

1. Tap **Menu → Settings → Privacy & safety → End-to-end encrypted chats → Security alerts → View logins**.
2. Tap a device you don't recognise, then **Log out**.
3. Check the logins of your Facebook account as well: see [Sign out of devices you don't recognise](/guides/accounts/#devices).

### Telegram

1. Open **Settings → Devices**.
2. End every session you don't recognise.

### Signal

1. Open Signal's settings and tap **Linked devices**.
2. Remove every device you don't recognise.

> [!note]
> If someone has already taken over your WhatsApp, these settings won't remove them. Register your number in the app again with the code sent by SMS: that signs every other device out. If the intruder has set their own two-step PIN or password, WhatsApp makes you wait 7 days before you can get back in. Warn your contacts in the meantime, and see [If your account was hacked](/guides/hacked/).

## Know what each app can read {#know-encryption .essential}

End-to-end encryption means only you and the person you write to can read a message. The company that runs the app can't. It does not hide who you talk to or when, and it does not protect a message on a phone that someone else can unlock. Our [article on end-to-end encryption](/articles/end-to-end-encryption/) explains more.

![End-to-end encryption hides what you say, not who you talk to or when.](figure:who-can-read)

### WhatsApp

- Personal chats, groups and calls are end-to-end encrypted by default.
- Channels are public. What you send to Meta AI can be read by Meta, and a business you write to may pass your messages to other companies.
- WhatsApp shares some information with other Meta companies, for example for safety and for features that connect to Facebook or Instagram. It can't read your personal messages.

### Viber

- One-to-one chats, group chats and one-to-one calls are end-to-end encrypted.
- Communities, Channels, chats with bots and group calls are not.
- To check a chat, open its info screen and look for the lock under the picture.

### Messenger

- Meta is still moving personal chats to end-to-end encryption by default, so check each chat that matters: open the chat settings and look for **End-to-end encrypted**.
- Chats with businesses and Pages, Marketplace chats and messages to Meta AI are not end-to-end encrypted.

### Telegram

- Ordinary chats, all groups and all channels are kept on Telegram's servers in a form Telegram can read.
- Among chats, only Secret Chats are end-to-end encrypted. They work between two people and stay on the one device where you started them. Voice and video calls, including group calls, are end-to-end encrypted too.
- To start one, open the person's profile, tap **…**, then **Start Secret Chat**.

### Signal

- Everything is end-to-end encrypted: chats, groups and calls.
- Signal keeps almost nothing about you: the date your account was created and the date it last connected.

## Protect your chat backups {#backups .recommended}

A backup in Google Drive or iCloud is a second copy of your chats. Unless the backup itself is end-to-end encrypted, the company that stores it can open it. Telegram needs no step here: its ordinary chats are already on Telegram's servers.

### WhatsApp

1. Open **Settings → Chats → Chat Backup**.
2. Tap **End-to-end encrypted backup** (on iPhone it may read **End-to-end encryption**) and follow the steps.
3. Choose a passkey, a password or a 64-digit key. Save the password or key in your password manager. WhatsApp can't reset it; without it the backup is lost.

### Messenger

1. Tap **Menu → Settings → Privacy & safety → End-to-end encrypted chats → Message storage**.
2. Tap **PIN → Create PIN**. You need this PIN to get your encrypted chats back on a new phone.

### Viber

1. Tap **More → Settings → Account → Viber Backup** to see whether a backup is on and where it goes.
2. Viber saves backups to your Google Drive or iCloud and does not say that they are end-to-end encrypted. If your chats are sensitive, consider leaving the backup off. The price: when the phone is lost, so is the history.

### Signal

1. Signal makes no cloud backup unless you turn it on, in Signal's settings under **Backups**.
2. The backup is end-to-end encrypted with a 64-character recovery key. Save the key: Signal can't recover it for you.

## Choose who can see you and add you to groups {#who-sees .recommended}

By default, strangers can see more than they need: your photo, when you were last online, sometimes your number. Anyone can also add you to groups, which is how many scams begin.

### WhatsApp

1. Open **Settings → Privacy**.
2. Set who can see your last seen and online status, your profile photo and your about text to **My contacts**.
3. Tap **Groups** and choose **My contacts**.

### Viber

1. Tap **More → Settings → Privacy**.
2. Review **Share Online status**, **Send Seen status** and **Show your photo**.
3. Tap **Control who can add you to groups** and choose **My contacts**.

### Messenger

1. Tap **Menu → Settings → Privacy & safety → Message delivery**.
2. For people you don't know, choose the message requests folder or **Don't receive requests**.

### Telegram

1. Open **Settings → Privacy and Security → Phone Number**.
2. Set who can see your phone number to **Nobody**.
3. In the option that then appears below, set who can find you by your number to **My Contacts**. People who already have your number saved will still see it.

### Signal

1. Open **Settings → Privacy → Phone Number**.
2. Check that **Who can see my number** is set to **Nobody**. This is the default.
3. Leave **Who can find me by my number** on **Everybody**, or the people who have your number won't find you on Signal.

> [!note]
> In WhatsApp, Viber and Telegram this works both ways: if you hide when you were last online, you stop seeing it for others.

## Use Signal for sensitive conversations {#use-signal .recommended}

Signal is free and run by a non-profit. It encrypts everything end-to-end by default and keeps almost no information about who talks to whom. Privacy Guides recommends it for private conversations, and EFF's Surveillance Self-Defense has a step-by-step guide to it. You need a phone number to register, and the other person needs Signal too.

### iPhone {.ios}

1. Install **Signal** from the App Store. Check that the developer is Signal Messenger, LLC.
2. Register with your phone number and create a PIN when asked.

### Android {.android}

1. Install **Signal** from Google Play. Check that the developer is Signal Foundation.
2. Register with your phone number and create a PIN when asked.

### Computer {.desktop}

1. Download Signal Desktop from [signal.org/download](https://signal.org/download/).
2. Link it to the Signal app on your phone by scanning the QR code.

## Turn on disappearing messages {#disappearing .advanced}

A message that deletes itself can't be read later on a lost, borrowed or seized phone. It is no protection against the person you are writing to: they can take a screenshot, photograph the screen or copy the text before it disappears.

### WhatsApp

1. Open **Settings → Privacy → Default message timer**.
2. Choose **24 hours**, **7 days** or **90 days**. It applies to new chats.

### Viber

1. Tap **More → Settings → Privacy → Disappearing messages by default** and choose a time. Viber says this setting is not available in every country.
2. For one chat, open the chat info and tap **Disappearing messages**.

### Messenger

1. Open an end-to-end encrypted chat and tap the person's name at the top.
2. Tap **Disappearing messages** and choose a time.

### Telegram

1. Open the chat's info page, choose **Auto-Delete** and pick a time.
2. For all new chats, set it in **Settings → Privacy and Security**.

### Signal

1. Open **Settings → Privacy → Disappearing messages**. On Android, then tap **Default timer for new chats**.
2. Choose a time, up to four weeks.

## Lock the app {#app-lock .advanced}

An app lock asks for your fingerprint, face or code each time the app is opened. It helps when you hand someone your unlocked phone. Notifications can still show message text on the lock screen unless you [hide previews](/guides/phone/#lock-screen). Viber has no such lock on phones, so there the phone's own [screen lock](/guides/phone/#screen-lock) is what protects you.

### WhatsApp

1. Open **Settings → Privacy → App lock**.
2. Turn on **Unlock with biometric** (Android) or **Require Face ID** (iPhone).

### Messenger

1. Tap **Menu → Settings → Privacy & safety → App lock**.
2. Turn on **Unlock with biometrics** (Android) or **Require Face ID** (iPhone).

### Telegram

1. Open **Settings → Privacy and Security**.
2. Set a passcode for the app.

### Signal

1. Tap your profile picture, then **Privacy**. On iPhone, tap **Settings** first.
2. Turn on **Screen Lock**.
