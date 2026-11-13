---
title: Travel and cross borders with your devices
description: Prepare your phone and laptop before a trip, cross a border with less exposed, stay reachable without getting locked out, and what to do if a device is taken.
summary: At a border your devices can be searched or taken out of your sight. Carry less, prepare at home, switch off before the crossing and know what to do afterwards.
audience: high-risk
group: situations
icon: suitcase
order: 7
time: 45
progress: session
reviewed: 2026-11-12
status: published
---

At a border or checkpoint, your phone and laptop can be searched, copied or taken out of your sight. This guide covers your devices only. It says nothing about your rights or what officials may do, which depend on the country: ask a lawyer or the organisation you work with before you go, including whether encryption or VPNs are restricted where you are going. Start the first three items at home, several days before you leave: some settings only change after a delay.

## Decide what to take, and carry less {#before-travel .essential}

What isn't on the device can't be found on it. CPJ advises assuming your devices may be searched as closely as the notebooks in your luggage.

### All devices

1. Back up your phone and laptop: see [Turn on your phone's backup](/guides/backups/#phone-backup). Also make a copy on a computer or encrypted drive that stays at home, not in the same bag: a cloud backup keeps running during the trip.
2. Remove what you don't need on the trip: files, photos, chats, browsing history. Then empty the **Recently Deleted** or trash folders too, in your photo, file and messaging apps. If your photos sync to iCloud Photos or Google Photos, deleting them on the phone deletes them from the cloud too: copy them to the copy at home first.
3. If you can, travel with a separate phone or laptop that holds only what you need. Tell the people who need to reach you how to contact you on it.
4. Encrypt your laptop's disk, and use long passcodes that you know by heart: see [Encrypt the disk and keep the recovery key](/guides/computer/#disk-encryption).
5. Update every device and app before you go.
6. Print your tickets and bookings, so you don't have to unlock your phone along the way.
7. Tell someone you trust when you will cross and when you'll be in touch afterwards.

Prefer removing to hiding. Hiding keeps things out of casual view; nothing we found says it stops a forensic search. A nearly empty phone or a missing messaging app may itself draw questions; no source says how often. Decide from [your plan](/guides/threat-modelling/).

## Make sure you can still sign in abroad {#cloud-and-accounts .essential}

Many sources advise signing out of accounts before a crossing. Prepare so that you can get back in afterwards, far from home.

### All devices

1. Before you leave, add a security key or passkey and print backup codes. Keep the codes away from your devices and bags, and get new ones if they may have been seen: see [Plan how you will get back in](/guides/strong-accounts/#recovery-plan). Google says it may not send SMS codes when you sign in from a new place.
2. If you use security keys, take one with you and leave the spare at home.
3. Know which device will get your codes on the trip. If you leave your usual phone at home, Apple says that without a trusted device or number, the fastest way back in may be to wait a few days.
4. Before the crossing, sign out of accounts you don't need on the trip and remove apps that hold sensitive information. Back up chats first: CPJ warns that uninstalling a messaging app deletes its messages.
5. If you use 1Password, its **Travel Mode** removes all vaults from your devices except those marked **Safe for Travel**. Turn it on before you leave on 1Password.com: your name, then **Manage Account**, then **Travel Mode**, and open 1Password on each device while online. Remove the browser extension for the trip: 1Password says it can still be used to sign in and turn Travel Mode off.

### iPhone {.ios}

1. If **Stolen Device Protection** is on, your iPhone will usually be "away from familiar locations" abroad: Apple counts only places such as home and work. There, signing out of your Apple Account, changing your passcode, removing Face ID or Touch ID, or turning protection off needs Face ID or Touch ID, a one-hour wait, then Face ID or Touch ID again.
2. Setting up a travel eSIM there also needs Face ID or Touch ID. Make these changes at home, before you leave.

Signing out doesn't delete what is in the cloud, and the phone may still hold files and cached pages from your apps.

## Clean up what your phone reveals about others {#contacts-and-sources .essential}

Your phone holds other people: contacts, chats, group names, photos of faces. A search of your phone is a search of theirs too.

### All devices

1. Remove contacts who could be put at risk. Contacts also sync to messaging apps, cloud accounts and the SIM card, so check those as well.
2. Delete sensitive chats, and leave Signal groups you don't need on the trip; you can be added back later.
3. If you are a group admin, rename groups so that the name gives nothing away.
4. Turn on disappearing messages in chats you keep: see [Turn on disappearing messages](/guides/messaging/#disappearing).
5. Check the photos and downloads on the device: what you downloaded is saved on it and may be in its backups.

What you delete stays with the other person and in any backups. Messages you sent stay in their chat.

## Switch off before the crossing {#power-off-crossing .essential}

CPJ, EFF and Freedom of the Press Foundation all advise switching phones and laptops fully off before you reach a border. Apple's and Android's own documents explain why: most data stays locked until you enter your passcode for the first time after switching on.

### All devices

1. Before the checkpoint, turn the phone and laptop fully off, not just to sleep.
2. Don't rely on the phone restarting itself after some time: Freedom of the Press Foundation reports that a forensic vendor claims to get past the iPhone's automatic restart.
3. Switch off face and fingerprint unlock for the crossing: see [Switch off face and fingerprint unlock](/guides/protest/#biometrics-off).
4. Consider [Lockdown Mode](/guides/phone-hardening/#lockdown-mode) on iPhone or [Advanced Protection](/guides/phone-hardening/#advanced-protection) on Android: forensic tools usually connect through the charging port.
5. Keep an eye on your devices as they go through security.

Switching off helps only while the device stays off. If you unlock it for someone, or it is taken while unlocked, everything on it can be read.

## Stay connected without exposing more {#connectivity-abroad .recommended}

Calls and SMS travel through the local operator, who can see them. Use end-to-end encrypted apps such as Signal instead.

### All devices

1. Before you go, ask your operator about roaming, and set a PIN on your mobile account if they offer one.
2. A local SIM or eSIM may need your passport to buy. Swapping SIM cards doesn't make you anonymous: the network sees the phone too.
3. Treat hotel, airport and café networks as untrusted. Many organisations advise a trusted VPN there; others warn that a VPN only moves your trust to the VPN company. See [Know what a VPN does and doesn't do](/guides/wifi/#vpn-what-it-does).
4. Don't sign in to your accounts on shared or public computers.

### iPhone {.ios}

1. Keep your home line on if you need it for codes. Choose which line uses data in **Settings → Cellular → Cellular Data**.

### Android {.android}

1. On a Pixel, add a travel eSIM in **Settings → Network & internet → SIMs → Add SIM → Set up an eSIM**.

A VPN doesn't hide you from the apps and accounts you sign in to, and a VPN or circumvention app found on your phone can itself draw attention.

## Keep devices in sight {#devices-out-of-sight .recommended}

A device left alone can be searched, copied or have something installed on it.

### All devices

1. Keep your devices with you, including while they charge. Thieves often use meals and bathroom breaks.
2. Hotel staff can open a hotel safe with the master key.
3. Set your devices to lock quickly when you step away, and watch who can see your screen.
4. Charge from a wall socket with your own cable, not from public USB points: see [Block data through the cable while the phone is locked](/guides/phone-hardening/#usb-accessories).

Security in a Box suggests simple ways to notice tampering, such as a photo of how you left things, but none of them prove that nothing was done.

## If a device was taken out of your sight {#if-device-taken .essential}

If a device was taken away, or something was plugged into it, CPJ advises assuming its contents were copied and that something may have been installed.

### All devices

1. Straight after, write down what happened: when, for how long, what was done to the device, and anything plugged into it.
2. Don't use the device for anything sensitive. From another trusted device, check your accounts' sign-in activity and take screenshots of anything unfamiliar.
3. Sign out of all sessions and change important passwords from that trusted device: see [Sign out every other device](/guides/hacked/#sessions). If the authorities took it, EFF advises talking to a lawyer first.
4. Get expert help before you reset or replace the device: see [Know where to get expert help](/guides/threat-modelling/#get-help).
5. Watch for fake profiles of you contacting your friends.

CPJ advises replacing a device that was taken, if you can, because a factory reset may not remove spyware. Even a new phone can be recognised by its SIM and number.

## When you are back {#after-return .recommended}

### All devices

1. Turn off travel settings: 1Password's **Travel Mode** on 1Password.com under **Manage Account**, and the travel eSIM if your phone didn't switch back by itself.
2. Install updates, then restore your data from the copy you left at home. Save what you created on the trip first: on iPhone, restoring a backup means erasing the phone.
3. Check the sign-in activity of your accounts and sign out of anything you don't recognise.
4. If a device was out of your control during the trip, follow [If a device was taken out of your sight](/guides/travel-borders/#if-device-taken) before you trust it again.

A trip that went smoothly doesn't prove nothing was copied; it only means you have no sign that it was.
