---
title: What end-to-end encryption means, and what it doesn't
description: Who can read your messages in Signal, WhatsApp, Viber, Messenger and Telegram, what the companies can still hand over, and where encryption stops.
summary: Who can actually read your messages, what a company can hand over when it is ordered to, and the five places where the encryption stops.
icon: lock
published: 2026-11-14
status: draft
---

In June 2022, police in the US state of Nebraska sent Meta a search warrant for the Facebook accounts of a mother and her teenage daughter. Meta complied, and what it handed over included their private messages. Those messages became the main basis for a second warrant, and both women were later sentenced.

In October 2026, a grand jury in Washington ordered Signal to hand over what it knew about four phone numbers. Three of them had no Signal account. For the fourth, Signal could provide two things: when the account was created, and the date it last connected.

The difference was not that one company cooperated and the other refused. Both answered a legal order. They simply held different things. In 2022, Messenger encrypted a chat end-to-end only if the people in it had turned that on themselves. Meta could read the rest. Signal has never been able to read its users' messages. That difference is called end-to-end encryption. This article explains how it works, which apps use it, and where it stops.

## Two kinds of encryption {#two-kinds}

Almost every app encrypts messages on their way between your phone and the company's servers. This is called encryption in transit. It stops someone on the same Wi-Fi network from reading along. But the message is unlocked when it reaches the company, and the company keeps a copy it can read. A court can demand that copy, and anyone who breaks into the servers can take it.

With **end-to-end encryption**, a message is locked on your phone and unlocked only on the phone of the person you are writing to. Those two phones are the "ends". The servers in between pass on something they can't read. A company can't hand over what it never had.

![End-to-end encryption removes the company from the list of those who can read a message.](figure:who-can-read)

## How the lock works {#how-it-works}

This can sound impossible. Everything your phone and your friend's phone say to each other passes through the company. How can they agree on a secret the company doesn't learn?

The answer is a pair of keys. Your friend's phone creates two keys that belong together. The **public key** can lock a message but can't open one, so it is safe to give to anyone, including the company that passes it along. The **private key** opens what the public key has locked, and it never leaves the phone. When you send a message, your phone locks it with your friend's public key. From then on, only your friend's phone can open it.

![The key that opens your messages is made on the phone and stays there. The company never holds it.](figure:e2ee-keys)

Real apps do more than this. The method that Signal designed, and that WhatsApp also uses, creates new keys for every message. The principle stays the same: the keys that open messages exist only on the phones.

One question remains. How do you know the public key really came from your friend, and not from someone who placed themselves in between? Apps let you check. Signal shows a **safety number** for each contact and WhatsApp a **security code**. Compare it in person, or over another channel such as a call where you recognise the voice. If you both see the same number, nobody is in the middle. Signal tells you when a contact's safety number changes. Usually it only means they have a new phone, but before a sensitive conversation it is worth comparing the numbers again.

## Which apps use it {#apps}

This is the state of things in November 2026. It changes, so check an app's own help pages before you rely on it.

- **Signal** encrypts every message and call end-to-end. It can't be turned off.
- **WhatsApp** encrypts every personal chat and call end-to-end, with the same method Signal uses. Some chats with businesses are an exception. Backups are protected this way only if you turn that on.
- **Viber** encrypts one-to-one chats, group chats and one-to-one calls end-to-end by default. Communities, Channels, chats with bots and group calls are not.
- **Messenger** began turning on end-to-end encryption by default for personal chats and calls in December 2023, and Meta's help page still describes this as in progress. Before you rely on a chat, and especially a group, look for **End-to-end encrypted** in its settings. Chats with businesses and Marketplace chats are not encrypted this way.
- **iMessage** and FaceTime are end-to-end encrypted. The backup is a separate matter, described below.
- **Telegram** doesn't use it by default. Ordinary chats and all group chats are encrypted only between you and Telegram's servers, where they are stored. Only **Secret Chats** are end-to-end encrypted. You have to start one yourself, and it works between two devices only.
- **Instagram** messages are not end-to-end encrypted. It was an option until May 2026, when Meta removed it and said very few people had used it.
- **SMS** is not encrypted this way at all.

![The same app can protect one kind of chat and not another.](figure:e2ee-apps)

> [!tip]
> The [messaging guide](/guides/messaging/) has the settings for each of these apps, step by step.

## What the company still knows {#metadata}

End-to-end encryption hides what you say. It doesn't hide that you said it. The Electronic Frontier Foundation compares a message to a letter: the content is inside, and everything written on the envelope is **metadata**. That includes who wrote to whom, when and how often.

How much of the envelope a company keeps differs a great deal between apps.

- **Signal** keeps the two things it gave the grand jury: when the account was created and the date it last connected.
- **WhatsApp** says it doesn't store messages once they are delivered. But depending on the legal order, it can provide a user's name, the date they joined, when they were last seen, their IP address and email address, the numbers they have blocked, and their profile photo, groups and address book. Its privacy policy says it collects "the time, frequency, and duration of your activities and interactions".
- **Telegram** says it has nothing to disclose from Secret Chats. Since September 2024 its policy has said that, on a valid court order about a criminal suspect, it may disclose that person's IP address and phone number.

Metadata can say a lot without a word of content. In the EFF's words, "even a tiny sample of metadata can provide an intimate lens into a person's life."

## Where the encryption stops {#limits}

End-to-end encryption protects a message between two phones. On each of those phones, and in every copy that is made of it, the message is readable again. The first four gaps below have all been used in real cases.

![Encryption protects the road between two phones. These five places are outside it.](figure:e2ee-gaps)

### The phone itself

Anyone who can unlock your phone can open the app and read your chats. Spyware does the same thing from the inside: it reads messages on the phone, where they are already unlocked.

In January 2025, WhatsApp warned about 90 of its users, journalists and members of civil society among them, that they had been targeted with spyware made by a company called Paragon. Researchers at the Citizen Lab examined some of the phones and found "clear indications that spyware had been loaded into WhatsApp, as well as other apps on their devices". The encryption was never broken. It didn't need to be.

Attacks like this are aimed at chosen people, not at everyone. The [spyware guide](/guides/spyware/) explains who is targeted and what helps.

### Backups

A backup is a second copy of your chats, kept outside the app. If it isn't end-to-end encrypted too, the company that stores it can be ordered to hand it over.

WhatsApp backups in iCloud or a Google Account are end-to-end encrypted only if you turn that on. WhatsApp says it is testing its own backup storage that is always end-to-end encrypted. On an iPhone with standard settings, Apple holds the keys to your iCloud Backup, and the backup includes the key to your iMessages. Only Apple's **Advanced Data Protection** setting changes that. An internal FBI guide from January 2021, obtained by a transparency group and published that November, noted that when a suspect used WhatsApp on an iPhone with iCloud backups, the data returned by iCloud "may contain WhatsApp data, to include message content".

### Linked devices

Most apps let you link a computer or tablet to your account. Every new message then goes to that device as well. If an attacker gets their own device linked, they read along without ever touching your phone.

In February 2025, Google's security researchers described groups aligned with Russia doing exactly this to Signal users. They sent QR codes disguised as group invitations or security notices. A victim who scanned one linked the attacker's device to their own account, and from then on messages were delivered "to both the victim and the threat actor in real-time". Google said WhatsApp and Telegram were being targeted in similar ways. In March 2026, the FBI and the US cybersecurity agency CISA reported that a phishing campaign by Russian intelligence services, using linked devices and stolen verification codes, had given the attackers access to thousands of accounts. Their summary: "While encryption remains effective, phishing allows malicious actors to bypass the encryption entirely by gaining access to user accounts."

### The people in the chat

Encryption delivers a message safely to everyone in the chat. It can't tell whether they should be there.

In March 2025, senior US officials discussed a military operation in a Signal group. The editor of the magazine The Atlantic had been added to the group by mistake, and could read everything posted while he was in it. Signal worked exactly as designed.

The person you write to can also take a screenshot, forward your message or lose their phone. Disappearing messages don't change that. Signal's own help page says they are not for situations where your contact is your adversary, because anyone who wants a record can photograph the screen with another camera.

### The envelope

As described above, the company may still know who you talk to, when and how often, and can be ordered to say so.

## Why it is still worth it {#worth-it}

None of these limits is a reason to give up on end-to-end encryption. Without it, all five gaps stay open and the company can read your messages as well.

Security agencies give the same advice to the people they protect. In December 2024, after hackers linked to the Chinese government broke into commercial telecom networks, CISA published guidance for senior officials. Its first recommendation: "Only use end-to-end encrypted communications." The current version of that guidance still says so.

It is also not something an app has forever. Instagram dropped its encrypted chats in 2026. In February 2025, Apple stopped offering Advanced Data Protection to new users in the United Kingdom, where the government was reported to have ordered the company to give it access to encrypted data. What an app protected last year is not always what it protects today.

## What to do {#what-to-do}

1. For private conversations, use a chat that is end-to-end encrypted by default.
2. In Telegram, use **Secret Chats** for anything private. Treat ordinary Telegram chats and Instagram messages as readable by the company.
3. [Turn on encrypted backups](/guides/messaging/#backups), or keep chats out of the backup.
4. [Check your linked devices](/guides/messaging/#linked-devices) from time to time. Don't scan a QR code that someone sends you, even if it looks like a group invitation. Never give anyone your verification code or PIN: an app's support team will not message you to ask for them.
5. [Lock your phone](/guides/phone/#screen-lock) with a strong PIN or password.
6. Before you write something sensitive in a group, look at who is in it.

## Sources {#sources}

All sources were read on 14 November 2026.

- Electronic Frontier Foundation: [What should I know about encryption?](https://ssd.eff.org/module/what-should-i-know-about-encryption) and [Why metadata matters](https://ssd.eff.org/module/why-metadata-matters)
- Signal: [response to a grand jury subpoena, 3 November 2026](https://signal.org/bigbrother/district-of-columbia-2/), [the Double Ratchet algorithm](https://signal.org/docs/specifications/doubleratchet/), [safety numbers](https://support.signal.org/hc/en-us/articles/360007060632-What-is-a-safety-number-and-why-do-I-see-that-it-changed) and [disappearing messages](https://support.signal.org/hc/en-us/articles/360007320771-Set-and-manage-disappearing-messages)
- WhatsApp: [about end-to-end encryption](https://faq.whatsapp.com/820124435853543), [about backups](https://faq.whatsapp.com/490592613091019), [end-to-end encrypted backups, 2021](https://blog.whatsapp.com/end-to-end-encrypted-backups-on-whatsapp), [information for law enforcement authorities](https://faq.whatsapp.com/444002211197967) and its [privacy policy](https://www.whatsapp.com/legal/privacy-policy)
- Viber: [Understanding end-to-end encryption](https://help.viber.com/hc/en-us/articles/8909167863453-Understanding-end-to-end-encryption)
- Meta: [default end-to-end encryption on Messenger, December 2023](https://about.fb.com/news/2023/12/default-end-to-end-encryption-on-messenger/) and [Messenger help](https://www.facebook.com/help/messenger-app/786613221989782)
- Telegram: [FAQ](https://telegram.org/faq) and [privacy policy, section 8.3](https://telegram.org/privacy#8-3-law-enforcement-authorities)
- Apple: [iCloud data security overview](https://support.apple.com/en-us/102651) and [Advanced Data Protection in the United Kingdom](https://support.apple.com/en-us/122234); Privacy International: [the legal challenge over the UK order](https://privacyinternational.org/legal-action/pi-apple-tcn-challenge)
- Motherboard: [the data Facebook gave police in the Nebraska case, August 2022](https://www.vice.com/en/article/this-is-the-data-facebook-gave-police-to-prosecute-a-teenager-for-abortion/); WOWT: [the sentences, September 2023](https://www.wcax.com/2023/09/22/mother-sentenced-giving-abortion-pills-pregnant-daughter-nebraska/)
- The Hacker News: [Meta to end encrypted chats on Instagram, March 2026](https://thehackernews.com/2026/03/meta-to-shut-down-instagram-end-to-end.html)
- Citizen Lab: [A first look at Paragon's proliferating spyware operations, March 2025](https://citizenlab.ca/2025/03/a-first-look-at-paragons-proliferating-spyware-operations/)
- Rolling Stone: [the FBI's guide to what messaging apps can provide, November 2021](https://www.rollingstone.com/politics/politics-features/whatsapp-imessage-facebook-apple-fbi-privacy-1261816/); The Record: [the text of the document](https://therecord.media/fbi-document-shows-what-data-can-be-obtained-from-encrypted-messaging-apps/)
- Google Threat Intelligence Group: [Russia-aligned threat actors targeting Signal, February 2025](https://cloud.google.com/blog/topics/threat-intelligence/russia-targeting-signal-messenger)
- FBI and CISA: [public service announcement, 20 March 2026](https://www.ic3.gov/PSA/2026/PSA260320)
- The Guardian: [the Signal group chat of US officials, March 2025](https://www.theguardian.com/us-news/2025/mar/24/journalist-trump-yemen-war-chat)
- CISA: [Mobile Communications Best Practice Guidance](https://www.cisa.gov/resources-tools/resources/mobile-communications-best-practice-guidance)
