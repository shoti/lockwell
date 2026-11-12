---
title: Protect sources and sensitive documents
description: How sources can reach you safely, how to remove hidden data and redact files properly, and how to store, share and delete sensitive documents.
summary: A first message, a file or a forgotten copy can lead back to a source. Plan first contact, clean and redact files properly, and keep as little as you can.
audience: high-risk
group: teams
order: 12
time: 40
progress: session
reviewed: 2026-11-12
status: published
---

Journalists, researchers and people who document abuses can expose a source without meaning to: through the first message, through hidden data in a file, or through a copy left on a device. This guide covers first contact, cleaning and redacting files, and storing, sharing and deleting them. It doesn't cover what the law says about protecting sources; ask a lawyer about that.

## Plan how sources first reach you {#first-contact .essential}

The Freedom of the Press Foundation (FPF) calls this the first-contact problem: by the time someone reaches out, they may already have left a trail back to themselves, for example an email sent from a work computer.

1. Publish how to reach you securely, early and where people will see it, long before anyone needs it. Add what not to do: don't contact you from work or through any channel the workplace can access, and don't tell anyone.
2. On Signal, give a username, not a phone number: see [Hide your phone number](/guides/sensitive-conversations/#username-not-number). FPF suggests sources set a username before they write, so they don't share their own number.
3. Keep a published username working. Use the account regularly (FPF reads Signal's code as closing accounts after 120 days without use, which frees the username), don't change the username, and set a PIN and Registration Lock: see [Lock your Signal number](/guides/sensitive-conversations/#registration-lock). In July 2026 FPF reported that an impersonator had taken over a newsroom's published Signal username. Signal says that once you change a username, anyone can soon claim it.
4. Ask sources to check your username or address on your organisation's own website, not in a message or on a copy of the page.
5. If you and someone already have a Signal chat by phone number, and they then write to your username, Signal merges the two chats when you accept. The number and the username are then linked.
6. If your organisation runs SecureDrop, list it. SecureDrop tells sources not to use it on their employer's network or hardware, or on their home internet. It gives each source a random codename; if they lose it, you can no longer reach them.

End-to-end encryption hides what is said, not that two people are in contact. If a source has already reached you over a risky channel, FPF says there is no bulletproof fix.

## Tell sources to keep away from work devices {#source-devices .essential}

Employers can often see a lot of what happens on their devices, accounts and networks. FPF notes that a work email server usually keeps copies of sent, received, draft and even deleted emails, and that its administrator can read them.

1. Tell sources not to call, email or message you from work, from a work account, or on a work device or work Wi-Fi.
2. If the workplace made them install monitoring software on a personal phone or computer, FPF advises not using that device either.
3. On a work network, apps such as Signal or Tor can stand out to an administrator, even though the content can't be read.
4. It is often safer for a source not to tell anyone, FPF says. SecureDrop also warns against using AI chatbots or other services linked to your identity to look up how to leak.

If only a few people could have seen the material, staying off work devices won't hide who it came from.

## Remove hidden data from files {#metadata-in-files .essential}

Office files and PDFs can carry the author's name, comments, tracked changes, earlier versions and hidden text. Photos can carry the place where they were taken. Always work on a copy.

### Word

1. Accept or reject all tracked changes: on the **Review** tab, choose **Accept → Accept All Changes** or **Reject → Reject All Changes**. Microsoft says **No Markup** only hides changes; they show again the next time someone opens the file. Delete all comments too, from the **Review** tab: accepting changes doesn't remove them, and they carry their authors' names.
2. On Windows, on a copy of the file: **File → Info → Check for Issues → Inspect Document**, then **Inspect**, and **Remove All** for each category you want to remove. Microsoft warns that removed data can't always be restored, even with **Undo**.
3. Microsoft says the inspector misses text hidden in other ways, such as white text on a white background, and objects covered by other objects. Check for these yourself.
4. Microsoft's page describes the inspector for Windows only. We haven't found a current Microsoft path for Word on Mac.

### PDF

1. In Adobe Acrobat Pro: **All tools → Redact a PDF**, then **Sanitize document** in the left pane, and **Remove all**. Adobe says this covers metadata, comments, attachments, hidden layers and hidden text.

### Our tools

1. Our [document metadata tool](/tools/document-metadata/) reads Word, Excel, PowerPoint and PDF files on your device. It clears Office file properties, but not tracked changes or comments. PDFs it can only check, not clean.
2. For photos, our [photo metadata remover](/tools/photo-metadata/) removes location, device details, dates and the embedded preview: see [Remove location from your photos](/guides/location-photos/#photo-metadata).

FPF warns that pictures inside a document keep their own metadata even after you clean the document. FPF suggests exporting to a different format, or copying the text into a new, empty document. None of this hides what the text itself says.

## Redact so the text is really gone {#redaction .essential}

A black box drawn over text can leave the text underneath, and anyone can copy it out. The text itself has to be removed.

### PDF

1. In Adobe Acrobat Pro: **All tools → Redact a PDF → Redact text and images**, select what to remove, then **Apply**. In the dialog, turn on the option to sanitize and remove hidden information, then **Continue** and save. Adobe says redaction removes only visible text and graphics; hidden data needs sanitizing too.
2. In Preview on a Mac, use the **Redaction Selection** markup tool, not a shape. Apple says the redaction becomes permanent once you close the document, and that table-of-contents entries linking to redacted text aren't removed.
3. A rectangle drawn with Preview's shapes stays an annotation that can be edited, unless you save with **File → Print → Save as PDF**. Apple doesn't say this removes the text underneath, so don't use shapes to redact.

### Photos

1. Cover faces and details with fully opaque blocks, not blur or a see-through marker or highlighter. FPF says some blurring can be reversed and many markers aren't fully opaque. Our [image redaction tool](/tools/image-redaction/) paints solid blocks into the picture, so the pixels underneath don't exist in the saved copy.
2. Editors that keep layers or history, such as GIMP, can keep what you covered. Export a flat copy before you share it.

### Check the result

1. Open the saved copy, try to select and copy the text under each block, and paste it somewhere else. Look at the file on another device too.
2. Remove details that identify someone in combination, such as places, dates or life events. OpenNews notes these can narrow down an anonymous person quickly.

Redaction hides only what you cover. Wording, layout and other details in the rest of the document can still point to someone.

## Watch for marks you can't see {#hidden-marks .recommended}

A document can show where it came from even after its metadata is gone.

1. EFF advises assuming that all modern colour laser printers add tracking codes linked to the printer, whether or not you can see them. Printing a file to clean it can add such a mark.
2. An organisation can hand out almost identical copies with small differences in wording, spacing or typos, so that a published copy shows whose it was. No tool finds these. Retell what the document says in your own words instead of publishing it, and leave out details such as exact figures that could differ between copies.
3. Text can carry characters that don't show on screen, such as zero-width spaces. Our [hidden character detector](/tools/hidden-characters/) finds them, and flags letters from other alphabets that look the same.
4. FPF advises recreating a document from scratch before publishing it or showing it to anyone else.

Screenshots and retyping remove file metadata but keep wording and visible marks. FPF notes that some Android phones add new metadata to screenshots.

## Share as little as you can {#sharing-safely .essential}

FPF says sharing information can be less risky than sharing documents. Ask whether someone needs the file or only what it says.

1. Publish only what the story needs. OpenNews warns that details which don't identify anyone on their own can be pieced together with public information.
2. Send files over Signal rather than email. Ordinary email isn't end-to-end encrypted; FPF compares it to a postcard.
3. Clean or recreate a copy before you show it to anyone outside the team. Keep in mind that a cleaned copy holds less of what's needed to check where a document came from.
4. Signal warns that disappearing messages don't stop the other person from photographing the screen: see [Set disappearing messages as the default](/guides/sensitive-conversations/#disappearing-default).
5. Don't scan QR codes inside documents you receive with a device that is online. SecureDrop warns they can contain malicious links that reveal who your sources are.

Encryption protects a file on its way, not what the recipient does with it afterwards.

## Keep fewer copies, and keep them encrypted {#storing-documents .recommended}

FPF says the best way not to compromise a source is to keep as little information as you can.

1. List every place a copy lives: phone and laptop, cloud sync, the recorder, a transcription service, printouts, USB drives, emails to yourself and early drafts. FPF notes early drafts may still hold names you removed later.
2. Turn on disk encryption and check it: see [Encrypt the disk and keep the recovery key](/guides/computer/#disk-encryption) and [Check that encryption is on](/guides/device-seizure/#encryption-on).
3. FPF says most cloud services can read the files you upload. Encrypt files before you upload them, or on iCloud turn on **Advanced Data Protection**: see [Use Apple's strongest account settings](/guides/strong-accounts/#apple-protections).
4. Security in a Box suggests encrypted containers or drives, such as VeraCrypt, for external drives. Close an encrypted volume before you walk away, before your computer sleeps, and before you plug in a USB stick you don't trust.
5. Switch devices off when you don't need them, for example overnight: see [Know why switching off matters](/guides/device-seizure/#before-first-unlock).
6. If you often open files from people you don't know, consider Qubes OS, which Privacy Guides lists for security. It runs tasks in separate, isolated virtual machines, and can open an untrusted file in a disposable one that keeps it away from your other files and is deleted afterwards. It needs a computer with hardware virtualisation and at least 6 GB of memory; Qubes recommends an Intel processor and 16 GB. Check its lists of certified and community-recommended computers before you buy. It keeps a harmful file away from the rest of your computer; it doesn't remove hidden data from the file itself.

Encryption doesn't help while a device is on and unlocked or a volume is open, and it doesn't help against malware on the device. If the recovery key is stored in your Microsoft or Apple account, the disk is only as safe as that account.

## Delete what you no longer need {#deleting .recommended}

EFF says emptying the trash only makes a file invisible; it can stay on the disk for weeks, months or even years.

1. EFF says secure deletion works reliably only on spinning hard drives, not on SSDs, USB sticks or SD cards, which most devices now use. On those, encryption is the best protection.
2. Before you sell or give away a computer, make sure it is encrypted, then reset it: see [Erase the computer before you sell or give it away](/guides/computer/#before-selling).
3. Go through your list of copies: deleting a file on one device doesn't delete synced copies, backups, emails or copies other people have.
4. Move recordings to encrypted storage and then delete them from the recorder. FPF says an SD card from a recorder should ideally be destroyed.
5. FPF warns not to count on your organisation wiping a seized device remotely.

If you face an investigation or a legal demand, talk to a lawyer before you delete anything. You can't delete copies that other people already have.
