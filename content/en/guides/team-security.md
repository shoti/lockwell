---
title: Keep a small team secure
description: Security for newsrooms, NGOs and activist groups: shared accounts, required two-step verification, joining and leaving, group chats and an incident plan.
summary: Give each person their own access, require two-step verification, have more than one admin, remove access the day someone leaves, and agree in advance what to do in an emergency.
audience: high-risk
group: teams
icon: users
order: 13
time: 45
progress: session
reviewed: 2026-11-12
status: published
---

A team is as safe as its least protected account. This guide is for small newsrooms, NGOs and activist groups that share accounts, documents and chats. It covers who can get into what, what to check when people join or leave, and what to do when something goes wrong. The UK's National Cyber Security Centre (NCSC) warns against leaving security to a single person: agree the steps together.

## Give each person their own access {#shared-accounts .essential}

When several people share one login, nobody can tell who did what, and nobody can take access away from one person without changing it for everyone.

1. Give each person their own account with only the rights they need, instead of sharing one password. Google advises against sharing admin accounts, and both Google and Microsoft suggest limited admin roles for everyday tasks.
2. For social media pages, use the platform's roles. In Meta Business Suite, **Full access** is the highest level and **Partial access** limits people to the tasks they are given.
3. Where a password must be shared, share it through a password manager, not in a chat. Bitwarden and 1Password, for example, let organisations share collections or vaults with only the people who need them. See [Use a password manager](/guides/accounts/#password-manager).
4. List every account the organisation depends on, as the NCSC suggests: email, storage, social media, the website, banking. Add the domain registrar too. Note who controls the recovery email and phone number of each one.
5. Have at least two admins for each important account, each managed by a different person. Google, Microsoft and 1Password all warn that a single admin who is locked out can lock out the whole team.

Roles limit what a person can do, not what they can copy while they have access. Plan for that when people leave.

## Require two-step verification for everyone {#require-2fa .essential}

The US cybersecurity agency CISA says two-step verification should be required by settings, not left to trust, and warns that gaps often appear with new staff and new phones.

### Google Workspace

1. In the Google Admin console: **Menu** → **Security** → **Authentication** → **2-step verification**. Tick **Allow users to turn on 2-Step Verification** with **Enforcement** set to **Off**, and give everyone time to enrol. Then set **On** or a start date: people who haven't enrolled by then can't sign in. You need to be a super administrator.
2. For **Methods**, **Only security key** now also accepts passkeys. Google warns that in this mode people can't make their own backup codes: an admin has to give them. If you exclude codes by text and phone call, people who use them will be locked out, so move them first.
3. Set the **New user enrollment period** short: until it ends, new members can sign in with just a password.
4. Allow admins and people at high risk to join Google's Advanced Protection Program (**Menu** → **Security** → **Authentication** → **Advanced Protection Program**), then have them enrol with two keys. See [Join Google's Advanced Protection Program](/guides/strong-accounts/#advanced-protection).

### Microsoft 365

1. Microsoft's **security defaults** make everyone register for multi-factor sign-in, and are usually on in organisations created after October 2019. Everyone needs an authenticator app: text codes aren't offered. To check, open the Microsoft Entra admin center, go to **Overview** → **Properties** → **Manage security defaults**, and make sure it is **Enabled**. Microsoft's own pages name the first menu item differently (**Entra ID** or **Identity**).
2. Microsoft warns not to switch off sign-in methods while security defaults are on: it can lock you out of your own organisation.
3. Requiring security keys only needs Microsoft's paid Conditional Access. Ask whoever manages your subscription.

### All teams

1. Ask everyone to set up a backup method and keep backup codes safe, and admins to register a spare security key: see [Set up two security keys](/guides/strong-accounts/#security-keys).
2. Tell people in advance what is required, by when, and which method to use, as Google suggests.

Two-step verification stops most password attacks, but codes by text or app can still be phished. Only security keys and passkeys resist that.

## Set up new members safely {#onboarding .recommended}

A new member's first days are when gaps appear: before two-step verification is on, before their phone is set up.

1. Before they get access, ask them to update their phone and computer and set a strong screen lock: see [Lock down your phone](/guides/phone/) and [Secure your computer](/guides/computer/).
2. Create their own accounts, add them to the password manager, and check that two-step verification is on before you give them more rights.
3. Add them to Signal groups only after you have checked their number or username in person or by a call: see [Check that you are talking to the right person](/guides/sensitive-conversations/#safety-numbers).
4. Explain where things go: which documents live where, which chat is for what, and whom to tell if something goes wrong.
5. Holistic Security suggests going over your security plan again whenever someone new joins.

A checklist doesn't help if nobody follows it. Give one person the job of checking each step, and tick it off together.

## Remove access the day someone leaves {#offboarding .essential}

NCSC warns that accounts often stay active after people leave without anyone noticing. Do this on their last day, or at once if they leave on bad terms.

1. Reset their password and sign them out everywhere. In Microsoft 365: **Users** → **Active users**, select the person, then **Reset password**, and on the **Account** tab **Sign out of all sessions**, then **Block sign-in**. Microsoft says blocking can take up to 24 hours, so the password reset matters.
2. In Google Workspace, Google's checklist includes removing their recovery email and phone, revoking app access, security keys and sign-in cookies, and wiping work data from their phone. Google says deleting the account is the surest way, but transfer their files first: deleted data can't be recovered after 20 days, and files in shared drives aren't transferred.
3. Remove them from the password manager, then change every password they could see. Bitwarden and 1Password both say a device kept offline can keep a readable copy; with 1Password, until it next goes online. That is why every password must change. 1Password says to assume admins saw everything in the vaults they managed.
4. Remove their roles on social media pages, the website, the domain registrar and bank accounts.
5. Remove them from Signal groups (only admins can), and reset group links: open the group, then **Group Link** → **Reset Link**.
6. Change any shared secret they knew, such as a Wi-Fi password or door code.

Removing access doesn't remove what someone already copied or remembers. If you expect someone to leave on bad terms, plan this in advance.

## Agree how the team uses group chats {#group-chats .essential}

Group chats are where most sensitive talk happens, so a few shared rules matter more than any setting.

1. Keep separate groups for different levels of sensitivity, and keep the sensitive ones small: see [Keep groups tight](/guides/sensitive-conversations/#groups).
2. In Signal, admins can choose who may add members, edit group details and manage invite links. Turn on **Approve New Members** if you use a link, and don't post invite links publicly, as Security in a Box advises.
3. Make only people you have verified admins, Security in a Box advises, and don't trust a display name alone.
4. Agree on a disappearing-messages timer. In Signal, anyone in the group can change it, and it only applies to new messages: see [Set disappearing messages as the default](/guides/sensitive-conversations/#disappearing-default).
5. If removing someone doesn't solve a problem, start a new group, Security in a Box suggests.

Disappearing messages don't stop a member from taking screenshots. A group is only as private as its least careful member.

## Write a simple incident plan {#incident-plan .essential}

Decide before an emergency what counts as one, who does what, and how you will reach each other. CISA suggests a written plan; Holistic Security, roles that everyone has agreed to in advance.

1. Name who to contact first, and a backup person, for each kind of problem: a hacked account, a lost or seized device, a member who is detained or harassed.
2. Keep a contact list on paper as well. CISA advises an address book you can use when your systems are down.
3. Agree a main and a backup way to reach each other, and what not to say on open channels.
4. For a hacked account, follow [If your account was hacked](/guides/hacked/). For a device that may be taken, see [If your phone or computer may be taken](/guides/device-seizure/).
5. Keep emergency access: Microsoft suggests two emergency admin accounts with security keys, stored separately; 1Password says you need your Emergency Kits if everyone who can recover accounts is locked out.
6. Know who can help: Access Now's Digital Security Helpline offers free 24/7 help to civil society, journalists and activists (help@accessnow.org; Georgian is not among its languages, Russian is). See [Know where to get expert help](/guides/threat-modelling/#get-help).
7. Practise the plan once, for example by walking through a scenario together.

A plan written once and forgotten won't help. Review it when people join or leave.

## Know where your data lives {#backups-and-data .recommended}

Teams often lose data not to attackers but to a deleted account, a lost laptop or a person who left with the only copy.

1. Keep shared documents in shared drives or folders that belong to the organisation, not to one person's account. Google says files in shared drives aren't lost when a member's account is deleted.
2. Back up everything the organisation needs, in two places, as the NCSC suggests: online and on a drive that you unplug after each backup.
3. Test that you can restore from the backup. CISA says many organisations hit by ransomware had backups that were incomplete or damaged.
4. Delete what you no longer need, including old accounts, as CPJ suggests: see [Delete what you no longer need](/guides/sources-documents/#deleting).
5. For sensitive files, follow [Keep fewer copies, and keep them encrypted](/guides/sources-documents/#storing-documents). See also [Back up, and be ready to lose a device](/guides/backups/).

A backup that anyone in the team can open is a copy that can leak. Limit who can reach it.

## Talk about security regularly {#training-and-culture .recommended}

CISA says security is about culture as much as technology, and that leaders can't delegate it.

1. Hold short, regular check-ins about security. Holistic Security says trust helps people share concerns and mistakes.
2. Make it easy to report a mistake, such as a clicked link, quickly and without blame: early reports limit the damage.
3. Warn each other about phishing, especially around elections or when colleagues report being targeted, as CPJ advises: see [Spot fake messages and calls](/guides/phishing/).
4. Agree the rules together. Holistic Security notes that people may not accept a plan made without them.
5. Access Now and the Freedom of the Press Foundation offer training and help to organisations.

Training lowers the risk but can't remove it. Plan as if someone will eventually click.
