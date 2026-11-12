---
title: What end-to-end encryption means, and what it doesn't
description: A plain-language explanation of end-to-end encryption: who can read your messages in Signal, WhatsApp and Telegram, and what encryption can't protect you from.
summary: Who can actually read your messages, and why the app you choose matters more than any setting inside it.
published: 2026-11-11
status: draft
---

When you send a message, it passes through the app company's servers before it reaches the other person. Whether that company can read it on the way depends on one thing: how the message is encrypted.

## Two kinds of encryption {#two-kinds}

Almost every app encrypts messages between your phone and its servers. That protects you from someone listening on the same Wi-Fi network, but the company still holds a copy it can read. It can be forced to hand that copy over, and anyone who breaks into its servers can take it.

With **end-to-end encryption**, a message is locked on your phone and can be unlocked only on the phone of the person you are writing to. The servers in between carry something they can't read. The company can't hand over what it doesn't have.

## Which apps use it {#apps}

- **Signal** encrypts every message and call end-to-end. You can't turn it off.
- **WhatsApp** also encrypts every chat and call end-to-end. Backups are a separate matter: they are protected this way only if you turn that on.
- **Telegram** doesn't by default. Regular chats and all group chats are stored on Telegram's servers in a form Telegram can read. Only **Secret Chats** are end-to-end encrypted.

> [!tip]
> The [messaging guide](/guides/messaging/) shows how to turn on encrypted backups in WhatsApp and how to start a Secret Chat in Telegram.

## What it doesn't protect you from {#limits}

End-to-end encryption protects a message while it travels. It doesn't protect the two ends.

- **Your phone.** Anyone who can unlock your phone can read your chats in the app. A strong screen lock matters as much as the app you choose.
- **Linked devices.** A computer that was once linked to your account keeps receiving your messages. [Check which devices are linked](/guides/messaging/#linked-devices) from time to time.
- **The other person.** They can take a screenshot, forward your message or lose their phone.
- **Who you talk to, and when.** The text is hidden, but the company may still know who you contacted and at what time. Signal is built to keep as little of this as possible.

## What to do {#what-to-do}

1. For conversations you wouldn't want others to read, use Signal or WhatsApp.
2. In Telegram, use **Secret Chats** for anything private, and treat everything else as readable by Telegram.
3. Lock your phone and review your linked devices.

> [!note]
> Encryption is one layer of protection. It works best together with the steps in the [accounts guide](/guides/accounts/).
