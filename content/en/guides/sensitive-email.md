---
title: Use email when it's sensitive
description: What email reveals even when encrypted, when not to use it, how encrypted providers and password-protected mail work, and how to avoid locking yourself out.
summary: Email leaves a record of who wrote to whom, when and about what. Move sensitive talk to Signal, keep subject lines bland, and save your recovery code before you rely on encrypted mail.
audience: high-risk
group: basics
order: 5
time: 35
progress: session
reviewed: 2026-11-12
status: published
---

Email is how most people first get in touch, but it was not built to keep secrets. This guide explains what email gives away, when to avoid it, and how encrypted providers and password-protected messages help or fall short. It describes providers without recommending one: each provider's facts come from its own pages.

## Know what email reveals {#what-email-reveals .essential}

Security in a Box says ordinary email is stored unencrypted on your provider's servers and your recipient's, and can sit on several of the recipient's devices.

1. Every email carries metadata: who wrote to whom, when, and usually the subject line. EFF calls it the envelope of a message and says end-to-end encryption doesn't hide it.
2. Depending on the provider, the header can also include the sender's IP address, which shows roughly where you were.
3. Even encrypted email services see some metadata. Proton says it can see sender and recipient addresses, the IP address incoming mail came from, attachment names, subject lines and times. Tuta says it can see sender and recipient addresses and the date. Apple says iCloud Mail is not end-to-end encrypted, even with Advanced Data Protection.
4. When you write to someone on another service, that service may keep a copy, Proton notes, whatever you use yourself.
5. Keep subject lines bland. Proton recommends subjects that say as little as possible about the content.

EFF says metadata can reveal a great deal about you even when the content stays secret.

## Decide when not to use email {#when-not-to-email .essential}

FPF warns that a single email between a reporter and a source already leaves a record with the providers, and moving to a safer channel later can't undo it.

1. For sensitive conversations, use Signal instead: see [Keep sensitive conversations private](/guides/sensitive-conversations/).
2. If a source writes to you by email, CPJ advises moving to an end-to-end encrypted app as soon as possible and deleting the original. CPJ notes that a copy is likely to stay on the provider's server anyway.
3. Publish a Signal contact so sources can skip email entirely: see [Plan how sources first reach you](/guides/sources-documents/#first-contact).
4. FPF notes it is hard to tell in advance when a conversation will become sensitive. Move early rather than late.

Encrypted email is still email: FPF notes that if you write to someone on Gmail, Google can read the message.

## Lock down the email account itself {#account-hardening .essential}

An attacker who gets into your email can read everything in it and reset your other passwords.

1. Use a security key or passkey where you can: see [Use security keys or passkeys instead of codes](/guides/strong-accounts/#phishing-resistant).
2. Check for forwarding addresses and filters you didn't create: see [Remove forwarding and filters in your email](/guides/hacked/#forwarding-and-rules).
3. Check which devices are signed in and sign out the ones you don't know. In Tuta: **Settings → Login**.
4. Proton says its recovery email or phone number can be used to switch off two-step verification. If that email or number is less protected than your account, it is a way in. On a separate address, don't add recovery details in your name at all: they link the account to you. Use the recovery phrase or code instead.
5. Security in a Box suggests giving made-up answers to security questions, and keeping them in your password manager.

See also [Plan how you will get back in](/guides/strong-accounts/#recovery-plan).

## Use a separate address for sensitive work {#separate-address .recommended}

CPJ advises a new email account used only for contact with a source, with no real name and not linked to your phone number or any account in your name.

1. Don't rely on aliases. Security in a Box says they can usually be traced back to your main address through the headers of messages you send.
2. Disposable inboxes can receive but not send, Security in a Box notes, so they don't work for a conversation.
3. Proton may ask you to solve a CAPTCHA or verify a phone number or email when you sign up. Its privacy policy says it keeps them only for a while, and long term only as a cryptographic hash. A number or address in your name still links the account to you. Proton says people using Tor Browser are more likely to be asked for a phone or email.
4. Tuta says it needs no phone number to sign up, but may hold new accounts for approval, usually within 24 hours on working days, and can't send or receive until then. Tuta says this often affects people using a VPN or Tor.
5. Sign in regularly: Tuta deletes free accounts after six months without a login, and Proton deletes inactive free accounts too. Its own page gives different periods, so sign in at least once a year.

A separate address helps only if you never mix it with your own: don't sign in to both on the same device at the same time, and don't forward between them. See [Avoid the mistakes that give you away](/guides/anonymity/#mistakes).

## Know what encrypted providers protect {#encrypted-providers .recommended}

Proton and Tuta encrypt mail so that they can't read the content of your stored messages. What that covers depends on who you write to.

### Proton

1. Messages between Proton users are end-to-end encrypted in transit, Proton says. Mail to other providers isn't end-to-end encrypted unless you send a password-protected email.
2. Proton says subject lines are not end-to-end encrypted, because it follows the OpenPGP standard.
3. If you reset your password with a recovery email or phone number, Proton says you get back into the account but may not be able to read your existing mail. To unlock it you need a data recovery method, such as the recovery phrase. Save the phrase in your password manager before you rely on the account.

### Tuta

1. Tuta says mail between Tuta users is end-to-end encrypted automatically, and that it encrypts the subject, content and attachments. Mail to other providers needs a shared password.
2. Tuta can be set to send unencrypted by default (**Not confidential**). Check the lock symbol before you send to an outside address.
3. To reset your password or two-step verification, Tuta needs two of three: your password, your second factor and your recovery code. Lose both the password and the second factor, and the account can't be recovered. Save the recovery code: **Settings → Login → Recovery code**.

FPF notes that Proton is not built to hide who you are: assume your provider can identify you. The other person's provider is not covered by either service's encryption.

## Use password-protected mail with care {#password-protected-mail .recommended}

Some services let you send an encrypted message to someone on another provider, who opens it with a password.

### Proton

1. Write the message, click the lock icon (**External encryption**), set a password and an optional hint, and click **Set encryption**. Send the password another way, such as in person or over Signal.
2. Proton says your reply to their reply is not end-to-end encrypted by default: turn the lock on again each time.
3. The message expires after 28 days at most, including time spent in drafts, and the recipient can reply at most five times, Proton says. Save what you need elsewhere.

### Tuta

1. When you enter an outside address, Tuta asks you to set a shared password. Tuta says to share it another way, such as in person or over Signal. The recipient opens the message from a link in a notification email.

### Gmail and Outlook

1. Gmail's confidential mode is not the same as encryption. Google says the recipient gets only a link to the content, that the subject and link are sent as ordinary email, and that recipients can still take screenshots or use other apps to copy the message. In Google Workspace, the organisation can keep copies.
2. In Outlook.com, encryption needs a Microsoft 365 subscription. Microsoft says that with **Do Not Forward**, PDFs and images can still be downloaded without encryption.

None of these protects the message once the recipient has opened it.

## Watch what attachments and images give away {#attachments .recommended}

Files and pictures in email can reveal more than the message.

1. Remove hidden data from files before you send them: see [Remove hidden data from files](/guides/sources-documents/#metadata-in-files).
2. Images loaded from the internet can tell the sender that you opened the message, and sometimes where you are. Turn off automatic loading, or use a setting that loads images privately.

### Gmail

1. On a computer: **Settings → See all settings**, then in **Images** choose **Ask before displaying external images** and **Save Changes**. On Android: **Menu → Settings**, your account, then under **Data usage** tap **Images** → **Ask before showing**.

### Apple Mail

1. On iPhone: **Settings → Apps → Mail → Privacy Protection**, and turn on **Protect Mail Activity**. It loads remote content privately in the background rather than blocking it. On a Mac: **Mail → Settings → Privacy**. Apple says this doesn't cover links or attachments, and doesn't hide your IP address on a network where **Limit IP Address Tracking** is off.

### Outlook.com

1. In **Privacy and data** settings, **Always use the Outlook service to load images** loads them through Microsoft's proxy instead of from your device. It doesn't block them.

Google notes that when images load, senders may sometimes know you opened the email.

## Know the limits of OpenPGP {#openpgp .advanced}

OpenPGP lets you encrypt email yourself, with any provider. EFF says tools like it are rarely used now and take technical skill to use safely.

1. OpenPGP doesn't hide who wrote to whom or when. In Proton the subject isn't encrypted; Thunderbird encrypts it by default, but other apps may then show only "...". Keep subjects bland either way.
2. Thunderbird has OpenPGP built in since version 78. The old Enigmail add-on is no longer used.
3. Both people need to set it up correctly, and a mistake can send a message unencrypted. If the other person uses Signal, that is usually simpler.

Security in a Box lists OpenPGP tools as an advanced step. Use them if your contacts already do, not as your first protection.
