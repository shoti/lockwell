---
title: Control who knows where you are
description: Stop live location shares you forgot, remove location from photos, check who sees you in Find My and Find Hub, and clear your location history.
summary: Your phone and your photos can show where you live and where you are now. Decide who sees that.
audience: everyone
group: habits
icon: pin
order: 7
time: 35
reviewed: 2026-11-14
status: published
---

Your phone knows where you are, and it can tell others: through a live location you shared once and forgot, through the location stamped inside your photos, or through a location history kept for years. This guide checks each of these. The two **Essential** items take about ten minutes. For which apps may use your location at all, see [Check what your apps can access](/guides/phone/#app-permissions).

## Stop live location shares you don't need {#live-location .essential}

A live location shows where you are in real time, sometimes with how you are travelling and your battery level. Shares are easy to start and easy to forget. Telegram even offers to share "until you turn it off". Check each app you use. On iPhone, the people you stop sharing with may notice that you stopped.

### WhatsApp

1. On Android, tap ⋮, then **Settings → Privacy → Live location**. On iPhone, tap **You → Privacy → Live location**.
2. Tap **Stop sharing** and confirm.

### Google Maps

1. Tap your profile picture, then **Location sharing**.
2. Tap each person you no longer want to share with, then **Stop**. Sharing works even when Timeline is off.

### Find My (iPhone)

1. Open **Find My** and tap **People** to see who can see you.
2. To stop for one person, tap their name, then **Stop Sharing My Location**. To stop for everyone, tap **Me** and turn off **Share My Location**. **Hide Location** only pauses sharing until the next day.

### Telegram

1. While you share your live location, a bar at the top of the screen shows it.
2. Tap the bar and stop sharing.

## Remove location from your photos {#photo-metadata .essential}

Your phone's camera can write the exact place where a photo was taken into the photo file. Whoever gets the original file can read it. You can stop the camera saving it, or remove it before you share a photo. Even without it, a photo can show where you are through what is in it.

![Remove the hidden data, and check what the picture itself shows.](figure:photo-metadata)

### iPhone {.ios}

1. To stop saving location, go to **Settings → Privacy & Security → Location Services → Camera** and choose **Never**.
2. To share a photo without its location, tap the Share button, then **Options**, and turn off **Location**. **Location Not Included** then appears above **Options**.
3. To remove it from a photo you already took, open the photo, tap the Info button, then **Adjust Info → Adjust Location → No Location**.

### Android {.android}

1. To stop saving location, open the camera's settings. On a Pixel, tap **Settings → More settings** and turn off **Save location**. On a Samsung, turn off **Location tags**. Other phones use similar names.
2. Google Photos can't remove a location your camera added. Before you send such a photo, clean it with our [photo metadata remover](/tools/photo-metadata/).
3. In a shared Google Photos album, tap **Share → Options** and turn off **Share photo locations**.

### Any device

1. Our [photo metadata remover](/tools/photo-metadata/) shows what a photo reveals and saves a copy without it, on your device. It reads JPEG, PNG, WebP, HEIC and AVIF photos. In HEIC photos, the format iPhones use by default, it removes the location, dates and device details but can't remove the small preview picture stored with it, and it says so when one is there.
2. For videos, our [video metadata remover](/tools/video-metadata/) does the same with MP4, MOV, M4V and 3GP files: it removes the location, the recording time, the device details and the GPS routes that action cameras record, without changing the picture or the sound.

## Check who can see where you are {#find-my-sharing .recommended}

Find My on iPhone and Find Hub on Android keep one list of everyone you share your location with. People can be on it for years: a former partner, someone who set up your phone. Check the list, and know how to find a tracker someone may have hidden on you.

### iPhone {.ios}

1. Open **Find My → People** and stop sharing with anyone who shouldn't see you.
2. For alerts about trackers moving with you, keep **Location Services**, **Find My iPhone** under **System Services**, and **Bluetooth** on, and turn on **Settings → Notifications → Tracking Notifications → Allow Notifications**. Airplane mode stops these alerts.
3. To see trackers found with you, open **Find My → Items → Items Detected With You**.

### Android {.android}

1. Open **Find Hub** and filter the list by **You're sharing with**. Tap a person and **Stop sharing**. Stopping here also stops the share in Google Maps.
2. For tracker alerts, open **Settings → Safety & emergency → Unknown tracker alerts** and turn on **Allow alerts**. **Scan now** looks for trackers near you.

> [!warning]
> If you find a tracker you didn't place, think about your safety before you switch it off: its owner will stop getting updates and may notice. Take a screenshot of the owner information first. Turning off Bluetooth or location on your phone doesn't stop the tracker reporting where it is. If you are afraid of the person, ask someone you trust or a support service for help.

## Clear your location history {#location-history .recommended}

Your phone can keep a record of the places you go, sometimes for years. It helps with travel and photo memories, but anyone who gets into your phone or account can read it. Keep it short, or turn it off.

### iPhone {.ios}

1. Go to **Settings → Privacy & Security → Location Services → System Services → Significant Locations & Routes**. Tap **Clear History**, or turn it off. Apple encrypts this history end to end; clearing it clears it on all your devices.
2. Apple Maps keeps its own list: go to **Settings → Apps → Maps → Location** and turn off **Visited Places**, or set a shorter time in Maps under **Places → Visited Places → Keep Visits**.

### Android {.android}

1. Google Maps **Timeline** is off unless you turned it on. To check, open Google Maps, tap your profile picture, then **Your Timeline → More → Location & privacy settings**.
2. Turn it off, or tap **Auto-delete Timeline** and choose 3 months.
3. Timeline is stored on each phone. A backup to Google is a separate choice, and deleting Timeline on one phone doesn't delete it on another.

## Check your shared albums {#shared-albums .recommended}

A shared album can stay open long after you stop thinking about it, and some can be opened by anyone with the link. People you remove keep any copies they saved.

### iPhone {.ios}

1. Open a shared album you created and tap **Manage Shared Album** (on iOS 26 and earlier, the More button, then the album name).
2. Remove people who shouldn't see it with **Remove Participant** (**Remove Subscriber** on older versions).
3. On iOS 27, check **Sharing Options** in **Manage Shared Album**: let in only people you invite or approve, not anyone with the link. On iOS 26 and earlier, check that **Public Website** is off unless you want anyone to see the album.

### Android {.android}

1. In Google Photos, tap your profile picture, then **Photos settings → Sharing → Manage sharing activity** to see all your shared links and albums.
2. In an album, tap **More → Sharing**. Remove people with **More → Remove person**, and turn off **Link sharing**: otherwise people you removed can come back through the link.

## Think about what's in the picture {#whats-in-the-picture .advanced}

A photo without location data can still give you away: a street sign, the view from a window, a school uniform, a face in the background. Before you post, look at the whole picture. If others are in it, ask them first: you may be showing where they are too.

### All devices

1. Crop or cover things that identify a place or a person. Covering is safer than blurring, which can sometimes be undone. Our [image redaction tool](/tools/image-redaction/) covers areas with solid shapes and crops the image.
2. Post photos of where you are after you have left, not while you are there.
