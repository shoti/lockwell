---
title: Secure your accounts and passwords
description: A step-by-step checklist to protect your email, social media and other accounts: a password manager, unique passwords, two-step verification and passkeys.
summary: Protect your email, social media and other accounts from takeover, the most common way people get hacked.
audience: everyone
group: start
icon: key
order: 1
time: 60
reviewed: 2026-11-11
status: published
---

Most account break-ins don't need clever hacking. Attackers try passwords that leaked from other sites, or trick people into handing over a login code. This guide closes those doors. The four **Essential** items take about half an hour. Start with your email account: whoever controls it can reset the passwords of your other accounts.

## Use a password manager {#password-manager .essential}

A password manager creates a long, different password for every account, stores them and fills them in for you. You remember one main password, or just your phone's screen lock. The one built into your phone is a sound choice for most people. A separate app is worth it if you use both Apple and Android or Windows devices: Bitwarden and Proton Pass are open source, independently audited and have free plans; 1Password is audited too, but not open source.

If your manager has its own main password, make it at least six random words. Let the manager's passphrase generator pick them, not you. You may write it on paper, as long as the paper stays at home in a safe place.

### iPhone {.ios}

1. Go to **Settings → General → AutoFill & Passwords** and turn on **AutoFill Passwords and Passkeys**.
2. When you create an account or change a password, tap **Use Strong Password** when your iPhone suggests one.
3. Find what you have saved in the **Passwords** app (iOS 18 and later).

### Android {.android}

1. Open **Settings**, search for **Password Manager** and select it.
2. Tap the settings icon at the bottom right and make sure **Offer to save passwords** is on.
3. On a Samsung phone, choose which service saves your passwords in **Settings → General management → Passwords, passkeys, and autofill → Preferred service**.

### Computer {.desktop}

1. Use the same manager as on your phone, so your passwords are in both places: Google Password Manager in Chrome, Apple's **Passwords** app on a Mac, or the app and browser extension of a separate manager.
2. Download a separate manager only from its own site, for example [bitwarden.com](https://bitwarden.com/) or [proton.me/pass](https://proton.me/pass).
3. Don't save passwords in a browser on a computer you share with people outside your home.

> [!note]
> Saved passwords are only as safe as the device they are on. Anyone who can unlock your phone or computer can use them, so the [screen lock](/guides/phone/#screen-lock) has to be a strong one.

## Change reused passwords, starting with your email {#unique-passwords .essential}

When a site is breached, attackers try the leaked passwords on email, social media and banking. A password you use in only one place can't open your other accounts. You don't need to change passwords on a schedule: change one when it is reused, weak or has leaked.

### All devices

1. List your most important accounts: email, Facebook, Instagram, online banking, government services.
2. Sign in to each and replace the password with one your password manager creates. You can also make one with our [password generator](/tools/password-generator/).
3. Do your email first, then the others.

### iPhone {.ios}

1. Open the **Passwords** app and tap **Security**.
2. Tap an account marked as reused, weak or leaked, then tap **Change Password**.
3. In **Settings → Apps → Passwords**, check that **Detect Compromised Passwords** is on.

### Google

1. Open [passwords.google.com](https://passwords.google.com/) and choose **Password Checkup**.
2. Change the compromised passwords first, then the reused ones.

> [!tip]
> [Have I Been Pwned](https://haveibeenpwned.com/) shows which known breaches include your email address. If a site is listed, change your password there, and on any other account where you used the same one.

## Turn on two-step verification {#two-step .essential}

With two-step verification, a new device needs your password and a second proof before it can sign in. A stolen password alone is then not enough. The methods are not equal: a passkey or security key is the strongest, an authenticator app or a prompt on your phone comes next, and codes by SMS are the weakest, because a phone number can be moved to another SIM card. SMS codes are still far better than nothing.

![Choose the strongest method each account offers.](figure:two-step-methods)

### Google

1. Open your [Google Account](https://myaccount.google.com/) and choose **Security & sign-in**.
2. Under "How you sign in to Google", select **Turn on 2-Step Verification** and follow the steps.
3. On the **2-Step Verification** page, open **Backup codes** and save the codes (see the next item).

### Apple

1. Open **Settings**, tap your name, then **Sign-In & Security**.
2. Tap **Two-Factor Authentication** and follow the steps.
3. Add a second trusted phone number if you have one. Apple sends codes to your other Apple devices or to a trusted number; you can't use an authenticator app here.

### Facebook and Instagram

1. In the Facebook app, tap the menu, then **Settings & privacy → Settings → Accounts Center**. In Instagram, go to your profile, tap the menu at the top right, then **Accounts Center**. You may see the name **Meta Account settings** instead.
2. Tap **Password and security → Two-factor authentication** and choose the account.
3. Choose an authentication app if you can, and follow the steps.

### Microsoft

1. Sign in at [account.microsoft.com/security](https://account.microsoft.com/security) and select **Manage how I sign in**.
2. Under **Two-step verification**, choose **Turn on**.

> [!warning]
> A login code is only ever typed into the app or site you are signing in to. If someone asks you to read out or send a code, by phone, SMS or chat, treat it as a scam, whoever they say they are. See [Never share login codes or passwords](/guides/phishing/#never-share).

## Make sure you can get back in {#recovery .essential}

Two-step verification can lock you out too: if you lose the phone and have no other way in, recovery can take days, or fail. Set up a second way now. Add the new phone number or email first and check that it works; only then remove the old one.

### Google

1. In your Google Account, open **Security & sign-in**.
2. Under "How you sign in to Google", check **Recovery phone** and **Recovery email**. Remove numbers and addresses that are no longer yours.
3. Open **2-Step Verification**, find **Backup codes** and choose **Get backup codes**. Print the ten codes or write them down, and keep them where you keep your important documents.

### Apple

1. Open **Settings**, tap your name, then **Sign-In & Security**.
2. Under **Two-Factor Authentication**, check your trusted phone numbers.
3. Tap **Recovery Contacts → Add Recovery Contact** and choose a person you trust. They can't see your data; they can only help you get back in. They need an iPhone, iPad or Mac with iMessage turned on.

### Facebook and Instagram

1. In **Accounts Center**, open **Personal details → Contact info** and check that the email addresses and phone numbers are yours.
2. Open **Password and security → Two-factor authentication**, choose the account, then **Additional methods**.
3. Choose **Recovery codes** on Facebook or **Backup codes** on Instagram, and write the codes down.

### Microsoft

1. Sign in at [account.microsoft.com/security](https://account.microsoft.com/security) and select **Manage how I sign in**.
2. Check that at least two ways to verify are listed, such as a phone number and a second email address, and that both are yours. With two-step verification on, your password alone won't get you back in.

> [!warning]
> Apple also offers a **Recovery Key**. Once it is on, Apple can no longer help you: if you lose the key, you lose the account for good. Most people are better off with a recovery contact.

## Switch to passkeys where they are offered {#passkeys .recommended}

A passkey lets you sign in with your phone's or computer's screen lock: fingerprint, face or PIN. You type nothing, so a fake login page has nothing to steal, and each passkey works only on the real site it was made for. Passkeys are kept in your password manager and reach your other devices through it. Create passkeys only on a phone or computer that is yours alone: anyone who can unlock that device can sign in with the passkey, even after you sign out.

While the account still has a password, a scammer can still trick you out of that password, so leave two-step verification on.

### Google

1. Open [myaccount.google.com/signinoptions/passkeys](https://myaccount.google.com/signinoptions/passkeys).
2. Choose **Create a passkey** and unlock your device when asked. An Android phone may have created one for you already.

### Microsoft

1. Sign in at [account.microsoft.com/security](https://account.microsoft.com/security) and select **Manage how I sign in**.
2. Choose **Add a new way to sign in or verify**, then **Face, Fingerprint, PIN, or Security Key**.

### Other sites

1. Sign in and look for **Passkeys** in the account's security settings.
2. When your phone offers to save a passkey for the account, accept.

## Sign out of devices you don't recognise {#devices .recommended}

Your account shows every phone and computer that is signed in. A device you can't explain may mean someone else is using the account. Check first that it isn't yours: an old phone, a phone you reset to factory settings, or a device whose location is shown only roughly.

### Google

1. Open [google.com/devices](https://www.google.com/devices).
2. Select a device you don't recognise and choose **Sign out**.
3. Then change your password.

### Apple

1. Open **Settings** and tap your name. The devices signed in to your Apple Account are listed near the bottom.
2. Tap a device you don't recognise, then **Remove from Account**.
3. Then change your Apple Account password.

### Facebook and Instagram

1. In **Accounts Center**, open **Password and security → Where you're logged in** and choose the account.
2. Choose **Select devices to log out**, mark the sessions you don't recognise and tap **Log out**.

### Microsoft

1. Sign in at [account.microsoft.com/security](https://account.microsoft.com/security) and select **Manage how I sign in**.
2. Scroll to **Sign out everywhere** and choose **Sign out**. It can take up to 24 hours to take effect.

If you find a device that isn't yours, someone may have got in: see [If your account was hacked](/guides/hacked/).

## Remove apps that can access your accounts {#third-party-access .advanced}

When you choose "Sign in with Google" or "Continue with Facebook" somewhere, that app or site is connected to your account, and some can read your data. Old connections stay until you remove them. If you signed up to a service this way, removing the connection signs you out of it, so check first that you have another way to sign in there.

### Google

1. Open [myaccount.google.com/linkedapps](https://myaccount.google.com/linkedapps).
2. Select an app you no longer use, choose **See details**, then **Remove access** or **Stop using Sign in with Google**.

### Facebook

1. On a computer, click your profile picture, then **Settings & privacy → Settings → Apps and websites**.
2. Next to an app you no longer use, click **Remove**.

### Apple

1. Open **Settings**, tap your name, then **Sign in with Apple**.
2. Select an app you no longer use and tap **Delete**.

> [!note]
> Removing access only affects the future. The app may keep what it has already collected.
