---
title: Harden your phone against targeted attacks
description: Lockdown Mode, Android Advanced Protection, quick biometric lock, restarts, USB and 2G settings: what each one blocks, what it breaks and what it can't stop.
summary: Settings that make a phone harder to break into for someone who targets you personally, with what each one costs and what it doesn't stop.
audience: high-risk
group: basics
icon: phoneShield
order: 2
time: 40
progress: session
reviewed: 2026-11-12
status: published
---

This guide goes further than [Lock down your phone](/guides/phone/): do that guide first. The steps here are against attackers who go after you personally: spyware that needs no tap, someone forcing you to unlock the phone, tools that copy data through the cable. Each step makes an attack harder; none makes it impossible. If you think your phone is already infected, don't start changing settings: contact a helpline first, as described in [Know where to get expert help](/guides/threat-modelling/#get-help).

## Install security updates as soon as they arrive {#updates-first .essential}

Most attacks use flaws that updates fix. NCSC calls installing them promptly one of the most important things you can do.

### iPhone {.ios}

1. Check that automatic updates are on: see [Install updates automatically](/guides/phone/#updates). Also check by hand once a week in **Settings → General → Software Update**.
2. Open **Settings → Privacy & Security → Background Security Improvements** and make sure **Automatically Install** is on. These small fixes arrive between updates (iOS 26.1 or later).
3. Apple's [security releases page](https://support.apple.com/en-us/100100) lists which models still get updates. If yours no longer does, replace it.

### Android {.android}

1. Check that automatic updates are on: see [Install updates automatically](/guides/phone/#updates). Also check by hand once a week; on a Pixel, in **Settings → System → Software updates**. Updates can take a few weeks to reach every phone.
2. Google gives Pixel 8 and later 7 years of updates from the date they first went on sale in its US store, and Pixel 6 and 7 models 5 years. Pixel 6 and 6 Pro stopped getting updates in October 2026. Samsung promises up to 7 years for some models.
3. When you buy a phone, CISA advises one that gets security updates at least monthly and is promised them for at least five more years.
4. If your phone no longer gets updates, replace it.

Updates fix only flaws that are already known. An attack that uses an unknown flaw works until the fix arrives: the next items are for that.

## Use a long passcode and know how to switch off face and fingerprint unlock {#strong-passcode .essential}

Someone can hold your phone up to your face or press your finger on it. A passcode has to be typed, and the phone always asks for it after a restart. NCSC says face or fingerprint unlock is fine for everyday use; EFF advises turning it off where you might be forced to unlock, for example at a protest. Decide from [your plan](/guides/threat-modelling/).

### iPhone {.ios}

1. Open **Settings → Face ID & Passcode** (or **Touch ID & Passcode**). When you set a new passcode, tap **Passcode Options** and choose **Custom Alphanumeric Code**.
2. To switch Face ID off at once, press and hold the side button and either volume button for 2 seconds, then let go as soon as the sliders appear. The phone now needs your passcode.
3. To stop face or fingerprint unlock altogether, turn off **iPhone Unlock** in the same settings.
4. Apple describes no button shortcut for Touch ID. Restart the phone instead: after a restart it always asks for the passcode.
5. If you have an Apple Watch, turn off your watch under **Unlock with Nearby Devices** in the same settings (on iOS 26 and earlier: **Unlock with Apple Watch**), so the watch can't unlock the phone for someone else.

### Android {.android}

1. Use a PIN longer than 6 digits, or a password. Google says a strong password is the most secure option. The steps are in [Set a strong screen lock](/guides/phone/#screen-lock).
2. On a Pixel, press the power and volume up buttons together and tap **Lockdown**. It turns off fingerprint and face unlock and lock-screen notifications.
3. On a Samsung phone with One UI 8.5 or later, press and hold volume down and power, then tap **Lockdown mode** (on One UI 9.0 it turns on by itself when the menu opens). On One UI 8.0 or earlier, first turn on **Settings → Lock screen and AOD → Secure lock settings → Show Lockdown mode option**.
4. On other phones, the option may need turning on first: Google gives **Display → Advanced → Lock screen display → Show lockdown option**.
5. Lockdown lasts only until you next unlock the phone. Turn it on again each time.
6. On a Pixel, turn off Extend Unlock: **Settings → Security & privacy → More security & privacy → Extend Unlock**, then turn off **On-body detection** and remove **Trusted places**. Google warns that location signals can be faked to unlock the phone.

> [!warning]
> On iPhone, don't keep holding the side and volume buttons. If you hold them until the Emergency SOS countdown ends, the phone calls emergency services and then texts your emergency contacts your location.

A passcode doesn't help if someone sees you type it or makes you tell it. The shortcuts protect the phone only until it is unlocked again.

## Turn on Lockdown Mode on iPhone, iPad and Mac {#lockdown-mode .essential}

Apple calls Lockdown Mode "an optional, extreme protection" for the very few people who may be targeted by the most sophisticated digital attacks. Amnesty, Access Now, CISA and NCSC recommend it to people at risk. In 2023 Apple confirmed to Citizen Lab that it blocked a known Pegasus spyware attack that needed no tap. In November 2026 security researchers reported an attack that got past Lockdown Mode, so it lowers the risk but doesn't remove it.

### iPhone {.ios}

1. Update first: Apple says the latest software gives the full set of protections.
2. Open **Settings → Privacy & Security**, scroll down and tap **Lockdown Mode**, then **Turn On Lockdown Mode** twice, then **Turn On & Restart**, and enter your passcode.
3. What changes: most message attachments, links and link previews are blocked. Some websites look broken. FaceTime calls are blocked from people you haven't called in the last 30 days. Shared albums disappear and location is left out of photos you share. The phone doesn't join open Wi-Fi by itself, 2G and 3G are off, accessories need the phone unlocked, and configuration profiles can't be installed. EFF notes that SMS codes are no longer filled in for you.
4. Phone calls, plain text messages and emergency calls keep working.
5. If a website, app or contact you trust doesn't work, you can exclude it under **Settings → Privacy & Security → Lockdown Mode**, in **Customize Web Sites** or, from iOS 27, **Customize Contacts**. Apple warns that every exclusion weakens the protection.
6. Turn it on separately on your iPad. A paired Apple Watch follows the iPhone.

### Mac {.desktop}

1. Choose **Apple menu → System Settings → Privacy & Security**, scroll down, click **Lockdown Mode**, then **Turn On**, then **Turn on Lockdown Mode**. Enter your password if asked, then click **Turn On & Restart**.

> [!note]
> Apple sends threat notifications to people it believes were targeted by spyware, and recommends Lockdown Mode in them. A real notification never asks you to click a link, open a file, install anything, or give your Apple Account password or a verification code. Check for it by signing in at [account.apple.com](https://account.apple.com/).

Lockdown Mode reduces the ways in. It doesn't remove spyware that is already there, doesn't protect your accounts on other devices, and doesn't help if someone unlocks the phone. Safari shows a banner that says it is on, so anyone using the phone can see it.

## Turn on Advanced Protection on Android {#advanced-protection .essential}

Android's Advanced Protection (Android 16 or later) turns on a set of protections at once, for people such as journalists and activists. Amnesty and Access Now describe it as available on Pixel phones; Google says "supported devices".

### Pixel {.android}

1. You need a screen lock first.
2. Open **Settings → Security & Privacy** and, under **Other settings**, tap **Advanced Protection** (on some phones: **Settings → Google → All services → Advanced Protection**). Turn on **Device protection**, then tap **Turn on**. Restart if asked.
3. What changes: apps can't be installed from outside the Play Store, and apps installed that way get no updates. Play Protect stays on. Only verified accessibility tools work. The phone restarts after 72 hours locked, and blocks USB data while locked (Pixel 6 and later). 2G is blocked and Chrome turns off some web features.
4. You can't switch single protections off. To install something once, choose **Pause temporarily**: protection comes back after 3 hours.
5. Optional: tap **Expert features** and turn on **Use expert features**. The phone then stops joining open Wi-Fi by itself, and you can turn on **Intrusion Logging** when asked. It keeps encrypted logs that experts can later use to look for an attack; Amnesty says it has to be on before the attack.
6. Weigh Intrusion Logging first. Google says the logs stay in your Google Account for 12 months and can't be deleted, even if you turn the feature off. They show which websites you visited, Incognito included, and Google warns you may be required to give access to them.

### Samsung

1. Open **Settings → Security and privacy → Auto Blocker** and turn it on. It blocks apps from unauthorised sources and commands sent through the USB cable. Phones released with One UI 6.1.1 have it on already.
2. For more, tap **Maximum restrictions** at the bottom and turn it on. It blocks 2G, links and previews in text messages, shared albums, device admin apps and work profiles, and reconnecting to unsafe Wi-Fi. It removes location from pictures you share.
3. Samsung warns that some accessories and work apps may stop working, and that you can't open files and links in text messages.

These modes close common ways in, not all of them, and don't remove spyware that is already installed. Apps can check whether Advanced Protection is on.

## Restart your phone regularly {#restart .recommended}

Many attacks on phones, especially the ones that need no tap, don't survive a restart. A restart also locks your data until the passcode is typed again.

### All phones

1. Restart your phone at least once a week. Privacy Guides suggests every day if you are worried about this kind of attack.
2. On Samsung with One UI 8.0 or later, check that **Settings → Security and privacy → More security settings → Inactivity restart** is on. It restarts a phone that has been locked and unused for 72 hours. You can also schedule restarts in **Settings → Device care → Auto optimization → Auto restart → Restart on schedule**.
3. Android Advanced Protection restarts a phone that stays locked for 72 hours.

> [!warning]
> If you think you are being attacked right now, contact a helpline before you restart or reset the phone: see [Know where to get expert help](/guides/threat-modelling/#get-help). Access Now says evidence is overwritten every minute the device is on, and suggests a backup of the device to keep it.

A restart doesn't remove spyware built to survive restarts, and an attacker can infect the phone again.

## Keep fewer apps and connections {#fewer-apps .recommended}

Every app and every connection is a possible way in. Access Now advises keeping fewer apps and accounts on the phone, and separate devices for work and personal life.

### All phones

1. Delete apps you don't use, and check again every few months.
2. Keep fewer accounts signed in on the phone, and put as little personal information into apps as you can.
3. Turn off Bluetooth, NFC, Wi-Fi and location when you don't need them.
4. Check what the remaining apps can access: see [Check what your apps can access](/guides/phone/#app-permissions).

EFF warns that even in airplane mode with location, Wi-Fi and Bluetooth off, apps can store your location and send it when you reconnect; only switching the phone off stops that. With the connections off, you also can't call for help.

## Block data through the cable while the phone is locked {#usb-accessories .recommended}

A cable can be used to copy data from a phone or to put something on it. Both iPhone and Android can block data through the cable while the phone is locked.

### iPhone {.ios}

1. Open **Settings → Privacy & Security → Wired Accessories**.
2. On an iPhone with USB-C, choose **Always Ask** or **Ask for New Accessories**. On an iPhone with Lightning, keep **Automatically Allow When Unlocked**. Don't choose **Always Allow**.
3. Charging from a power adapter works without unlocking.

### Android {.android}

1. On a Pixel 6 or later, USB Protection turns on with Advanced Protection and blocks USB data while the screen is locked. It has no separate switch.
2. On Samsung, Auto Blocker blocks commands sent through the cable, and Lockdown mode blocks USB connections.

### All phones

1. Charge from a wall socket with your own charger and cable, not from public USB points.

A connection you allowed while the phone was unlocked stays open after you lock it. None of this helps once the phone is unlocked.

## Turn off 2G {#block-2g .advanced}

2G networks don't check that a mobile mast is real. Google says a fake mast can push a phone down to 2G and then read calls and SMS, including login codes. EFF adds that fake masts can track phones. Turning 2G off protects against some of them.

### Android {.android}

1. On a Pixel, EFF gives **Settings → Network & Internet → SIMs**, then your operator, then turn off **Allow 2G**. If you see **Require Encryption**, turn it on.
2. On Samsung, open **Settings → Connections → Mobile networks** and turn off **Allow 2G service**. Maximum restrictions does the same.
3. Advanced Protection blocks 2G on supported phones.

### iPhone {.ios}

1. iPhone has no separate switch. Lockdown Mode turns off 2G and 3G.

Emergency calls can still use 2G. Turning 2G off protects against some fake masts, not all. Where only 2G works, you lose calls, texts and mobile data. With Lockdown Mode on iPhone, the same may happen where only 2G or 3G works.

## Know when GrapheneOS is worth it {#grapheneos .advanced}

GrapheneOS is a free version of Android that you install in place of the phone's own system. Privacy Guides calls it the best choice for privacy and security on Android. It runs only on Google Pixel phones.

### Android {.android}

1. It makes attacks harder, GrapheneOS says: it adds defences against memory bugs, the most common kind of security flaw, including its own hardened memory allocator, and it fixes flaws not yet fixed in Android. On Pixel 8 and later it uses the hardware's memory tagging by default for the system and for installed apps known to work with it, GrapheneOS says.
2. It gives you more control: a **Network** permission keeps an app off the internet, and a **Sensors** permission blocks sensors not covered by other permissions. Google Play can be installed as an ordinary app with no special access, so most apps still work.
3. It helps if the phone is taken: by default the phone restarts if it stays locked for 18 hours, which locks your data again. See [Know why switching off matters](/guides/device-seizure/#before-first-unlock).
4. Before you switch: GrapheneOS strongly recommends a Pixel 8 or later, and one that isn't locked to a mobile operator. Install it only with one of the official methods at grapheneos.org/install; the web installer is the one for most people. Installing erases everything on the phone, so back it up first.
5. Some banking apps check whether Google has certified the system and refuse to run. GrapheneOS isn't certified, so check your bank's app before you rely on it.

GrapheneOS makes attacks harder; it doesn't stop phishing, an app you give permissions to, or someone who knows your PIN. If you can't switch, [Advanced Protection](/guides/phone-hardening/#advanced-protection) is the built-in option on Android.
