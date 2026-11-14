---
title: How accounts really get taken over, and what stops it
description: Many stolen accounts are never hacked. Someone signs in with a leaked, phished or copied login. What the evidence says about the defences that work.
summary: Many stolen accounts are never "hacked". Someone simply signs in as you. Here is how they get what they need, and what the evidence says about stopping them.
icon: logIn
published: 2026-11-14
status: published
---

In 2023, attackers got into about 14,000 accounts at 23andMe, a company that sells DNA tests. They didn't break into the company's systems. They signed in, one account after another, with email addresses and passwords that had leaked earlier from other websites. The owners of those accounts had used the same password in both places.

It didn't stop there. A feature that connects relatives let the attackers see the profiles of about 6.9 million other people, who had done nothing wrong at all.

This is what account theft often looks like. Nobody "hacks" anything in the way films show it. Someone gets hold of what you use to sign in, and then signs in as you. This article describes the four ways that happens, and what the evidence says about the defences.

## Your password may already have leaked {#leaks}

Websites get breached all the time, and the stolen lists of email addresses and passwords are traded and collected. The service Have I Been Pwned, which lets anyone check whether their address is in a known leak, counted almost 17.9 billion leaked account records from 1,052 breaches in November 2026. One collection it added in November 2025 held almost 2 billion email addresses and 1.3 billion different passwords. It was made up of lists that criminals pass around for one purpose: trying them on other sites.

That technique is called **credential stuffing**. Software takes a leaked pair of email address and password and tries it on hundreds of other services. It works because people reuse passwords. In 2025, Verizon's researchers looked at the saved passwords on thousands of infected devices and found that for a typical user only 49% of the passwords were different from each other. In the sign-in records of the organisations they studied, credential stuffing made up 19% of all sign-in attempts on a typical day.

![Reuse is what turns one site's leak into your problem everywhere.](figure:credential-stuffing)

A leak is not always fatal. In a 2017 study with the University of California, Berkeley, Google examined 1.9 billion usernames and passwords exposed in breaches, and millions more stolen by phishing and malware. Depending on how the password was stolen, for 7% to 25% of the affected Google users it was still their current Google password. For the rest it didn't match, for instance because it had been changed or was never used at Google. A unique password for each site makes a leak somewhere else harmless.

## Phishing: when you hand it over yourself {#phishing}

The same study found something more striking. People whose password had been in a breach were 10 times more likely than an average user to have their Google account hijacked. For people who had typed their password into a phishing page, it was 400 times.

The reason is simple. A leaked password may be old. A phished password is the one you use today, typed in a minute ago.

Phishing has also learned to get past the codes that many people rely on as a second step. A modern phishing page doesn't just collect what you type. It passes it to the real site at once, as if it were you, and keeps the signed-in session that the real site gives back. Microsoft described such a campaign in 2022: it had tried to reach more than 10,000 organisations, and it "stole passwords, hijacked a user's sign-in session, and skipped the authentication process even if the user had enabled multifactor authentication". In some cases the attackers began committing fraud five minutes after the theft. In its 2026 report, Microsoft says the share of such attacks, together with the theft of sign-in sessions, more than doubled in the first half of the year, though it is still small. Password attacks fell by 26% in a year, but remain by far the most common.

## Malware that copies the login itself {#infostealers}

A third route doesn't involve a fake page at all. A kind of malware called an **infostealer** runs on a computer, copies every password saved in the browser, and sends it off. It also copies the browser's session cookies. Those are the small files that keep you signed in, so that you don't have to type a password on every visit.

A stolen session cookie can be worse than a stolen password, because it skips both the password and the second step. As Google's Chrome team puts it, cookie theft "happens after login", so it gets past two-step verification as well.

In 2024, attackers used logins stolen this way to get into the accounts of companies that stored data with the cloud provider Snowflake. About 165 organisations had to be warned. According to the investigators at Mandiant, some of the passwords had been stolen by infostealers as far back as 2020 and never changed, and the accounts were not protected by a second step.

## The side doors: recovery, phone numbers and people {#side-doors}

Every account has another way in: the route for people who forgot their password. Attackers use it too.

- **Your phone number.** In January 2024, attackers took over the X account of the US financial regulator, the SEC, and posted a false announcement. They had first taken control of the phone number linked to the account, in what the SEC called an apparent SIM swap: the number is moved to a SIM card that the attacker holds. With the number in hand, they reset the account's password. Two-step verification had been switched off on the account some months before.
- **A person who can be talked round.** In 2025, the British retailer Marks & Spencer was hit by an attack that began, in its chairman's words to Parliament, with "sophisticated impersonation". US agencies describe the method in a warning about one criminal group: its members pose as employees to convince help desk staff to reset a password and move two-step verification to a device they control.
- **Your own patience.** In 2022, an attacker who, Uber believes, had bought the password of one of its contractors sent one sign-in approval request after another to the contractor's phone. Eventually the contractor accepted one.

The lesson from all three: an account is as strong as its weakest way in, and that is often not the password.

## What works, according to the evidence {#evidence}

In 2019, Google published a year-long study with New York University and the University of California, San Diego. It looked at what happened when Google asked for an extra proof during a suspicious sign-in, and counted how many takeover attempts each kind of proof stopped.

Against automated attacks by software, all three kinds of second step stopped 100%. The differences appeared when people were involved:

- A **security key** stopped 100% of bulk phishing and 100% of targeted attacks.
- A **prompt on the phone** stopped 99% of bulk phishing and 90% of targeted attacks.
- A **code by SMS** stopped 96% of bulk phishing and 76% of targeted attacks.

![In Google's data, each of the three stopped almost all mass attacks. Only a security key stopped every targeted one.](figure:second-step-evidence)

Two things follow. First, any second step is far better than none. Even the weakest one, a code by SMS, stopped almost all mass attacks, which are the kind most people ever meet. A 2023 Microsoft study of business accounts on its cloud service found that accounts with two-step verification were 99.22% less likely to be compromised.

Second, the methods are not equal, and the gap is exactly where the real-time phishing described above works. These numbers are from 2019, they cover Google accounts only, and real-time phishing has grown since. A code can be passed on, whether it arrives by SMS or comes from an app. The US cybersecurity agency CISA calls a code by text or email the weakest form of second step, to be used only if nothing stronger is available.

## Why passkeys and security keys are different {#passkeys}

A password and a code are both secrets that you type. Whatever you can type into the real site, you can be tricked into typing into a fake one.

A **security key** (a small device you plug in or tap) and a **passkey** (the same idea built into your phone, computer or password manager) work differently. When you set one up, it creates a pair of keys for that one website, and it remembers the website's address. When you sign in, your device checks the address before the key answers. On a look-alike site it simply has nothing to offer. There is no secret for you to type, so there is nothing for a fake page to pass on.

![A code can be passed on by a fake page. A passkey or security key answers only to the real site.](figure:phishing-relay)

The best-known example comes from Google itself. In early 2017 it required all of its more than 85,000 employees to sign in with security keys. More than a year later, it told the journalist Brian Krebs that not one of them had been successfully phished on a work account since.

Passkeys are no longer rare. The FIDO Alliance, the industry body behind the standard, estimated in May 2026 that 5 billion passkeys were in use. At the services that report to its index, more than one in three sign-ins now uses a passkey.

Passkeys have limits, and it is better to know them:

- **The side doors stay open.** If an account with a passkey can still be recovered with an SMS code, an attacker will go for the SMS code. Microsoft's 2026 report says attackers are moving to account recovery for exactly this reason.
- **Passkeys that sync depend on another account.** A passkey saved in your Apple, Google or password manager account is copied to your other devices in encrypted form. That is convenient, and it means that account now protects all the others. Give it the strongest protection you have.
- **They protect the sign-in, not a session that is already open.** Malware that copies session cookies still works against an account with a passkey.

## And the password itself? {#passwords}

Much of the old advice about passwords has been withdrawn by the people who gave it. The current US standard, published by NIST in 2025, tells services not to demand a mix of character types and not to make people change passwords on a schedule. Passwords should be changed when there is evidence they were stolen. What counts is length, and that the password is not on a list of known leaked ones. The UK's National Cyber Security Centre suggests joining three random words.

Nobody can remember a different long password for every account. A **password manager** remembers them for you, and it has a second benefit that is easy to miss: it fills in a password only on the site it was saved for. On a look-alike address it stays silent, which is a warning in itself.

Password managers are not beyond attack either. In 2022, an attacker copied a backup of customers' password vaults from the company LastPass. The addresses of the saved websites were not encrypted. The usernames and passwords were, under each customer's main password. So the one password you still have to invent and remember should be long, and used nowhere else.

## What to do {#what-to-do}

In order of how much each step changes:

1. [Use a password manager](/guides/accounts/#password-manager) and give every account its own password. [Start with your email](/guides/accounts/#unique-passwords): whoever controls it can reset the passwords of your other accounts.
2. [Turn on two-step verification](/guides/accounts/#two-step) everywhere it is offered. If SMS is the only option, use SMS.
3. [Switch to passkeys](/guides/accounts/#passkeys) where you can, starting with your email and your password manager.
4. [Check how each important account can be recovered](/guides/accounts/#recovery), and remove phone numbers and email addresses you no longer control. Before you remove a method that still works, make sure you have a second way in, such as a second passkey or saved recovery codes.
5. Never approve a sign-in request you didn't start, and never pass on a code. The [phishing guide](/guides/phishing/) shows what such attempts look like.
6. If something already looks wrong, follow [If your account was hacked](/guides/hacked/).

People who expect to be targeted personally, such as journalists and activists, should go further: see [Make your accounts hard to take over](/guides/strong-accounts/).

## Sources {#sources}

All sources were read on 14 November 2026.

- 23andMe: [Addressing data security concerns](https://blog.23andme.com/articles/addressing-data-security-concerns)
- Have I Been Pwned: [home page counters](https://haveibeenpwned.com/); Troy Hunt: [2 billion email addresses were exposed, November 2025](https://www.troyhunt.com/2-billion-email-addresses-were-exposed-and-we-indexed-them-all-in-have-i-been-pwned/)
- Verizon: [Additional 2025 DBIR research on credential stuffing](https://www.verizon.com/business/resources/articles/credential-stuffing-attacks-2025-dbir-research/)
- Google and UC Berkeley: [Data breaches, phishing, or malware? Understanding the risks of stolen credentials, 2017](https://research.google/pubs/data-breaches-phishing-or-malware-understanding-the-risks-of-stolen-credentials/)
- Microsoft: [From cookie theft to BEC, July 2022](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/), [Digital Defense Report 2026](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/msc/documents/presentations/CSR/2026-Microsoft-Digital-Defense-Report.pdf) and [How effective is multifactor authentication at deterring cyberattacks?, 2023](https://www.microsoft.com/en-us/research/publication/how-effective-is-multifactor-authentication-at-deterring-cyberattacks/)
- Google Chrome team: [Fighting cookie theft using device bound sessions, April 2024](https://blog.chromium.org/2024/04/fighting-cookie-theft-using-device.html)
- Mandiant: [UNC5537 targets Snowflake customer instances, June 2024](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion)
- US Securities and Exchange Commission: [statement on the @SECGov X account, January 2024](https://www.sec.gov/secgov-x-account)
- UK Parliament: [oral evidence of Archie Norman, 8 July 2025](https://committees.parliament.uk/oralevidence/16268/html); CISA and FBI: [advisory on Scattered Spider](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a)
- Uber: [security update, September 2022](https://www.uber.com/newsroom/security-update/)
- Google, New York University and UC San Diego: [How effective is basic account hygiene at preventing hijacking, May 2019](https://security.googleblog.com/2019/05/new-research-how-effective-is-basic.html)
- CISA: [Require multifactor authentication](https://www.cisa.gov/secure-our-world/require-multifactor-authentication)
- Krebs on Security: [Google: security keys neutralized employee phishing, July 2018](https://krebsonsecurity.com/2018/07/google-security-keys-neutralized-employee-phishing/)
- FIDO Alliance: [Passkeys](https://fidoalliance.org/passkeys/), [World Passkey Day 2026 report](https://fidoalliance.org/fido-alliance-reports-accelerating-global-passkey-adoption-on-world-passkey-day-2026/) and [Passkey Index, October 2026](https://fidoalliance.org/wp-content/uploads/2026/10/Passkey-Index-October-2026.pdf)
- NIST: [SP 800-63B-4, Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html)
- UK National Cyber Security Centre: [Three random words](https://www.ncsc.gov.uk/collection/top-tips-for-staying-secure-online/three-random-words) and [Password managers](https://www.ncsc.gov.uk/collection/top-tips-for-staying-secure-online/password-managers)
- LastPass: [Notice of recent security incident, December 2022](https://blog.lastpass.com/posts/notice-of-recent-security-incident)
