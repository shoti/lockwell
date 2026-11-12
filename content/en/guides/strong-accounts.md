---
title: Make your accounts hard to take over
description: Security keys, passkeys, Google Advanced Protection, Apple's strongest account settings and fewer SMS codes, with a recovery plan so you don't lock yourself out.
summary: Codes can be phished; security keys can't. Add keys, turn on the strictest account settings and plan how you will get back in if you lose them.
audience: high-risk
group: basics
order: 3
time: 60
progress: session
reviewed: 2026-11-12
status: published
---

The [accounts guide](/guides/accounts/) covers the basics: a password manager, two-step verification and backup codes. Do it first. This guide is for people who expect someone to try hard to get into their accounts. It replaces codes that can be phished with keys that can't, and turns on the strictest settings Google, Apple and Meta offer. The strongest settings also make it easier to lock yourself out, so read [Plan how you will get back in](/guides/strong-accounts/#recovery-plan) before you change anything.

## Use security keys or passkeys instead of codes {#phishing-resistant .essential}

A fake login page can ask for your password and the code from an SMS or an authenticator app, and pass both to the real site at once. A security key or passkey doesn't work on a site it wasn't registered for, so it can't be phished this way. CISA advises people who are targeted to use them, and not to use SMS: someone with access to the phone network can read SMS codes, and a number can be moved to another SIM.

### All accounts

1. Add a security key or passkey to your most important accounts first: email, Google or Apple, your password manager, social media. For passkey basics, see [Switch to passkeys where they are offered](/guides/accounts/#passkeys).
2. CISA calls hardware security keys the most effective option and passkeys an acceptable alternative.
3. Once a key or passkey works, remove SMS as a second step where the service lets you: see [Remove SMS where you can](/guides/strong-accounts/#remove-sms).

If you still have a password, a fake site can say your passkey failed and ask for the password instead: don't type it. A passkey saved in a password manager can be used by anyone who gets into that password manager. Keys protect new sign-ins; Google notes that a device that stays signed in may not ask for the key again, so someone holding your unlocked phone is already past it.

## Set up two security keys {#security-keys .essential}

A security key is a small device that you plug in or hold against your phone. Get two and register both: carry one and keep the other in a safe place. Apple requires at least two, and Google recommends a backup key. Before you buy, check that the connector fits your devices: Apple says keys with both NFC and USB-C work with most of its devices. To store a passkey on the key, Google needs one that supports FIDO2.

### Google

1. In your Google Account, open **Security & sign-in**. Under **How you sign in to Google**, select **Passkeys and security keys**, then **Create a passkey**, and add your keys.
2. A new key may only work for sign-in after 7 days. If you already have a trusted key or passkey, you may be able to approve it sooner. Add keys well before you travel.

### Apple

1. You need iOS 16.3 or macOS Ventura 13.2 or later on every device signed in to your Apple Account.
2. On iPhone, open **Settings**, tap your name, then **Sign-in & Security → Two-Factor Authentication → Security Keys → Add Security Keys**. On a Mac: **System Settings**, your name, **Sign-in & Security → Two-Factor Authentication**, then **Set Up** next to **Security Keys**.
3. Setup signs you out of devices you haven't used for 90 days. Older devices that can't be updated can't sign in again.
4. Afterwards, only a key or a trusted Apple device signs you in. Apple warns that if you lose all your keys and trusted devices, you could be locked out permanently.

### Microsoft

1. Open **Advanced Security Options** at [account.live.com/proofs/manage](https://account.live.com/proofs/manage), choose **Add a new way to sign in or verify**, then **Face, Fingerprint, PIN, or Security Key**, and save the passkey to **Security key**.

### Facebook

1. Open **Settings & Privacy → Settings**, then **Accounts Center → Password and security** or **Meta Account → Login and security** (you may see either). Then choose **Two-factor authentication**, then **Security key** (or **Security keys**), and **Register security key**.
2. Facebook says a key doesn't replace your password, and asks you to keep a second two-factor method as a backup.

A key protects only the accounts you add it to, and only the sign-ins that ask for it.

## Plan how you will get back in {#recovery-plan .essential}

The stronger the account, the harder the way back in. Prepare before you need it.

### All accounts

1. Keep the second key, printed backup codes (a Google account in Advanced Protection has none) and any recovery key away from your phone, in more than one place: Apple suggests one at home and one at work.
2. Don't keep an Apple recovery key in Apple Passwords, Notes, iCloud Drive or Photos: if you are locked out, you can't open them. Print it or write it down.
3. Add a Google recovery contact: see [Make sure you can get back in](/guides/accounts/#recovery). It can be used only 7 days after they accept.
4. Know the waits. If you lose your keys, Google takes a few days to check it's you. Apple's account recovery can take several days or longer, and using another signed-in Apple device during the wait cancels it. If you set up a recovery key or security keys, don't count on account recovery to get you back in.
5. If a signed-in phone or computer is lost, stolen or taken from you, treat the accounts on it as compromised: follow [If your account was hacked](/guides/hacked/).

Backup codes and recovery keys are as powerful as your password: anyone who finds them can get in. Keep them as carefully as the keys.

## Join Google's Advanced Protection Program {#advanced-protection .essential}

Google recommends Advanced Protection for journalists, activists, campaign staff and anyone at elevated risk of targeted attacks, and CISA recommends it to Gmail users. It costs nothing.

### Google

1. Before you start, add a recovery email and phone number, turn on two-step verification, and have two security keys or passkeys ready.
2. Go to [landing.google.com/advancedprotection](https://landing.google.com/advancedprotection/), select **Get started** and follow the instructions.
3. What changes: every new device needs your key or passkey. Only Google apps and verified apps can reach your Google data. App passwords stop working, so some mail apps lose access. On Android, new apps install only from Google Play and preinstalled stores. Chrome may offer to send a download it can't check to Google for scanning. Recovery takes extra checks and a few days.
4. Google recommends enrolling both your work and personal accounts.
5. When you travel, take a key with you.

### Facebook

1. Facebook offers Advanced Protection to accounts at higher risk, including journalists and politicians. Some accounts are required to join and can't leave it.
2. If Facebook asks you to turn it on, tap **Get Started** on the notice in your Feed and follow the steps. Don't ignore it: a required account that doesn't finish setup can lose access. Open the notice in the app rather than through a link in an email; real emails about it come from security@facebookmail.com.

This protects the account, not the phone: for the phone, see [Turn on Advanced Protection on Android](/guides/phone-hardening/#advanced-protection). It doesn't help against someone who already has one of your signed-in devices.

## Use Apple's strongest account settings {#apple-protections .recommended}

Apple adds two options for people at risk: Advanced Data Protection, which encrypts more of your iCloud data end to end, and a recovery key. Security keys are covered above.

### Apple Account

1. Turn on **Advanced Data Protection**: on iPhone, **Settings**, your name, **iCloud → Advanced Data Protection → Turn on Advanced Data Protection**. You must first set up a recovery contact or a recovery key.
2. It end-to-end encrypts 25 kinds of data, including iCloud Backup, Photos, Notes and iCloud Drive. It doesn't cover iCloud Mail, Contacts or Calendars, Shared Albums, iWork collaboration, or anything shared with "anyone with the link". Shared folders, notes and photo libraries stay end-to-end encrypted only if everyone you share with has it on too. Some details, such as device names and file names, stay readable to Apple.
3. With it on, iCloud.com can't open your data unless you allow it, and Apple can't recover your data for you.
4. A recovery key is optional: **Settings**, your name, **Sign-in & Security → Recovery Key**. It turns off Apple's usual account recovery. It works only together with one of your trusted phone numbers and an Apple device, so keep that number paid and in your control. If you lose the key, you are locked out permanently. If you can't keep it safe, use a recovery contact instead.
5. If you use Google on an iPhone, Google says an iCloud backup can contain your Google sign-in, so someone who gets into iCloud may get into Google. Google advises security keys on your Apple Account too.

Advanced Data Protection protects data on Apple's servers, not data on an unlocked phone.

## Remove SMS where you can {#remove-sms .recommended}

Adding a key doesn't remove SMS. CISA warns that a leftover SMS option is a weak point an attacker can use. Some services still use SMS for recovery, so you may not get rid of it completely.

### Google

1. After your keys work, open the **2-Step Verification** page and remove the phone as a second step if Google lets you keep only keys and passkeys.

### Apple

1. Apple needs at least one trusted phone number. If you have a second number that isn't on your iPhone, add it in **Settings**, your name, **Sign-In & Security → Two-Factor Authentication**.

### Microsoft

1. Microsoft says it is phasing out SMS for personal accounts. Until it is gone from yours, a passwordless account can still use SMS codes. Add a passkey and a verified email address, then remove your phone number in **Advanced Security Options**.

### Mobile operator

1. Ask your operator whether you can set a PIN or password that is needed to change your SIM or move your number. CISA and EFF both advise it. What Georgian operators offer was not checked for this guide.
2. Magti lets you replace a SIM with an eSIM through MyMagti, so protect your MyMagti login like your email.

Your number can still reach some accounts through recovery, and your operator can still see your SMS.

## Check sign-in activity {#login-alerts .recommended}

Check your accounts' activity pages now and then, and react to alerts at once.

### Google

1. In **Security & sign-in**, find **Recent security events** and select **Review security events**. For anything you don't recognise, select **No, it wasn't me**.
2. At [myaccount.google.com/security](https://myaccount.google.com/security), open **Recent security activity**. If a sign-in method is flagged and you didn't add it, select **Remove**.

### Microsoft

1. Open the **Recent activity** page at [account.live.com/Activity](https://account.live.com/Activity). It shows the last 30 days. For unusual activity, choose **This wasn't me** or **This was me**.
2. Mobile networks, travel, VPNs and Tor can make a sign-in look as if it came from another place.

### All accounts

1. If you get a sign-in prompt you didn't start, don't approve it, and change your password.
2. Never share a code, even if someone asks for it in the company's name.

Activity pages don't show everything: Microsoft says so itself. A quiet page doesn't prove nobody has access.

## Keep separate identities apart {#separate-identities .advanced}

If you have a public role, NCSC suggests separate accounts for work and personal life. If an account must not be linked to you, it needs its own email address, phone number, photos and contacts.

### All accounts

1. Use a separate email address and, if you can, no phone number. Both can link accounts together. With SMS two-step verification, the company has your number.
2. Use a profile photo that you don't use anywhere else.
3. Don't follow, like or share between your identities, and try not to have the same contacts follow both.
4. Turn off finding you by phone number or email: see [Stop being found by your phone number or email](/guides/social-media/#find-by-contact).
5. If you use a separate number, keep paying for it. A number you give up can be given to someone else, and an account tied to it becomes harder to recover.
6. Use a separate browser or browser profile for each identity. For stronger separation, use separate devices.

Separate accounts can still be linked: Google can add a verified phone number on an Android phone to any Google Account signed in on it, and accounts used from the same internet connection can be connected.
