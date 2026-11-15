---
title: Go online without revealing who you are
description: What Tor Browser hides and what it doesn't, the mistakes that give you away, and when bridges, a VPN, Tails or a phone help or fall short.
summary: Tor Browser hides where you are from the sites you visit, but not that you use Tor. Most people lose their anonymity through their own habits, not a broken tool.
audience: high-risk
group: threats
icon: incognito
order: 11
time: 40
progress: session
legal: true
reviewed: 2026-11-12
status: published
---

Privacy keeps what you do from others; anonymity keeps who you are from them. This guide is about the second: reading, searching and publishing without the site, or anyone watching your connection, learning who and where you are. [Tor Project's best practices for Tor Browser](https://support.torproject.org/faq/staying-anonymous/) say perfect anonymity is generally impossible, even with Tor. Using Tor is also visible to your internet provider by default, and can draw attention. Weigh that before you start: see [Weigh what protection costs](/guides/threat-modelling/#costs).

## Know what Tor hides and what it doesn't {#what-anonymity-means .essential}

Tor sends your connection through at least three servers, called relays. [Tor Project's page on what Tor protects](https://support.torproject.org/about-tor/introduction/protections/) says this is so that no single point can reveal both who you are and what you are doing. It has limits, described below.

1. Without Tor, your internet provider can see every site you visit, and every site sees your IP address, which shows roughly where you are.
2. With Tor, your internet provider sees only that you connect to Tor, and the site sees only that someone connects from Tor.
3. The last relay can see your traffic but not who sent it. If the site uses HTTPS, it sees only which site you are visiting.
4. A VPN is different: one company knows both who you are and what you browse. See [Know what a VPN can't do](/guides/anonymity/#vpn-limits).
5. A private or Incognito window doesn't make you anonymous: see [Know what a private window doesn't hide](/guides/browser/#private-window-limits).

![A VPN moves your trust from your internet provider to the VPN company. Tor splits it between three relays.](figure:who-sees-what)

[Tor Project's page on attacks that remain against Tor](https://support.torproject.org/about-tor/security/attacks-on-onion-routing/) says Tor doesn't protect you from someone who can watch both your connection and the site you visit, or its last relay, at the same time and match the timing. Sites can tell you use Tor, because the list of Tor relays is public.

## Use Tor Browser safely {#tor-browser .essential}

Tor Browser protects only what you do inside it. Other browsers and apps on the same device still use your normal connection.

### Computer {.desktop}

1. Download Tor Browser from download.torproject.org. If that site is blocked, Tor Project lists an official mirror at tor.eff.org, and the **@GetTor_Bot** account on Telegram.
2. Tor Project recommends checking the file's signature before you install it; the steps are on its download pages.
3. To raise the security level, click the shield icon next to the address bar, then **Settings…**, choose **Safer** or **Safest**, and **Save and restart**.
4. To switch to a different activity or identity, open the menu (**≡**) and choose **New Identity**. It closes all tabs, clears cookies and history, and uses new connections. **New Tor Circuit for this Site** does not do this and doesn't unlink your activity.

### Android {.android}

1. Install Tor Browser from Google Play, F-Droid (Guardian Project's repository) or the Tor Project website. EFF warns that stores show many look-alike apps that Tor Project doesn't endorse.
2. To raise the security level, tap the three-dot menu, then in **Privacy and security** tap **Security Level**. Choose **Safer** or **Safest**, then **Save and restart**.

### All devices

1. **Safer** turns off JavaScript on sites without HTTPS. **Safest** turns it off on all sites and blocks some fonts, icons and images. EFF says **Standard** is fine for everyday privacy and **Safest** is an option if you are worried. Some sites will break.
2. Don't install extensions, even ad blockers. [Tor Project's page on add-ons](https://support.torproject.org/tor-browser/features/plugins/) says they can make your browser unique and give you away.
3. Don't choose which countries your connection exits from. [Tor Project's page on managing identities](https://support.torproject.org/tor-browser/features/managing-identities/) says changing how Tor builds connections can weaken your anonymity.
4. If you see **Secure Connection Not Available**, choose **Go Back** unless you are sure. On a site without HTTPS, the last relay can read and change what you send, Tails warns.

Many sites show CAPTCHAs to Tor users or block them. That is normal, not a sign that something is wrong.

## Avoid the mistakes that give you away {#mistakes .essential}

Tor hides your IP address. It can't hide what you tell a site yourself.

1. If you sign in to a personal account or enter your name, email, phone number or address, that site knows who you are. Banks and email providers may also lock the account, [Tor Project's page on account lockouts](https://support.torproject.org/tor-browser/encountering-issues/website-lockout/) warns.
2. Don't use two identities in the same session: sites can link accounts that use the same Tor connection. Use **New Identity** in between, or restart Tails.
3. Use a separate username, email address and phone number for an anonymous identity, and don't reuse them elsewhere. [Privacy Guides' page on common misconceptions](https://www.privacyguides.org/en/basics/common-misconceptions/) notes that writing style and what you know can also link a pseudonym to you, and suggests keeping pseudonyms short-lived and changing them regularly. [Security in a Box's guide to multiple identities](https://securityinabox.org/en/assess-plan/multiple-identities/) says it can be a good idea to post from different identities at different times of day.
4. When Tor Browser warns you before opening a downloaded file in another app, take the warning seriously. Tor Project says Word and PDF files can load content from the internet outside Tor and reveal your real IP address. Tor Browser's own PDF viewer is the exception. Open other files on a computer that is offline, or convert them first with a tool such as Dangerzone.
5. Remove metadata before you upload photos or documents: see [Remove hidden data from files](/guides/sources-documents/#metadata-in-files).
6. Don't use torrent apps over Tor. Tor Project says most of them reveal your real IP address.
7. Watch for people or cameras that can see your screen.

None of these steps hide you from someone who already has access to your device. See [Spyware aimed at you](/guides/spyware/).

## Know what a VPN can't do {#vpn-limits .recommended}

A VPN hides your IP address from sites, but the VPN company sees your traffic. [EFF's guide to choosing a VPN](https://ssd.eff.org/module/choosing-vpn-thats-right-you) says a VPN "is not a tool for anonymity" and that Tor is the better choice for it. See [Know what a VPN does and doesn't do](/guides/wifi/#vpn-what-it-does).

1. A VPN doesn't stop tracking by cookies, fingerprinting, GPS or accounts you sign in to.
2. [Tor Project's page on using a VPN with Tor](https://support.torproject.org/tor-browser/general/vpn-with-tor/) doesn't recommend combining a VPN with Tor unless you are an advanced user, because a wrong set-up can weaken Tor's protection. [Privacy Guides' Tor overview](https://www.privacyguides.org/en/advanced/tor-overview/) disagrees and says connecting to a trusted VPN first is worth it for many people. It strongly warns against connecting through Tor first and then a VPN.
3. As of November 2026, Tor Project's new Tor VPN app for Android is a beta. [Tor Project's page about Tor VPN](https://support.torproject.org/tor-vpn/getting-started/about-tor-vpn/) says to use it only for testing, because it may leak information.

A VPN company's promise not to keep logs is not a guarantee, EFF says.

## If Tor is blocked, use a bridge {#bridges .recommended}

Bridges are Tor relays that aren't on the public list. They help you connect where Tor is blocked. They may slow down your connection.

### Computer {.desktop}

1. If Tor Browser can't connect, its Connection Assist can pick a bridge for you based on your location. If it can't tell, choose your region and click **Try a Bridge**.
2. If Tor Browser is already running: menu (**≡**) → **Settings** → **Connection**, then in **Bridges** choose **Select a Built-In Bridge**, pick a type and click **OK**. Tor Project suggests trying obfs4, WebTunnel, Snowflake and meek in turn.
3. If none of them works, request a bridge: in **Bridges**, choose **Find more bridges** → **Request bridges** and solve the CAPTCHA. You can also get bridges from **@GetBridgesBot** on Telegram, or at bridges.torproject.org.

### Android {.android}

1. If connecting fails, tap **Try a bridge**.
2. To add a bridge you were given: **Settings** → **Connection** → **Config Bridge**, turn on **Use a Bridge**, choose **Provide a Bridge I know** and paste it.

Sources disagree on how well bridges hide that you use Tor. [Tails' Tor documentation](https://tails.net/doc/anonymous_internet/tor/index.en.html) says they hide it; [Tor Project's best practices](https://support.torproject.org/tor-browser/security/using-tb-safely/) say they reduce the risk; [Privacy Guides' Tor overview](https://www.privacyguides.org/en/advanced/tor-overview/) says the common types can be detected, and that a bridge whose address later becomes public can show you used Tor in the past. Assume someone watching your connection may still notice.

## Know the limits on phones {#phones .recommended}

Phones are harder to keep anonymous. The mobile network sees your SIM card and your phone together, and apps on the phone can identify you.

### iPhone {.ios}

1. There is no Tor Browser for iPhone. Tor Project recommends Onion Browser, but says Apple's rules prevent it from having the same protections as Tor Browser.
2. In August 2026 [researchers disclosed flaws in Apple's WebKit](https://mysk.blog/2026/08/04/webkit-proxy-icloud-private-relay-ip-leak/) that can expose your real IP address in iPhone browsers that use a proxy, including Onion Browser. [Onion Browser 3.4.1](https://github.com/OnionBrowser/OnionBrowser/releases) fixed one of them and says its **Silver** and **Gold** security levels reduce the others. The researchers say VPNs, which carry all of the phone's traffic, aren't affected; EFF says Orbot works this way. As of November 2026, [EFF's guide to Tor on Android and iPhone](https://ssd.eff.org/module/how-to-use-tor-on-android-and-iphone) advises against Onion Browser for highly sensitive browsing until Apple fixes the issue.

### Android {.android}

1. Tor Browser for Android works like the computer version: see [Use Tor Browser safely](/guides/anonymity/#tor-browser).
2. Orbot, made by Guardian Project and published by Tor Project, can send other apps through Tor. Tor Project warns that on most Android phones apps can still go around such a connection through mobile data, and that an app linked to your Google account can identify you.

### All phones

1. An app signed in with your real name, or set up without Tor, knows who you are, whatever connection you use.
2. [EFF's page on the problem with mobile phones](https://ssd.eff.org/module/problem-mobile-phones) says moving a SIM card to another phone protects little, because the network sees both. As long as the phone is on, the network knows roughly where it is. EFF also notes that in some countries there may be legal or practical obstacles to getting phone service that isn't registered to your name.

If where you are matters more than what you read, a phone in your pocket can give you away: see [Decide which phone to take, if any](/guides/protest/#phone-or-not).

## Consider Tails for the highest risk {#tails .advanced}

Tails is a system you start from a USB stick instead of Windows or macOS. It sends everything through Tor and forgets everything when you shut it down.

1. You need a USB stick of at least 8 GB and a computer, not a phone or tablet. Follow the steps and the download check on tails.net/install, and install it from a computer you trust.
2. Tails can keep files in an encrypted **Persistent Storage** on the stick. Tails warns it is not hidden: anyone with the stick can see it exists, and you could be forced or tricked into giving its passphrase.
3. Restart Tails between different activities, so that sites can't link them.

Tails can't protect you on a computer with a hardware keylogger or tampered firmware, Tails says. Your internet provider can see that you connect to Tor unless you choose to hide it and use a bridge, and when Tails connects automatically it can show that you use Tails.

## Check what sites see {#browser-check .advanced}

1. In Tor Browser, open check.torproject.org. It tells you whether your connection goes through Tor.
2. Open our [What your browser reveals](/tools/browser-check/) tool in Tor Browser and in your usual browser, and compare. It needs JavaScript, so it won't run at **Safest**; don't lower your level just for it. Tor Browser tries to make all its users look the same: Tor Project says, for example, that every Windows computer appears as Windows 10.
3. To see which relays a tab uses, open the site information menu in the address bar.

A check shows what one page can see at that moment. It can't show what you have revealed through accounts, files or habits.
