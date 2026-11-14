---
title: Spyware aimed at you
description: What targeted spyware is, why there are usually no signs, how to tell a real threat warning from a fake, and what to do, and not do, if you think your phone is infected.
summary: Targeted spyware is rare, expensive and hard to see. Know the real warnings, don't wipe your phone before an expert looks at it, and make attacks harder.
audience: high-risk
group: threats
icon: bug
order: 9
time: 30
progress: session
reviewed: 2026-11-14
status: published
---

Targeted spyware can read everything on a phone, including encrypted chats, track its location and turn on its microphone. Apple says it is used against "a very small number of individuals", often journalists, activists, politicians and diplomats. This guide helps you take the risk seriously without panicking. The most important rule: if you think your phone is infected, don't reset or wipe it before you talk to an expert.

## Know what targeted spyware is {#who-is-targeted .essential}

Mercenary spyware is sold by companies such as NSO Group, Paragon and Cytrox, Access Now says, often only to governments. Apple says such attacks cost millions of dollars and are aimed at a few people because of who they are or what they do.

### All phones

1. **One-click** spyware needs you to tap a link sent by SMS, email, WhatsApp or social media.
2. **Zero-click** spyware needs nothing from you: it comes in through a flaw in an app or the phone's system.
3. Once installed, Amnesty says, it can read your messages, including in end-to-end encrypted apps such as Signal, because it reads them on the phone itself.
4. Stalkerware is different: cheap apps that someone close to you installs with access to your unlocked phone. See [If the person is close to you](/guides/spyware/#stalkerware).

Most malware is criminal and aimed at money, EFF notes. Being a journalist or activist raises your risk of targeted spyware; it doesn't mean you have it.

## Don't rely on warning signs {#warning-signs .recommended}

Access Now warns that sophisticated spyware may show nothing suspicious, and that seeing no signs "does not mean you are safe". Amnesty says it "leaves little to no trace".

### All phones

1. A hot, slow or quickly draining phone has many ordinary causes. Don't treat it as proof either way.
2. A real threat notification means more than any of these: see [Recognise a real threat notification](/guides/spyware/#threat-notifications).
3. Write down anything odd with the date, together with travel, sensitive work and strange messages around that time. Experts use these dates when they look for traces.

No list of symptoms can rule spyware in or out. Only an expert check can look for traces, and even that can't promise a phone is clean.

## Recognise a real threat notification {#threat-notifications .essential}

Apple, WhatsApp and Google warn some users about targeted attacks. Attackers also send fake warnings to trick you.

### iPhone {.ios}

1. Apple shows a threat notification on the lock screen and in **Settings**, sends an email from threat-notifications@email.apple.com, and shows a banner at the top of your page on account.apple.com.
2. A real notification never asks you to tap a link, open a file, install an app or profile, or give a password or code.
3. To check, type account.apple.com into your browser yourself and sign in. If Apple sent a notification, it is at the top of the page.
4. Apple calls these "high-confidence alerts" and recommends turning on [Lockdown Mode](/guides/phone-hardening/#lockdown-mode) and getting expert help.

### WhatsApp

1. WhatsApp may warn you in a chat from **WhatsApp Support**, with a system message at the top confirming it is the official account and a blue checkmark.

### Google

1. Gmail can show "Government-backed attackers may be trying to steal your password". Google means someone tried, within about the last month, to get into your account or computer, for example with fake emails, links or malicious downloads. It means someone tried, not that they succeeded.
2. Run Google's Security Checkup and consider [Google's Advanced Protection Program](/guides/strong-accounts/#advanced-protection).

Access Now compares a threat notification to a fire alarm: it says an attack was tried, often months earlier, not whether it worked. A missing notification doesn't mean you weren't targeted.

## Be careful with unexpected links {#suspicious-links .essential}

One-click spyware arrives as a link, often with an urgent or very personal message, sometimes from someone you know. EFF warns that well-targeted messages can fool trained people.

### All phones

1. Don't tap links you didn't expect, even from people you know. Check with the sender another way.
2. Don't paste a suspicious link into an online scanner such as VirusTotal: it shares what you submit with its partners and users. The site's [link checker](/tools/link-checker/) works on your device and sends the link nowhere, but it only reads the address and can't tell what the page behind it does.
3. Instead, take a screenshot of the message and ask a helpline how they want to receive it: see [Know where to get expert help](/guides/threat-modelling/#get-help).
4. On WhatsApp, if you think you are a target, turn on **Strict account settings** on your main phone: **Settings → Privacy → Advanced** (on Android, tap **⋮** first). It blocks attachments and media from unknown senders, turns off link previews and silences calls from unknown numbers. People who aren't in your contacts, such as new sources, can then no longer send you files.

Zero-click spyware needs no tap at all, so careful clicking doesn't protect you from it.

## If you think your phone is infected {#if-you-suspect .essential}

Access Now advises against erasing the phone: it doesn't necessarily prevent new infections, and it destroys the traces an expert needs.

### All phones

1. Don't reset, wipe or erase the phone, and keep it rather than throwing it away.
2. Contact a helpline soon: Access Now notes that data is overwritten every minute the phone stays on. Do it from another device if you can.
3. Ask the helpline what to do first, for example whether to make a backup to keep evidence, and how. Access Now suggests a backup; the experts may want a specific kind.
4. Don't discuss sensitive matters on the phone in the meantime.
5. Before you report anything to the authorities, Access Now suggests talking to the helpline and a lawyer.

Access Now says investigators rarely promise that a phone is fully safe. Some people replace the phone after a check; ask the experts.

## Know what an expert check involves {#checks-by-experts .recommended}

Experts look through system files and logs for traces of known spyware. Access Now says data should be collected in a way that exposes as little of your photos, contacts and messages as possible.

### iPhone {.ios}

1. Experts often work from a backup of the phone. Ask them before you make one.

### Android {.android}

1. On Android 16 or later (first on Pixel phones), **Intrusion Logging** keeps encrypted logs that experts can use: see [Turn on Advanced Protection on Android](/guides/phone-hardening/#advanced-protection). It has to be on before an attack; it can't find what happened earlier.
2. The logs record which websites you visit, Incognito included. Google keeps them for 12 months, and they can't be deleted sooner, even if you turn the feature off or close the account. If someone can force you to unlock your accounts, that is a year of your browsing. Once you download them, anyone who gets the file can read them: share them only with experts, through an end-to-end encrypted channel.

### All phones

1. Tools such as MVT are for experts, not self-checks: its makers say so, and that public lists of spyware traces can miss new attacks.
2. Be careful with security apps that promise to scan for spyware. Access Now notes that spyware makers test against popular detection tools, and that such an app sees a detailed picture of your life.
3. Ask the organisation how it will handle your data. Amnesty's Security Lab, for example, says it shares it only with your permission, unless the law requires it or it is needed to support you.

A clean result means no known traces were found. It doesn't prove the phone is clean.

## Make an attack harder {#reduce-risk .essential}

No setting makes you immune, but some close the most common ways in. The steps are in [Harden your phone against targeted attacks](/guides/phone-hardening/).

### All phones

1. Install updates as soon as they arrive: see [Install security updates as soon as they arrive](/guides/phone-hardening/#updates-first).
2. Turn on [Lockdown Mode](/guides/phone-hardening/#lockdown-mode) on iPhone or [Advanced Protection](/guides/phone-hardening/#advanced-protection) on Android. In March 2026 Apple and Amnesty's Security Lab said they knew of no successful mercenary spyware attack on a device with Lockdown Mode on.
3. Restart your phone regularly: see [Restart your phone regularly](/guides/phone-hardening/#restart).
4. Keep fewer apps and accounts on the phone, and if you can, separate work and personal phones: see [Keep fewer apps and connections](/guides/phone-hardening/#fewer-apps).

Even these settings can be beaten: in November 2026, researchers said they had broken into an iPhone with Lockdown Mode on in a test, after getting the user to open a file. No such attack has been confirmed in real use. These settings raise the cost of an attack; they don't end the risk.

## If the person is close to you {#stalkerware .recommended}

Stalkerware is usually installed by someone who had your unlocked phone, such as a partner or family member. The Coalition Against Stalkerware says the most common sign is that the person knows too much about what you do on your phone.

> [!warning]
> Removing stalkerware or changing your settings may be noticed, and can make the abuse worse. Removing it also deletes evidence. Before you change anything, make a safety plan, if you can with a support organisation: see [Weigh what protection costs](/guides/threat-modelling/#costs).

### iPhone {.ios}

1. **Settings → Privacy & Security → Safety Check** shows who and which apps you share with, and which devices are signed in to your Apple Account (iOS 16 or later). **Quick Exit** closes it at once.
2. Some iPhone stalkerware takes data from iCloud backups: check whether iCloud Backup was turned on without you, and which devices are signed in to your Apple Account. If someone else may know your Apple Account password, change it once you have a safety plan.

### All phones

1. Use a strong screen lock that the other person doesn't know: see [Set a strong screen lock](/guides/phone/#screen-lock).
2. Search for help from a device the person has never had access to.
3. Keep a log of what happens and when.

An antivirus scan may find common stalkerware, but a clean scan isn't proof. Safety Check doesn't cover non-Apple accounts or social media.
