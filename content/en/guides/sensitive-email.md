---
title: Use email when it's sensitive
description: What email reveals even when encrypted, when not to use it, how encrypted providers and password-protected mail work, and how to avoid locking yourself out.
summary: Email leaves a record of who wrote to whom, when and about what. Move sensitive talk to Signal, keep subject lines bland, and save your recovery code before you rely on encrypted mail.
audience: high-risk
group: basics
icon: mail
order: 5
time: 35
progress: session
reviewed: 2026-11-12
status: published
---

Email is how most people first get in touch, but it was not built to keep secrets. This guide explains what email gives away, when to avoid it, and how encrypted providers and password-protected messages help or fall short. It describes providers without recommending one: each provider's facts come from its own pages.

## Know what email reveals {#what-email-reveals .essential}

Security in a Box's [guide to secure email](https://securityinabox.org/en/communication/secure-email/) says ordinary email is stored unencrypted on your provider's servers and your recipient's, and can sit on several of the recipient's devices.

1. Every email carries metadata: who wrote to whom, when, and usually the subject line. EFF calls metadata [the digital equivalent of an envelope](https://ssd.eff.org/module/why-metadata-matters) and says [end-to-end encryption protects only the content](https://ssd.eff.org/module/communicating-others), not who you talk to or when.
2. Depending on the provider, the header can also include the sender's IP address, which shows roughly where you were.
3. Even encrypted email services see some metadata. [Proton's Mail privacy policy](https://proton.me/mail/privacy-policy) says it can see sender and recipient addresses, the IP address incoming mail came from, attachment names, subject lines and times. [Tuta's security FAQ](https://tuta.com/support/security) says it can see sender and recipient addresses and the date. [Apple's iCloud data security overview](https://support.apple.com/en-us/102651) says iCloud Mail is not end-to-end encrypted, even with Advanced Data Protection.
4. When you exchange mail with someone on another service, that service may be able to read it or keep a copy, Proton's [encryption explainer](https://proton.me/support/proton-mail-encryption-explained) notes, whatever you use yourself.
5. Keep subject lines bland. Proton recommends subjects that say as little as possible about the content.

![Keep subject lines bland: most providers can read them.](figure:email-envelope)

EFF's [guide to why metadata matters](https://ssd.eff.org/module/why-metadata-matters) says metadata can reveal a great deal about you even when the content stays secret.

## Decide when not to use email {#when-not-to-email .essential}

FPF's [article on journalism and email](https://freedom.press/digisec/blog/journalisms-treacherous-relationship-with-email/) warns that a single email between a reporter and a source already leaves a record with the providers, and moving to a safer channel later can't undo it.

1. For sensitive conversations, use Signal instead: see [Keep sensitive conversations private](/guides/sensitive-conversations/).
2. If a source writes to you by email, CPJ's [advice on protecting sources](https://cpj.org/2021/11/digital-physical-safety-protecting-confidential-sources/) is to move to an end-to-end encrypted app as soon as possible and, where possible, delete the original. CPJ notes that a copy is likely to stay on the provider's server anyway.
3. Publish a Signal contact so sources can skip email entirely: see [Plan how sources first reach you](/guides/sources-documents/#first-contact).
4. FPF notes it is hard to tell in advance when a conversation will become sensitive. Move early rather than late.

Encrypted email is still email: FPF's [article on Proton and anonymity](https://freedom.press/digisec/blog/proton-mail-is-not-for-anonymity/) notes that if you write to someone on Gmail, Google can read the message.

## Lock down the email account itself {#account-hardening .essential}

An attacker who gets into your email can read everything in it and reset your other passwords.

1. Use a security key or passkey where you can: see [Use security keys or passkeys instead of codes](/guides/strong-accounts/#phishing-resistant).
2. Check for forwarding addresses and filters you didn't create: see [Remove forwarding and filters in your email](/guides/hacked/#forwarding-and-rules).
3. Check which devices are signed in and sign out the ones you don't know. In Tuta: **Settings → Login**.
4. Proton's [two-factor authentication help](https://proton.me/support/two-factor-authentication-2fa) says its recovery email or phone number can be used to switch off two-step verification. If that email or number is less protected than your account, it is a way in. On a separate address, don't add recovery details in your name at all: they link the account to you. Use the recovery phrase or code instead.
5. Security in a Box suggests giving made-up answers to security questions. Keep those answers in your password manager.

See also [Plan how you will get back in](/guides/strong-accounts/#recovery-plan).

## Use a separate address for sensitive work {#separate-address .recommended}

CPJ's [advice on protecting sources](https://cpj.org/2021/11/digital-physical-safety-protecting-confidential-sources/) suggests a new email account used only for contact with a source, with no real name and not linked to your phone number or any account in your name.

1. Don't rely on aliases. Security in a Box's [guide to secure email](https://securityinabox.org/en/communication/secure-email/) says they can usually be traced back to your main address through the headers of messages you send.
2. Disposable inboxes can receive but not send, Security in a Box notes, so they don't work for a conversation.
3. Proton's [human verification help](https://proton.me/support/human-verification) says you may be asked to solve a CAPTCHA or verify a phone number or email when you sign up. [Proton's privacy policy](https://proton.me/legal/privacy) says it keeps them only temporarily, and anything kept permanently only as a cryptographic hash. A number or address in your name still links the account to you. Proton says people using Tor Browser are more likely to be offered only email or SMS verification.
4. [Tuta's security FAQ](https://tuta.com/support/security) says it needs no phone number to sign up. Its [general FAQ](https://tuta.com/support/general) says it may hold new accounts for approval (as of November 2026, usually within 24 hours on working days), and that they can't send or receive until then. Tuta says this often affects people using a VPN or Tor.
5. Sign in regularly. As of November 2026, [Tuta's general FAQ](https://tuta.com/support/general) says it deletes free accounts after six months without a login, and [Proton's page on inactive accounts](https://proton.me/support/inactive-accounts) says Proton deletes inactive free accounts too. That page gives both one and two years, so sign in at least once a year. These periods may change.

A separate address helps only if you never mix it with your own: don't sign in to both on the same device at the same time, and don't forward between them. See [Avoid the mistakes that give you away](/guides/anonymity/#mistakes).

## Know what encrypted providers protect {#encrypted-providers .recommended}

Proton and Tuta say they store your mail encrypted so that they can't read the text and attachments of stored messages. Between two Proton users, or two Tuta users, the text and attachments are end-to-end encrypted, and Tuta also encrypts the subject. Neither hides sender and recipient addresses or times, and Proton can also see subject lines, attachment names and the IP address incoming mail came from (see [what email reveals](#what-email-reveals)). The rest depends on who you write to.

### Proton

1. Messages between Proton users are end-to-end encrypted in transit, Proton's [encryption explainer](https://proton.me/support/proton-mail-encryption-explained) says. Mail to other providers isn't end-to-end encrypted unless you send a password-protected email.
2. Proton says subject lines are not end-to-end encrypted so that its mail stays compatible with email standards, including OpenPGP, in which the subject is not end-to-end encrypted.
3. If you reset your password with a recovery email or phone number, Proton's [password reset help](https://proton.me/support/reset-password) says you get back into the account but may not be able to read your existing mail. To unlock it you need a data recovery method, such as the recovery phrase. Save the phrase in your password manager before you rely on the account.

### Tuta

1. [Tuta's general FAQ](https://tuta.com/support/general) says mail between Tuta users is end-to-end encrypted automatically, and [its security FAQ](https://tuta.com/support/security) says it encrypts the subject, content and attachments. Mail to other providers needs a shared password.
2. Tuta can be set to send unencrypted by default (**Not confidential**). Check the lock symbol before you send to an outside address.
3. To reset your password or two-step verification, [Tuta's how-to FAQ](https://tuta.com/support/howto) says you need two of three: your password, your second factor and your recovery code. Lose both the password and the second factor, and the account can't be recovered. Save the recovery code: **Settings → Login → Recovery code**.

FPF's [article on Proton and anonymity](https://freedom.press/digisec/blog/proton-mail-is-not-for-anonymity/) says Proton is not built to hide who you are, and that most people should assume they can be identified when using it. The other person's provider is not covered by either service's encryption.

## Use password-protected mail with care {#password-protected-mail .recommended}

Some services let you send an encrypted message to someone on another provider, who opens it with a password.

### Proton

1. Write the message, click the lock icon (**External encryption**), set a password and an optional hint, and click **Set encryption**. Send the password another way, such as in person or over Signal.
2. Proton says your reply to their reply is not end-to-end encrypted by default: turn the lock on again each time.
3. As of November 2026, Proton's [help page on password-protected emails](https://proton.me/support/password-protected-emails) says the message expires after 28 days at most, including time spent in drafts, and that the recipient can reply at most five times. Save what you need elsewhere.

### Tuta

1. When you enter an outside address, Tuta asks you to set a shared password. Tuta's [guide to sending encrypted email](https://tuta.com/blog/email-encryption-guide-how-send-encrypted-email) says to share it another way, such as in person or over Signal. The recipient opens the message from a link in a notification email.

### Gmail and Outlook

1. Gmail's confidential mode is not the same as encryption. Google says the recipient gets only a link to the content, that the subject and link are sent as ordinary email ([Google Workspace admin help](https://knowledge.workspace.google.com/admin/gmail/advanced/protect-gmail-messages-with-confidential-mode)), and that recipients can still take screenshots or use other apps to copy the message ([Gmail help on confidential mode](https://support.google.com/mail/answer/7674059?hl=en)). In Google Workspace, the organisation can keep copies.
2. In Outlook.com, encryption needs a Microsoft 365 subscription. Microsoft's [help on sending encrypted messages](https://support.microsoft.com/en-us/outlook/send-encrypted-messages-with-a-microsoft-365-personal-or-family-subscription) says that with **Do Not Forward**, PDFs and images can still be downloaded without encryption.

None of these protects the message once the recipient has opened it.

## Watch what attachments and images give away {#attachments .recommended}

Files and pictures in email can reveal more than the message.

1. Remove hidden data from files before you send them: see [Remove hidden data from files](/guides/sources-documents/#metadata-in-files).
2. Images loaded from the internet can tell the sender that you opened the message, and sometimes where you are. Turn off automatic loading, or use a setting that loads images privately.

### Gmail

1. On a computer: **Settings → See all settings**, then in **Images** choose **Ask before displaying external images** and **Save Changes**. On Android: **Menu → Settings**, your account, then under **Data usage** tap **Images** → **Ask before showing**.

### Apple Mail

1. On iPhone: **Settings → Apps → Mail → Privacy Protection**, and turn on **Protect Mail Activity**. On a Mac: **Mail → Settings → Privacy**. Apple says it hides your IP address from senders and stops them seeing whether you opened the message ([Apple's iPhone guide](https://support.apple.com/guide/iphone/use-mail-privacy-protection-iphf084865c7/ios)), and that on a Mac it downloads remote content privately in the background rather than blocking it ([Apple's Mac guide](https://support.apple.com/guide/mail/change-privacy-settings-mlhlae4a4fe6/mac)). Apple says this doesn't cover links or attachments, and doesn't hide your IP address on a network where **Limit IP Address Tracking** is off.

### Outlook.com

1. According to Microsoft's [help on external image protection](https://support.microsoft.com/en-us/office/external-image-protection-in-outlook-com-43c0c17e-8fd1-41c6-93fe-ffe54638e82b), in **Privacy and data** settings, **Always use the Outlook service to load images** loads them through Microsoft's proxy instead of from your device. It doesn't block them.

Google notes in [Gmail's help on images](https://support.google.com/mail/answer/145919?hl=en) that when images load, senders may sometimes know you opened the email.

## Know the limits of OpenPGP {#openpgp .advanced}

OpenPGP lets you encrypt email yourself, with any provider. EFF's [guide to communicating with others](https://ssd.eff.org/module/communicating-others) says tools like it are rarely used now and take technical skill to use safely.

1. OpenPGP doesn't hide who wrote to whom or when. In Proton the subject isn't end-to-end encrypted. As of November 2026, Thunderbird encrypts it by default and puts "..." in its place, so other apps may show only "..." ([Thunderbird's default settings in its source code](https://searchfox.org/comm-central/source/mail/extensions/am-e2e/prefs/e2e-prefs.js)). Keep subjects bland either way.
2. Thunderbird has OpenPGP built in since version 78. The old Enigmail add-on is no longer used ([Mozilla's Thunderbird OpenPGP wiki](https://wiki.mozilla.org/Thunderbird:OpenPGP)).
3. Both people need to set it up correctly, and a mistake can send a message unencrypted. If the other person uses Signal, that is usually simpler.

Security in a Box's [guide to secure email](https://securityinabox.org/en/communication/secure-email/) lists OpenPGP tools as an advanced step. Use them if your contacts already do, not as your first protection.
