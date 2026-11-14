---
title: Secure your computer
description: A checklist for Windows and Mac: automatic updates, a screen lock, disk encryption and its recovery key, built-in protection, safe software and the firewall.
summary: Keep your Windows PC or Mac updated, locked and encrypted, without risking a lock-out.
audience: everyone
group: devices
icon: laptop
order: 9
time: 45
reviewed: 2026-11-14
status: published
---

A computer holds your documents, photos and the browser you sign in with. This guide covers Windows 11 and current macOS. The two **Essential** items take about ten minutes. Encryption, the third item, protects your files if the computer is stolen, but read it carefully: losing the recovery key can mean losing your files.

## Install updates automatically {#updates .essential}

Updates fix security holes that attackers already know about. Windows and macOS can install them for you; check that they do, and restart when asked. A system that no longer gets security updates stays open to attacks that anyone can use.

### Windows

1. Select **Start → Settings → Windows Update**. If updates are waiting, select **Download & install**, then restart when asked.
2. Windows installs updates automatically. You can pause them for up to 35 days at a time, and extend the pause. Don't pause security updates without a reason, and resume them as soon as you can.
3. **Windows 10** stopped getting security updates on 14 October 2025. If your PC can run Windows 11, upgrade. If it can't, enrol in Extended Security Updates in **Settings → Update & Security → Windows Update → Enroll now**: it keeps security updates coming until 12 October 2027. You need Windows 10 version 22H2 and a Microsoft account to enrol.
4. Another option for a PC that can't run Windows 11 is Linux, a free operating system. Privacy Guides recommends Fedora for people new to Linux. Each Fedora version gets updates for about a year, so upgrade when a new one is offered. It says Linux avoids the data collection that often comes with Windows and macOS, but lacks some of their security features, such as strong app sandboxing. Back up your files before you install it: see [Back up your computer](/guides/backups/#computer-backup).

### Mac

1. Choose **Apple menu → System Settings → General → Software Update**.
2. Click the info button next to **Automatic Updates** and turn on **Download new updates when available**, **Install macOS updates** and **Install Security Responses and system files**.
3. Apple recommends the latest macOS your Mac can run. If **Software Update** offers no newer version, your Mac may not support it.

> [!warning]
> If your computer no longer gets security updates, avoid using it for email, online banking and other important accounts. Plan to replace it.

## Lock the screen when you step away {#screen-lock .essential}

An unlocked computer gives anyone who sits down at it your email, files and saved passwords. Set it to lock itself soon after you stop using it, and lock it yourself when you leave it.

### Windows

1. Select **Start → Settings → Accounts → Sign-in options** and set up **Windows Hello**: a PIN, fingerprint or face sign-in.
2. Select **Settings → System → Power & battery → Screen, sleep & hibernate timeouts** and set **Turn my screen off after** and **Make my device sleep after** to a few minutes.
3. In **Sign-in options**, make sure Windows asks you to sign in again when the PC wakes up.
4. To lock the screen yourself, press the Windows key and **L** together.

### Mac

1. Choose **Apple menu → System Settings → Lock Screen**.
2. Set **Require password after screen saver begins or display is turned off** to a short time.
3. Set the display to turn off after a few minutes of inactivity, on battery and on power.
4. In **Users & Groups**, don't use automatic login: anyone could restart your Mac and get in.

## Encrypt the disk and keep the recovery key {#disk-encryption .recommended}

Encryption keeps your files unreadable to someone who steals the computer or takes out its drive. You need a recovery key to get back in if Windows or macOS asks for it, for example after a hardware change, or if you forget your password. Microsoft and Apple can't recover a lost key for you. Before you turn encryption on, decide where the key will live; keep a copy away from the computer itself.

### Windows

1. Sign in with an administrator account and open **Settings → Privacy & security → Device encryption**. If it is there, turn it **On**. If it isn't there and you have Windows Pro, use **BitLocker**: type BitLocker in Start and select **Manage BitLocker → Turn on BitLocker**.
2. If you sign in with a Microsoft account, Windows may have turned encryption on already and saved the key to that account. Check at [aka.ms/myrecoverykey](https://aka.ms/myrecoverykey).
3. To keep another copy, type BitLocker in Start, select **Manage BitLocker → Back up your recovery key**, and print it or save it to a USB stick. Keep it apart from the computer.

### Mac

1. Choose **Apple menu → System Settings → Privacy & Security → FileVault** and turn on FileVault.
2. Choose how to unlock if you forget your password: with your iCloud account, or with a recovery key you keep yourself.
3. If you choose the recovery key, write it down and keep it somewhere safe, not with the Mac. If you lose both your password and the key, your files are lost for good.

> [!warning]
> If someone else set up your PC, the BitLocker key may be in their Microsoft account. Find it before you need it.

## Check that built-in protection is on {#built-in-protection .recommended}

Windows and macOS include protection against known harmful software. For most people it is enough; you don't need to buy an antivirus. If you install another antivirus on Windows, Microsoft Defender switches itself off and the other product takes over.

### Windows

1. Search for **Windows Security** in the Start menu and open it.
2. Check that **Virus & threat protection**, **Firewall & network protection** and **App & browser control** show no warnings.
3. If **Smart App Control** under **App & browser control** is on, leave it on. It blocks apps it can't vouch for. If you can't turn it on, that's fine.

### Mac

1. macOS has built-in malware protection called XProtect. It updates itself and needs no setup.
2. Keep **Install Security Responses and system files** on (see the first item) so protection stays current.

## Install software only from trusted places {#software-sources .recommended}

A program from an unknown website or a link in a message can carry harmful software, and you can't check who made it. Get software from the app store or from the maker's own website. Free copies of paid programs come from exactly such unknown sources.

### Windows

1. Install apps from the **Microsoft Store** or the developer's own website.
2. Keep **Reputation-based protection** on in **Windows Security → App & browser control**. It warns you about unknown downloads.

### Mac

1. Choose **Apple menu → System Settings → Privacy & Security** and scroll to **Security**.
2. Under **Allow applications from**, choose **App Store** or **App Store & Known Developers**.
3. If macOS blocks an app, don't override it with **Open Anyway** unless you are sure where the app came from.

## Use a standard account for everyday work {#standard-account .advanced}

An administrator account can change the whole system, and so can any harmful program you open while using it. Microsoft advises using standard accounts for day-to-day use. The trade-off: installing updates, turning on encryption and some settings will ask for the administrator password.

### Windows

1. Create a second account for everyday use in **Settings → Accounts → Other users**.
2. Keep one administrator account, and use **Change account type** to make the others standard accounts.

### Mac

1. The first account on a Mac is an administrator. Choose **Apple menu → System Settings → Users & Groups** to add a standard account for everyday use.
2. Don't share the administrator name and password.

## Keep the firewall on {#firewall .advanced}

A firewall blocks unwanted connections to your computer from the network, which matters most on public Wi-Fi. If an app you need is blocked, allow that app instead of turning the firewall off.

### Windows

1. In **Windows Security**, select **Firewall & network protection**.
2. Check that **Microsoft Defender Firewall** is **On** for the **Private network** and the **Public network**.
3. When you join a café or hotel Wi-Fi, choose **Public network**: it is the stricter setting.

### Mac

1. Choose **Apple menu → System Settings → Network → Firewall**.
2. Turn on **Firewall**. Sharing features you turn on may still open connections through it.

## Erase the computer before you sell or give it away {#before-selling .advanced}

A computer you pass on still holds your files and signed-in accounts until you erase it. Back up first. On Windows, have your BitLocker recovery key ready.

### Windows

1. Back up your files.
2. Select **Start → Settings → System → Recovery → Reset PC**, choose **Remove everything**, and turn on **Clean data**.
3. The screen may stay black for a while; don't restart the PC during the reset. Microsoft notes this erasure doesn't meet government data-erasure standards.

### Mac

1. Back up with Time Machine or copy your files.
2. On a Mac with Apple silicon or a T2 chip, choose **Apple menu → System Settings → General → Transfer or Reset → Erase All Content and Settings**. It signs you out of Apple services and erases everything.
3. If your Mac has Apple silicon and macOS 26 or later and was ever repaired, or you're not sure, run **Repair Assistant** first. On older Macs, follow Apple's steps to sign out of iCloud and reinstall macOS.
