---
title: If your phone or computer may be taken
description: What encryption protects and when, what a locked phone still shows, what sits in the cloud anyway, and how to prepare for your phone or computer being taken.
summary: Encryption protects a device that is switched off, not one that is unlocked. Know what stays readable, keep less on the device and plan who you will call.
audience: high-risk
group: situations
icon: phoneAlert
order: 8
time: 40
progress: session
reviewed: 2026-11-14
status: published
---

Your phone or computer can be taken in a search, at a border, at a protest, or stolen by someone who targets you. This guide covers what protects the data on it and what doesn't. It says nothing about whether you must unlock a device or give a password: that depends on where you are, so ask a lawyer. For the moment itself, see [If you are detained or your phone is taken](/guides/protest/#if-detained).

## Check that encryption is on {#encryption-on .essential}

Phones and newer computers encrypt their storage, but only a passcode makes that encryption mean something. A long passcode is harder to break: see [Use a long passcode](/guides/phone-hardening/#strong-passcode).

### iPhone {.ios}

1. Set a passcode in **Settings → Face ID & Passcode** (on iPhone Duo or iPhone SE: **Touch ID & Passcode**). Apple says setting a passcode turns on data protection, which encrypts the iPhone's data.

### Android {.android}

1. Phones that launched with Android 10 or later are encrypted by design, and Google says all Pixel phones are encrypted by default. Set a PIN or password: see [Set a strong screen lock](/guides/phone/#screen-lock).

### Mac {.desktop}

1. Open **Apple menu → System Settings → Privacy & Security → FileVault** and check that it is on. On Macs with Apple silicon, FileVault is on by default from macOS 26.4, but it can be turned off.
2. Apple says your Mac's FileVault recovery key can show up in the Passwords app on an iPhone signed in to the same Apple Account. If that phone is taken unlocked, the key to your Mac may go with it. See [Encrypt the disk and keep the recovery key](/guides/computer/#disk-encryption).

### Windows

1. Open **Settings → Privacy & security → Device encryption** and check that it is on. If you don't see it, your PC may not support it: see [Encrypt the disk and keep the recovery key](/guides/computer/#disk-encryption).
2. Microsoft attaches the recovery key to your Microsoft account. Anyone who gets into that account can read it.

Encryption protects a device that is off or locked after a restart. Once you have unlocked it, the data is open to whoever holds it.

## Know why switching off matters {#before-first-unlock .essential}

Apple's and Android's own documents explain the difference. After a restart, most data stays locked until you enter your passcode. Once you have unlocked the phone, much of it stays readable in memory even after the screen locks again: on iPhone, this is the default for third-party app data. Freedom of the Press Foundation explains that forensic tools work much better on a phone that has been unlocked since it was switched on.

![A locked screen is not the same as switched off. If your phone may be taken, switch it off.](figure:phone-lock-states)

### All devices

1. If your phone may be taken, switch it off fully, not just to sleep. See [If you are detained or your phone is taken](/guides/protest/#if-detained) for how.
2. If you need to make a call, switch it on, call, and switch it off again.
3. Don't count on the phone restarting itself after some time: Freedom of the Press Foundation reports that a forensic vendor claims to get past the iPhone's automatic restart.
4. On a Mac or Windows PC, shut down rather than sleep: see [Encrypt and shut down your computer](/guides/device-seizure/#computer-seizure).

Switching off protects only a device that stays off until you choose to unlock it.

## Limit what a locked phone shows {#what-stays-readable .essential}

A locked phone can still show messages, calendar entries, controls and your emergency contacts.

### iPhone {.ios}

1. In **Settings → Notifications → Show Previews**, choose **When Unlocked** or **Never**.
2. In **Settings → Face ID & Passcode**, turn off what you don't need under **Allow Access When Locked**. Apple notes that this stops someone with your phone seeing personal information, but you lose quick access too.
3. In the Health app, check whether your Medical ID has **Show When Locked** on. It shows your emergency contacts to anyone holding the phone. Decide whether you need it.

### Android {.android}

1. Hide message content on the lock screen: see [Hide message previews on the lock screen](/guides/phone/#lock-screen).
2. Turn off Extend Unlock: **Settings → Security & privacy → More security & privacy → Extend Unlock**, then turn off on-body detection and trusted places, and remove trusted devices. Google warns that someone could keep the phone unlocked by imitating a trusted Bluetooth device.
3. Use Lockdown when you might be stopped: press the power and volume up buttons and tap **Lockdown**. Until you next unlock, it turns off fingerprint and face unlock, Extend Unlock and notifications. If you don't see it, turn on **Show lockdown option** first.

### All devices

1. Block data through the cable while the phone is locked: see [Block data through the cable while the phone is locked](/guides/phone-hardening/#usb-accessories). Freedom of the Press Foundation notes that forensic tools usually connect through the charging port.

None of these settings matter once the phone is unlocked.

## Keep less on the device {#less-on-device .essential}

What isn't on the device can't be taken from it. Security in a Box advises that if you could be put under pressure in detention, an empty device is safer than a full one.

### iPhone {.ios}

1. Delete messages you don't need, then empty **Recently Deleted** in Messages: deleted messages stay there for up to 30 days.
2. In **Settings → Apps → Messages → Keep Messages**, choose a shorter time than keeping them forever. Older conversations and attachments are deleted at once, so save any you need first.
3. Delete photos you don't need, then empty **Recently Deleted** in Photos.

### Android {.android}

1. Delete photos you don't need, then empty the trash in Google Photos: **Collections → Trash → More → Empty Trash → Delete permanently**. Photos on a memory card may stay there.

### All devices

1. Turn on disappearing messages in sensitive chats: see [Turn on disappearing messages](/guides/messaging/#disappearing).
2. Uninstall apps you don't need with you, and use a browser instead for accounts you rarely open.
3. Back up what you keep to a place that doesn't sync with the phone, then remove it from the device. With iCloud Photos or Google Photos backup on, deleting from the phone also deletes the cloud copy.

Deleted files can sometimes be recovered with specialist tools; encryption is what makes that hard. Messages you sent stay on the other person's phone.

## Know what is in the cloud anyway {#cloud-copies .recommended}

Much of what is on your phone is also in the cloud, where it can be reached without the phone. What is protected depends on your settings.

### iPhone {.ios}

1. With iCloud's standard protection, Apple holds the keys to your iCloud Backup, Photos, Notes and iCloud Drive. If iCloud Backup is on, the backup also holds the key to Messages in iCloud.
2. **Advanced Data Protection** moves those keys to your devices only: see [Use Apple's strongest account settings](/guides/strong-accounts/#apple-protections). iCloud Mail, Contacts and Calendars stay readable to Apple even then.

### Android {.android}

1. Google says some of your phone backup is end-to-end encrypted with your screen lock, but photos and videos in Google Photos are not.
2. On Samsung, Samsung Cloud's **Enhanced data protection** can encrypt some backups end to end (call logs, messages, settings, apps; message attachments may not be covered): **Settings → Security and privacy → More security settings → Enhanced data protection**. If you lose your devices and its recovery code, the data is gone.

Strong cloud encryption also means nobody, including the company, can recover your data if you lose your keys. Back up first.

## Encrypt and shut down your computer {#computer-seizure .recommended}

A computer that is asleep or locked usually keeps its encryption key in memory. A Mac with FileVault that is shut down asks for your password before anything can be read. A Windows PC does so only if it has a start-up PIN; otherwise only the Windows sign-in stands in the way.

### Mac {.desktop}

1. Keep FileVault on, and shut the Mac down when it may be taken, rather than closing the lid. With FileVault, your password is needed when it starts.
2. On a Mac with Apple silicon, there is no firmware password: Apple says FileVault gives the equivalent protection.

### Windows

1. Shut down or hibernate before the computer leaves your hands. Microsoft says that after sleep, no PIN is needed to reach the encrypted data, while hibernation locks the drive. That only helps if you have a start-up PIN (next step).
2. By default, BitLocker unlocks the drive at start-up without asking you anything. Microsoft recommends a start-up PIN against a skilled attacker with time. It needs Windows Pro, Enterprise or Education, not Home. Keep your recovery key first: if you forget the PIN, you need the key.

Encryption protects the disk, not your accounts: a computer that was signed in may still hold session data for your email and cloud services.

## Plan ahead {#plan-ahead .essential}

Decide before anything happens who you will call and what you want done.

### All devices

1. Write a lawyer's number and an emergency contact on paper and keep it on you.
2. Keep a list of your important accounts somewhere safe, so that you or someone you trust can sign them out quickly from another device.
3. Know where to get expert help: see [Know where to get expert help](/guides/threat-modelling/#get-help).
4. Remote erase through Find My or Find Hub needs the device to be online. On iPhone, an erase sent while the device is offline runs the next time it connects, which may be much later. Apple sends a confirmation email when you erase. On Android, the device then disappears from Find Hub, and a memory card may not be erased. Talk to a lawyer before you or anyone else erases a device that has been taken.
5. iPhone can erase itself after 10 wrong passcodes (**Erase Data** in **Face ID & Passcode**). Turn it on only if you have a recent backup: someone else's guesses can trigger it.

Plans that rely on others need them to be reachable and willing. Agree on it with them in advance.

## If your device is returned {#after-return .recommended}

CPJ advises replacing a device that was taken and returned, because a factory reset may not remove spyware. Security in a Box says it may be impossible to confirm that a device is clean.

### All devices

1. Don't use the returned device for anything sensitive until an expert has checked it.
2. From another trusted device, sign out of all sessions and change your important passwords: see [Sign out every other device](/guides/hacked/#sessions). If the authorities took it, EFF advises talking to a lawyer first.
3. If you can, replace the device. If you can't, reset it and set it up again from a backup made before it was taken.

Nobody can prove that a returned device is clean. Treat it as untrusted.
