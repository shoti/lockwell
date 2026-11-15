---
title: Protect your phone and others at a protest
description: 'What to do with your phone before, during and after a protest: what to carry, how to lock it, what it reveals, photographing others safely, and if it is taken.'
summary: Your phone can show where you were, who you know and who was beside you. Prepare it before you go, protect the people in your photos, and know what to do if it is taken.
audience: high-risk
group: situations
icon: megaphone
order: 6
time: 45
progress: session
legal: true
reviewed: 2026-11-12
status: published
---

A phone at a protest can show where you were, who you talk to and who stood beside you. This guide covers your phone and the photos you take. It doesn't cover your physical safety or your legal rights: for those, ask a lawyer or a human rights organisation before you go. Do the first three steps of this guide at home, the day before.

## Decide which phone to take, if any {#phone-or-not .essential}

[EFF's protest guide](https://ssd.eff.org/module/attending-protest) says leaving the phone at home, or keeping it switched off, can be the simplest way to protect your data, but then you can't call for help or find your friends. Choose from [your plan](/guides/threat-modelling/).

### All phones

1. **Your usual phone:** easiest, but everything on it goes with you. Prepare it with the next items.
2. **A second phone:** an old or cheap phone with little personal data on it, as long as it still gets security updates. Don't sign in to your personal email or social media on it. Write your friends' numbers down on paper too.
3. **No phone, or a phone that stays off** until you need it: the hardest for others to track, and a phone that is off is harder to break into. It doesn't protect what is already in your accounts or the cloud, and it is the weakest for staying in touch.

A second phone leaves its own trail. EFF notes that most countries require an ID to buy a prepaid SIM card, and mobile masts record where a phone has been. If you carry both phones, their locations can be matched. Switch the second phone off before you go home.

## Prepare the phone before you go {#before-you-go .essential}

What isn't on the phone can't be taken from it.

### All phones

1. Install the latest updates for the system and your apps.
2. Back up the phone and keep the backup somewhere safe: see [Turn on your phone's backup](/guides/backups/#phone-backup).
3. Delete what you don't need to carry. Check the photo and video folders in your messaging apps, and empty the **Recently Deleted** or trash folders: deleted items often wait there.
4. Sign out of apps you won't need, especially ones holding a lot about you or your family. Sign in through a browser if you need something, and sign out after.
5. Hide message previews on the lock screen: see [Hide message previews on the lock screen](/guides/phone/#lock-screen).
6. Write an emergency contact and a lawyer's number on paper, and keep it on you.
7. Check your emergency information on the lock screen. If your iPhone's Medical ID is set to **Show When Locked**, or your Android phone shows emergency contacts when locked, anyone holding the phone can see them. List only a lawyer, or turn this off. On iPhone, the same contacts get a text with your location after an emergency call.
8. Charge the phone, take a power bank, and download an offline map of the area.
9. Consider [Lockdown Mode](/guides/phone-hardening/#lockdown-mode) on iPhone or [Advanced Protection](/guides/phone-hardening/#advanced-protection) on Android.

Deleted content can sometimes be recovered with specialist tools. A memory card in the phone, or a separate camera, is usually not encrypted.

## Switch off face and fingerprint unlock {#biometrics-off .essential}

Someone can hold the phone up to your face or press your finger on it. A passcode has to be typed. On iPhone 12 and later, Face ID can also work while you wear a mask if **Face ID with a Mask** is turned on: see [Apple's Face ID guide](https://support.apple.com/guide/iphone/set-up-face-id-iph6d162927a/ios). The trade-off: cameras around you may film you typing the passcode.

### iPhone {.ios}

1. Before you go, turn off **iPhone Unlock** in **Settings → Face ID & Passcode** (or **Touch ID & Passcode**). Use a long passcode: see [Use a long passcode](/guides/phone-hardening/#strong-passcode).
2. If you keep Face ID, know the quick way to switch it off: press and hold the side button and either volume button for about 2 seconds, then let go and press the side button to lock.
3. If you have an Apple Watch, turn off your watch under **Unlock with Nearby Devices** in the same settings (on iOS 26 and earlier: **Unlock with Apple Watch**).

### Android {.android}

1. Before you go, turn off fingerprint and face unlock. On a Pixel: **Settings → Security & privacy → Device unlock**, then **Face** and **Fingerprint** (on some versions **Face & Fingerprint Unlock**), and turn off unlocking the phone. On Samsung: **Settings → Security and privacy → Screen lock and biometrics**, then turn off **Fingerprint unlock** and **Face unlock**.
2. On a Pixel, turn off Extend Unlock: **Settings → Security & privacy → More security & privacy → Extend Unlock**, then turn off **On-body detection**, remove **Trusted places** and remove all trusted devices. On Samsung, turn off everything in **Settings → Lock screen and AOD → Extend Unlock**. [Google warns](https://support.google.com/pixelphone/answer/6093922?hl=en) that location signals can be faked to unlock the phone.
3. If you keep biometrics, use Lockdown: on a Pixel, press power and volume up and tap **Lockdown**. On Samsung, press and hold volume down and the side button: on One UI 9.0 and later, Lockdown mode turns on by itself; on One UI 8.5, tap **Lockdown mode**; on One UI 8.0 or earlier, first turn on **Show Lockdown mode** in **Settings → Lock screen and AOD → Secure lock settings**, then tap **Lockdown mode**. See [Samsung's Lockdown mode page](https://www.samsung.com/us/support/answer/ANS10013057/) (Samsung US, as of November 2026). Lockdown lasts until the next unlock.

> [!warning]
> On iPhone, don't keep holding the side and volume buttons. If you hold them until the Emergency SOS countdown ends, the phone calls emergency services and then texts your emergency contacts your location. The countdown also plays a loud alarm. If it calls by mistake, don't hang up: tell the operator you don't need help.

None of this helps if the phone is taken from your hand while unlocked, for example while you are filming.

## Know what your phone reveals by being there {#location-and-network .recommended}

A phone that is on connects to nearby mobile masts and Wi-Fi networks, and the records can show it was there. [EFF warns](https://ssd.eff.org/module/problem-mobile-phones) that ordinary calls and SMS can be intercepted, for example by someone nearby with a fake mobile mast (an IMSI catcher).

### iPhone {.ios}

1. To turn Wi-Fi and Bluetooth fully off, use **Settings → Wi-Fi** and **Settings → Bluetooth**. [Apple says](https://support.apple.com/en-us/102412) the buttons in Control Center only disconnect, and that [airplane mode may leave Bluetooth on](https://support.apple.com/en-us/HT204234): it remembers what you turned on or off in airplane mode last time.
2. Turn off **Settings → Privacy & Security → Location Services**. For your location history, see [Clear your location history](/guides/location-photos/#location-history).

### Android {.android}

1. Turn on airplane mode, and check that Wi-Fi and Bluetooth went off too: Android remembers what you did last time.
2. Turn off **Settings → Location → Use location**. For your location history, see [Clear your location history](/guides/location-photos/#location-history).

### All phones

1. Use Signal rather than SMS or ordinary calls.
2. A live stream shows where you are, and the faces of the people around you.
3. Cards and travel passes linked to you can also show where you were; cash leaves less trace.

EFF warns that even with airplane mode on and Location Services, Wi-Fi and Bluetooth turned off, apps may store your location and send it later. EFF says only switching the phone off makes sure that doesn't happen. With the connections off, you also can't call for help, so agree on a meeting point with your friends.

## Protect the people in your photos {#photos-and-faces .essential}

A photo you post can be used to find and harass people who were at the protest. Ask before you photograph someone. If you can't, hide their face before you post.

### All phones

1. Open the camera from the lock screen, so that the phone stays locked if it is snatched. On iPhone, swipe left on the lock screen. On a Pixel, double-press the power button (**Settings → System → Gestures → Double press power button**). On Samsung, double-press the side button (**Settings → Advanced features → Side button**).
2. Before posting, cover faces, tattoos and distinctive clothing with solid blocks: use the [image redaction tool](/tools/image-redaction/). EFF says blurring can sometimes be reversed. For videos, cut or cover faces in a video editor, or don't post the clip.
3. Remove the location and other hidden details from the file: use the [photo metadata tool](/tools/photo-metadata/) for photos and the [video metadata tool](/tools/video-metadata/) for videos, or see [Remove location from your photos](/guides/location-photos/#photo-metadata).
4. Check the background too: reflections, street signs and other people.

If you are documenting events, the hidden details can help prove when and where a photo was taken: keep the original safe and post a cleaned copy. Face detection in apps can miss faces ([Signal says its blur tool doesn't find every face](https://signal.org/blog/blur-tools/)), so check every photo yourself.

## Agree how your group will communicate {#group-comms .recommended}

Agree on the plan before you go, while you can still talk.

### Signal

1. Use Signal for the group, not SMS. Pick your profile name before you join: everyone in the group sees it, and they are told if you change it.
2. Turn on disappearing messages for the group: **chat settings → Disappearing messages**. See [Turn on disappearing messages](/guides/messaging/#disappearing).
3. If the group has a link, turn on **Approve New Members**, and reset the link if it spreads: **group chat settings → Group Link → Reset Link**.
4. Keep sensitive groups small: the bigger the group, the more likely it includes someone you can't trust.

### All phones

1. Go with someone, agree on a meeting point if you get separated, and tell someone you trust where you will be.

Signal protects messages on the way, not on the phones at each end. If any member's phone is taken while unlocked, the group's messages on it can be read. Disappearing messages don't stop someone photographing the screen.

## If you are detained or your phone is taken {#if-detained .essential}

This item covers only your phone. For your rights, talk to a lawyer.

### All phones

1. Switch the phone off completely, not just to sleep. [Freedom of the Press Foundation explains](https://freedom.press/digisec/blog/police-forensic-tools-may-bypass-key-phone-security-feature/) that a phone that hasn't been unlocked since it was switched on is harder for forensic tools to break into.
2. On iPhone: press and hold the side button and either volume button until the sliders appear, then drag the power-off slider. Don't keep holding past the sliders.
3. If you must make a call, switch the phone on, call, then switch it off again without unlocking more than you need.
4. Don't wipe the phone remotely or use a wipe code without talking to a lawyer first. [CPJ notes](https://cpj.org/2021/02/physical-and-digital-safety-arrest-and-detention/) that wiping can make you look more suspicious and works only if the phone is online, and [CPJ's safety kit](https://cpj.org/2019/07/digital-safety-kit-journalists/) warns that a remote wipe can have legal consequences.

> [!note]
> If you or your group expect to be targeted, contact a helpline before the protest: see [Know where to get expert help](/guides/threat-modelling/#get-help).

Switching off doesn't help if the phone was taken while unlocked. Freedom of the Press Foundation reports that since iOS 18.1 an iPhone restarts itself after 72 hours locked, and that in a leaked training video a forensic vendor, Magnet Forensics (maker of Graykey), claims its tools can get past this. Don't rely on it: switch the phone off yourself.

## Afterwards {#afterwards .recommended}

### All phones

1. If your phone was out of your hands, even for a short time, use another device to sign it out of your accounts and change your important passwords: see [Sign out every other device](/guides/hacked/#sessions). If the authorities took it, talk to a lawyer first: EFF warns that cutting off access can carry legal risk.
2. Don't use a returned phone until an expert has checked it. If you can, replace it: a factory reset may not remove spyware.
3. Review what you posted: remove photos that show faces or places you didn't mean to share.
4. Review your friends and followers, and remove anyone who could put you or others at risk.

Nobody can confirm for certain that a returned phone is clean. If you can't replace it, keep sensitive work off it.
