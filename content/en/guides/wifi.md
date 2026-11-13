---
title: Secure your Wi-Fi and understand VPNs
description: Secure your home router and Wi-Fi, use public Wi-Fi sensibly, and learn what a VPN hides and what it doesn't, so you can decide whether you need one.
summary: Lock down your home router, use café Wi-Fi without worry, and know what a VPN can and can't do.
audience: everyone
group: devices
icon: wifi
order: 11
time: 40
reviewed: 2026-11-11
status: published
---

Your router connects every device in your home to the internet. Whoever controls it can change its settings or use your connection. This guide secures it, then explains public Wi-Fi and VPNs. The two **Essential** items take about twenty minutes and need your router's settings page or app. If your internet provider gave you the router and you can't find how to change a setting, ask the provider.

## Change the router's admin password {#router-password .essential}

A router has two passwords: one to join the Wi-Fi, and one for the router's own settings. Many routers come with a default settings password that is printed on a label or easy to find online. Anyone who gets into the settings can change everything, including your Wi-Fi password.

### Router

1. Open the router's settings page or app. The address and the default login are often on a label on the router or in its manual.
2. Change the admin username, if you can, and the password to a long, unique one. Save it in your password manager.
3. Turn off **remote management** (it may be called remote administration). It lets the settings be changed over the internet.
4. Sign out of the settings page when you are done.

## Use WPA3 or WPA2 and a strong Wi-Fi password {#wifi-encryption .essential}

The Wi-Fi encryption setting decides whether people nearby can join your network or read what passes over it. Older settings are easy to break.

### Router

1. In the router's wireless or Wi-Fi security settings, choose **WPA3 Personal**. If some of your devices can't connect, choose **WPA2/WPA3 Transitional**, or **WPA2 Personal** with **AES**.
2. Don't use **WEP**, **WPA**, mixed **WPA/WPA2**, any setting with **TKIP** in its name, or an open network without a password.
3. Set a long Wi-Fi password that you don't use anywhere else.
4. Turn off **WPS**, the push-button or PIN way to join. Its PIN can be guessed quickly, and some routers don't stop repeated tries.

> [!note]
> Hiding the network name doesn't protect it. Apple warns that a hidden network can even make your devices easier to identify. If your router offers only WEP or WPA, update its software; if that doesn't help, replace the router.

## Keep the router updated {#router-updates .recommended}

Routers have security holes like any other device, and attackers take over old routers that no longer get fixes. The FBI warned in 2025 that criminals use such routers to hide their own activity. Signs of a taken-over router include overheating, dropped connections and settings you didn't change.

### Router

1. In the router's settings, turn on automatic updates if it offers them. Otherwise, check the maker's website for new software now and then.
2. If your provider gave you the router, ask whether it updates the router for you.
3. If the maker no longer releases updates for your router, replace it. The FBI says routers from 2010 or earlier are likely to get none.
4. Turn off **UPnP** unless something you use needs it.

## Give guests and smart devices their own network {#guest-network .recommended}

Many routers can run a separate guest network with its own name and password. Fewer people then know your main password, and harmful software on a visitor's phone usually can't reach your computers. Cameras and other smart devices are also safer on a network of their own.

### Router

1. In the router's settings, turn on the guest network and give it its own name and password.
2. Keep encryption on for it, as for the main network: an open guest network is a risk too. Check that any setting letting guests reach your local network is off.
3. Some smart devices only work with your phone's app when both are on the same network.
4. Give visitors the guest password, not your main one.

## Use public Wi-Fi sensibly {#public-wifi .recommended}

Public Wi-Fi in cafés and hotels is far safer than it used to be, because most sites and apps now encrypt what you send. Others on the network can still see which sites you visit, but not what you read or type there. The bigger risk is a fake site, which can be encrypted too.

### All devices

1. Keep your phone and computer updated: a device with known security holes is more at risk on a shared network.
2. Before you type a password, check the site's address: see [Check where a link really goes](/guides/phishing/#check-link).
3. On iPhone, if a network you never chose to join shows a privacy warning under its name, tap the More Info button and turn off **Auto-Join**. If the warning says the private address is off, turn **Private Wi-Fi Address** back on.
4. On Windows, choose **Public network** when you join a café or hotel Wi-Fi: see [Keep the firewall on](/guides/computer/#firewall).

## Know what a VPN does and doesn't do {#vpn-what-it-does .recommended}

A VPN sends all your traffic through an encrypted tunnel to the VPN company's server. Your internet provider and the local Wi-Fi owner then can't see which sites you visit, and the sites see the VPN's address instead of yours.

It doesn't make you anonymous. The VPN company sees everything your internet provider used to see, and may keep it or hand it over when the law requires. Sites still recognise you by your logins, cookies and other tracking. It adds no protection between the VPN server and the site, so you still need HTTPS. Logging in to your bank through a VPN may set off its fraud checks.

![A VPN moves your trust from your internet provider to the VPN company. Tor splits it between three relays.](figure:who-sees-what)

Experts disagree on whether you need one. The EFF says a VPN isn't the most important security step for most people, now that most traffic is encrypted. Privacy Guides says most people should use one, mainly to hide their browsing from their internet provider. For anonymity, both point to Tor rather than a VPN.

### All devices

1. Do the steps in [the accounts guide](/guides/accounts/) and [the phone guide](/guides/phone/) first: they protect you more than a VPN does.
2. Use a VPN when you don't trust the network or its owner, or don't want your internet provider to see which sites you visit.

## Choose a VPN carefully {#choosing-vpn .advanced}

A VPN company can see everything you do online, so choosing one means choosing whom to trust. Being in an official app store doesn't make a VPN safe, and "no logs" is a promise you can't check. Free VPNs have to make money somehow; some sell your data.

### All devices

1. Prefer a company that names its owners, publishes independent security audits, and doesn't ask for more than an email address to sign up.
2. Look for current protocols such as WireGuard and a kill switch, which blocks traffic if the VPN drops.
3. Be wary of VPN review sites: many are advertising.
4. Privacy Guides currently recommends three providers that meet its criteria: Mullvad, Proton VPN and IVPN. Proton VPN has a limited free plan.

## Use a DNS service that blocks harmful sites {#dns .advanced}

Before your device opens a site, it asks a DNS service for the site's address. Usually that is your internet provider's service. A public DNS service such as Quad9 refuses to look up addresses known for malware or phishing, so those sites don't open.

It hides less than people think. Privacy Guides says encrypted DNS won't hide your browsing: your internet provider can still see which sites you connect to. It sees a third-party DNS service as worth it mainly for basic filtering or to get around simple DNS blocking. A VPN usually ignores these settings and uses its own DNS. Privacy Guides lists Quad9, Cloudflare, Control D and AdGuard Public DNS. The steps below use Quad9, the one on that list that blocks malware by default. It is a Swiss foundation and says it doesn't record your IP address.

### Android {.android}

1. Open **Settings → Network & internet → Private DNS**. If you can't find it, search the settings for **Private DNS**.
2. Choose **Private DNS provider hostname**, enter `dns.quad9.net` and tap **Save**.
3. To undo it, or if a network stops working, choose **Automatic** again.

### iPhone {.ios}

1. iPhone needs a profile from the DNS service. Quad9 says to download its profile in Safari from its own setup guide at docs.quad9.net, then install it. Choose the profile marked **Recommended**: some of the others don't block harmful sites. Download profiles only from the DNS service's own site.
2. Profiles expire on the date shown on Quad9's page, currently 19 January 2027. Install a new one before then.
3. Quad9 says the profile isn't used while iCloud Private Relay or a VPN is on.

### Windows 11

1. Open **Settings → Network & internet**, select **Wi-Fi** or **Ethernet**, and next to **DNS server assignment** select **Edit**. If you don't see it, search the settings for **DNS**.
2. Choose **Manual** and turn on **IPv4**. Enter `9.9.9.9` as **Preferred DNS** and `149.112.112.112` as **Alternate DNS**, set **DNS over HTTPS** to **On (automatic template)** for both, and select **Save**.
3. If your connection uses IPv6, turn on **IPv6** as well and enter `2620:fe::fe` and `2620:fe::9` the same way. Quad9 warns that if your computer has no IPv6 address, this can stop DNS from working.
4. Quad9 says some networks block encrypted DNS. On a laptop you take to other networks, you can turn on **Fallback to plaintext**.

### Router

1. To cover every device at home, Quad9 suggests setting it in the router: enter `9.9.9.9` and `149.112.112.112` as the DNS servers. If your provider's router has no such setting, ask the provider.

## Stop joining networks automatically {#auto-join .advanced}

Your devices remember every network you have joined and reconnect to it by themselves whenever they see it again. Forget networks you no longer use, so your devices don't connect without you choosing to. Keep the private address setting on: it gives each network a different device address, so you are harder to follow from place to place.

### iPhone {.ios}

1. Open **Settings → Wi-Fi**, tap **Edit**, then the More Info button next to a network.
2. Tap **Forget This Network**, or turn off **Auto-Join** to keep the password but connect only when you choose. If your Apple devices share iCloud Keychain, forgetting a network on one forgets it on all of them.
3. On the same screen, keep **Private Wi-Fi Address** on (on iOS 18 and later, **Fixed** or **Rotating**).

### Android {.android}

1. Open **Settings → Network & internet → Internet**, touch and hold a saved network and tap **Forget**. On a Samsung, open **Settings → Connections → Wi-Fi**, tap the three dots, and look for **Manage saved Wi-Fi networks** (under **Advanced settings** on newer models) or **Manage networks** on older ones.
2. On Android 10 and later, Android uses a random device address for each network by default. You can see it in the network's settings under **Randomized MAC address**.

### Windows

1. Open **Settings → Network & internet → Wi-Fi → Manage known networks**, select a network and click **Forget**.
2. On the **Wi-Fi** page, turn on **Random hardware addresses** if your computer offers it.

### Mac

1. Choose **Apple menu → System Settings → Wi-Fi**, scroll down and click **Advanced**.
2. Next to a network you no longer use, click the More Options button and choose **Remove From List**, or turn off **Auto-Join**.
3. Keep **Private Wi-Fi Address** on in the network's details.
