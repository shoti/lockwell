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
legal: true
reviewed: 2026-11-12
status: published
---

Your phone or computer can be taken in a search, at a border, at a protest, or stolen by someone who targets you. This guide covers what protects the data on it and what doesn't. It says nothing about whether you must unlock a device or give a password: that depends on where you are, so ask a lawyer. For the moment itself, see [If you are detained or your phone is taken](/guides/protest/#if-detained).

## Check that encryption is on {#encryption-on .essential}

Phones and newer computers encrypt their storage, but only a passcode makes that encryption mean something. A long passcode is harder to break: see [Use a long passcode](/guides/phone-hardening/#strong-passcode). To set up encryption on a computer and keep its recovery key safe, see [Encrypt the disk and keep the recovery key](/guides/computer/#disk-encryption).

### iPhone {.ios}

1. Set a passcode in **Settings → Face ID & Passcode** (on iPhone Duo or iPhone SE: **Touch ID & Passcode**). [Apple says setting a passcode turns on data protection](https://support.apple.com/guide/iphone/set-a-passcode-iph14a867ae/ios), which encrypts the iPhone's data.

### Android {.android}

1. [Android requires phones that launched with Android 10 or later to use encryption](https://source.android.com/docs/security/features/encryption/file-based), and [Google says all Pixel phones are encrypted by default](https://support.google.com/pixelphone/answer/2844831?hl=en). Set a PIN or password: see [Set a strong screen lock](/guides/phone/#screen-lock).

### Mac {.desktop}

1. Open **Apple menu → System Settings → Privacy & Security → FileVault** and check that it is on. As of November 2026, [Apple's security guide says FileVault is turned on by default on a Mac with macOS 26.4 or later](https://support.apple.com/guide/security/data-protection-overview-secf6276da8a/web), but you can turn it off, so check it anyway.
2. [Apple says your Mac's FileVault recovery key is kept in the keychain and, with iCloud Keychain on, synced with your other passwords](https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web), so it can show up in the Passwords app on an iPhone signed in to the same Apple Account. If that phone is taken unlocked, the key to your Mac may go with it.

### Windows

1. Open **Settings → Privacy & security → Device encryption** and check that it is on. If you don't see it, [Microsoft says](https://support.microsoft.com/en-us/windows/device-encryption-in-windows-cf7e2b6f-3e70-4882-9532-18633605b7df) your PC may not support it, or you may be signed in without administrator rights.
2. If you set up Windows with a Microsoft account, Microsoft says device encryption is turned on and the recovery key is attached to that account. Anyone who gets into that account can read it.

Encryption protects a device that is off or locked after a restart. Once you have unlocked it, much of the data can be reached by whoever holds it.

## Know why switching off matters {#before-first-unlock .essential}

[Apple's Data Protection documentation](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web) and [Android's encryption documentation](https://source.android.com/docs/security/features/encryption/file-based) explain the difference. After a restart, most data stays locked until you enter your passcode. Once you have unlocked the phone, much of it stays readable in memory even after the screen locks again: on iPhone, this is the default for third-party app data. [Freedom of the Press Foundation explains](https://freedom.press/digisec/blog/police-forensic-tools-may-bypass-key-phone-security-feature/) that forensic tools work much better on a phone that has been unlocked since it was switched on.

![A locked screen is not the same as switched off. If your phone may be taken, switch it off.](figure:phone-lock-states)

### All devices

1. If your phone may be taken, switch it off fully, not just to sleep. See [If you are detained or your phone is taken](/guides/protest/#if-detained) for how.
2. If you need to make a call, switch it on, call, and switch it off again.
3. Don't count on the phone restarting itself after some time: [Freedom of the Press Foundation reports](https://freedom.press/digisec/blog/police-forensic-tools-may-bypass-key-phone-security-feature/) that, in a leaked training video, a forensic vendor's employee claims its tools get past the iPhone's automatic restart. The video does not explain how.
4. On a Mac or Windows PC, shut down rather than sleep: see [Encrypt and shut down your computer](/guides/device-seizure/#computer-seizure).

Switching off protects only a device that stays off until you choose to unlock it.

## Limit what a locked phone shows {#what-stays-readable .essential}

A locked phone can still show messages, calendar entries, controls and your emergency contacts.

### iPhone {.ios}

1. In **Settings → Notifications → Show Previews**, choose **When Unlocked** or **Never**.
2. In **Settings → Face ID & Passcode**, turn off what you don't need under **Allow Access When Locked**. [Apple notes](https://support.apple.com/guide/iphone/turn-on-lock-screen-features-iph9a2a69136/ios) that this stops someone with your phone seeing personal information, but you lose quick access too.
3. In the Health app, check whether your Medical ID has **Show When Locked** on. It shows your emergency contacts to anyone holding the phone. Decide whether you need it.

### Android {.android}

1. Hide message content on the lock screen: see [Hide message previews on the lock screen](/guides/phone/#lock-screen).
2. Turn off Extend Unlock: **Settings → Security & privacy → More security & privacy → Extend Unlock**, then turn off on-body detection and trusted places, and remove trusted devices. [Google warns](https://support.google.com/android/answer/9075927?hl=en) that someone could keep the phone unlocked by imitating a trusted Bluetooth device.
3. Use Lockdown when you might be stopped: press the power and volume up buttons and tap **Lockdown**. Until you next unlock, it turns off fingerprint and face unlock, Extend Unlock and notifications. If you don't see it, turn on **Show lockdown option** first.

### All devices

1. Block data through the cable while the phone is locked: see [Block data through the cable while the phone is locked](/guides/phone-hardening/#usb-accessories). [Freedom of the Press Foundation notes](https://freedom.press/digisec/blog/police-forensic-tools-may-bypass-key-phone-security-feature/) that forensic tools usually connect through the charging port.

None of these settings matter once the phone is unlocked.

## Keep less on the device {#less-on-device .essential}

What isn't on the device can't be taken from it. [Security in a Box advises](https://securityinabox.org/en/blog/2025-09-detentions/) that if you could be put under pressure in detention, an empty device is safer than a full one.

### iPhone {.ios}

1. Delete messages you don't need, then empty **Recently Deleted** in Messages: as of November 2026, [Apple says deleted messages stay there for up to 30 days](https://support.apple.com/guide/iphone/delete-messages-and-attachments-iph2c9c4bfcb/ios).
2. In **Settings → Apps → Messages → Keep Messages**, choose a shorter time than keeping them forever. Older conversations and attachments are deleted at once, so save any you need first.
3. Delete photos you don't need, then empty **Recently Deleted** in Photos.

### Android {.android}

1. Delete photos you don't need, then empty the trash in Google Photos: **Collections → Trash → More → Empty Trash → Delete permanently**. [Google notes](https://support.google.com/photos/answer/6128858?hl=en) that photos on a memory card may stay there.

### All devices

1. Turn on disappearing messages in sensitive chats: see [Turn on disappearing messages](/guides/messaging/#disappearing).
2. Uninstall apps you don't need with you, and use a browser instead for accounts you rarely open.
3. Back up what you keep to a place that doesn't sync with the phone, then remove it from the device. With iCloud Photos or Google Photos backup on, deleting from the phone also deletes the cloud copy.

Deleted files can sometimes be recovered with specialist tools; encryption is what makes that hard. Messages you sent stay on the other person's phone.

## Know what is in the cloud anyway {#cloud-copies .recommended}

Much of what is on your phone is also in the cloud, where it can be reached without the phone. What is protected depends on your settings.

### iPhone {.ios}

1. With [iCloud's standard protection](https://support.apple.com/en-us/102651), Apple holds the keys to your iCloud Backup, Photos, Notes and iCloud Drive. If iCloud Backup is on, the backup also holds the key to Messages in iCloud.
2. **Advanced Data Protection** moves those keys to your devices only: see [Use Apple's strongest account settings](/guides/strong-accounts/#apple-protections). iCloud Mail, Contacts and Calendars stay readable to Apple even then.

### Android {.android}

1. [Google says](https://support.google.com/android/answer/2819582?hl=en) some of your phone backup is end-to-end encrypted with your screen lock, but photos and videos in Google Photos are not.
2. On Samsung, [Samsung Cloud's **Enhanced data protection**](https://www.samsung.com/us/support/answer/ANS10003637/) can encrypt some backups end to end (call logs, messages, settings, apps; message attachments may not be covered): **Settings → Security and privacy → More security settings → Enhanced data protection**. Samsung says it needs One UI 5.1.1 or later and may not be available on some carrier phones or in some regions. If you lose your devices and its recovery code, the data is gone.

Strong cloud encryption also means the company can't help you recover your data if you lose your keys: Apple and Samsung both say so. Back up first.

## Encrypt and shut down your computer {#computer-seizure .recommended}

A computer that is asleep or locked usually keeps its encryption key in memory. A Mac with FileVault that is shut down asks for your password before anything can be read. A Windows PC does so only if it has a start-up PIN; otherwise only the Windows sign-in stands in the way.

### Mac {.desktop}

1. Keep FileVault on, and shut the Mac down when it may be taken, rather than closing the lid. With FileVault, your password is needed when it starts.
2. On a Mac with Apple silicon, there is no firmware password: [Apple says FileVault gives the equivalent protection](https://support.apple.com/en-us/102384).

### Windows

1. Shut down or hibernate before the computer leaves your hands. [Microsoft says](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/countermeasures) that after sleep, no PIN is needed to reach the encrypted data, while hibernation locks the drive. That only helps if you have a start-up PIN (next step).
2. By default, BitLocker unlocks the drive at start-up without asking you anything. Microsoft recommends a start-up PIN against a skilled attacker with time. The PIN is a BitLocker setting, and [Microsoft says BitLocker Drive Encryption is available on Windows Pro, Enterprise or Education, not Home](https://support.microsoft.com/en-us/windows/bitlocker-drive-encryption-76b92ac9-1040-48d6-9f5f-d14b3c5fa178). Keep your recovery key first: if you forget the PIN, you need the key.

Encryption protects the disk, not your accounts: a computer that was signed in may still hold session data for your email and cloud services.

## Plan ahead {#plan-ahead .essential}

Decide before anything happens who you will call and what you want done.

### All devices

1. Write a lawyer's number and an emergency contact on paper and keep it on you.
2. Keep a list of your important accounts somewhere safe, so that you or someone you trust can sign them out quickly from another device.
3. Know where to get expert help: see [Know where to get expert help](/guides/threat-modelling/#get-help).
4. Remote erase through Find My or Find Hub needs the device to be online. On iPhone, [an erase sent while the device is offline runs the next time it connects](https://support.apple.com/guide/icloud/erase-a-device-mmfc0ef36f/icloud), which may be much later. Apple sends a confirmation email when you erase. On Android, [the device then disappears from Find Hub, and a memory card may not be erased](https://support.google.com/android/answer/6160491?hl=en).
5. Erasing a device that the authorities have taken, or cutting their access to your accounts, can in some places be treated as destroying evidence or obstructing an investigation, which can lead to new charges. [EFF warns about this](https://ssd.eff.org/module/attending-protest). Get legal advice before you or anyone else erases a device that has been taken.
6. [iPhone can erase itself after 10 wrong passcodes](https://support.apple.com/guide/iphone/set-a-passcode-iph14a867ae/ios) (**Erase Data** in **Face ID & Passcode**). Turn it on only if you have a recent backup: someone else's guesses can trigger it.

Plans that rely on others need them to be reachable and willing. Agree on it with them in advance.

## If your device is returned {#after-return .recommended}

[CPJ advises](https://cpj.org/2021/02/physical-and-digital-safety-arrest-and-detention/) replacing a device that was taken and returned, because a factory reset may not remove spyware. [Security in a Box says](https://securityinabox.org/en/blog/2025-09-detentions/) it may be impossible to confirm that a device is clean.

### All devices

1. Don't use the returned device for anything sensitive until an expert has checked it.
2. From another trusted device, sign out of all sessions and change your important passwords: see [Sign out every other device](/guides/hacked/#sessions). If the authorities took it, [EFF advises talking to a lawyer first](https://ssd.eff.org/module/attending-protest), because cutting off their access can carry legal risk.
3. If you can, replace the device. If you can't, reset it and set it up again from a backup made before it was taken.

You may never be able to confirm that a returned device is clean. Treat it as untrusted.
