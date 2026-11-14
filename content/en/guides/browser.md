---
title: Make your web browser more private
description: 'Settings for Chrome, Safari, Firefox and Edge: updates, extensions, blocking trackers and third-party cookies, private windows and search.'
summary: Your browser sees nearly everything you do online. A few settings cut down who else does.
audience: everyone
group: habits
icon: globe
order: 6
time: 30
reviewed: 2026-11-14
status: published
---

Your browser is where you log in, pay and read. It also lets advertisers and other companies follow you from site to site. This guide covers Chrome, Safari, Firefox and Edge on phones and computers, with notes on Brave. The two **Essential** items close the biggest security gaps; the rest reduce tracking. No setting makes you anonymous: sites can usually still see your IP address, and your internet provider which sites you visit.

## Keep your browser updated {#updates .essential}

Your browser opens content from every site you visit, and updates fix the security holes attackers use. Browsers usually update themselves, but an update may only take effect after you restart the browser.

### Chrome

1. On a computer, select the three dots at the top right, then **Help → About Google Chrome**.
2. If you see **Relaunch**, select it. Your tabs reopen; Incognito windows don't. If there is no **Relaunch** button, you have the latest version.
3. On Android, Chrome updates through Google Play. To update by hand, open the Play Store, tap your profile icon, then **Manage apps & device**, and tap **Update** next to Chrome.

### Safari

1. Safari is updated together with your iPhone or Mac. Keep the system up to date: see [Install updates automatically](/guides/phone/#updates).
2. On a Mac, Safari extensions from the Mac App Store update automatically when automatic updates are turned on in the App Store settings.

## Keep extensions few and trusted {#extensions .essential}

Extensions can read and change the pages you visit, including your email and online banking. A harmful or abandoned extension can steal what you type. Each extra extension also makes your browser easier to recognise. Install only what you need, only from the browser's own store, and remove the rest.

### Chrome

1. Select the three dots, then **Extensions → Manage extensions**.
2. Remove anything you don't use or don't recognise: select **Remove**, then **Remove** again. Some programs add a Chrome extension when you install them.
3. For the extensions you keep, select **Details** and limit site access to specific sites where you can.

### Safari

1. On a Mac, choose **Safari → Settings**, then click **Extensions**. Select one you don't need and click **Uninstall**.
2. On iPhone, extensions come as apps: delete the app to remove the extension. Check them in **Settings → Apps → Safari → Extensions**.

> [!warning]
> Only add extensions from the Chrome Web Store, the App Store, or your browser's own add-on site. Never install one because a website, message or caller tells you to.

## Block trackers {#content-blocker .recommended}

A content blocker stops many of the hidden trackers and ads that follow you from site to site, and pages often load faster. Blocking can break a site now and then; if a page doesn't work, turn the blocker off for that site only.

### Chrome

1. In the Chrome Web Store, install **uBlock Origin Lite**, published by Raymond Hill.
2. The full **uBlock Origin** no longer works in Chrome, which has dropped support for its type of extension. It still works in Firefox.

### Safari

1. On iPhone, open Safari, tap the page menu, then **Manage Extensions**, and add a content blocker from the App Store, such as **AdGuard** or **uBlock Origin Lite**.
2. Turn it on in **Settings → Apps → Safari → Extensions**: tap the extension and turn on **Allow Extension**.

### Firefox

1. Click the shield icon to the left of the address bar, then **Protection Settings**.
2. Choose **Strict**. It blocks more trackers and cookies; a few sites may need an exception.
3. You can also add **uBlock Origin** from Firefox's add-ons site.

### Edge

1. Select **Settings and more → Settings → Privacy, search, and services → Tracking prevention**.
2. Check that it is on and set to **Balanced** or **Strict**. **Strict** can stop some videos from playing or some sign-ins from working.

### Brave

1. Brave says its **Shields**, which block trackers and ads, are on for every site by default, with no extra setup.
2. For stronger blocking on a computer, open the **Main Menu**, click **Settings**, go to the **Shields** section and choose **Aggressive** under **Trackers & ads blocking**, as Privacy Guides suggests.
3. If a site breaks, turn **Shields** off for that site only, from the Brave icon in the address bar.

> [!note]
> Leave your browser's warnings about dangerous sites on: **Safe Browsing** in Chrome, **Fraudulent Website Warning** in Safari. Some privacy guides suggest turning them off, because the browser then checks addresses with a company. For most people, fake sites are the bigger risk.

## Block third-party cookies {#cookies .recommended}

Third-party cookies let a company whose code sits on many sites recognise you on all of them. Blocking them reduces this tracking. A few sites, often for logins or payments, may need an exception.

![When one company's code sits on many sites, it can recognise you on all of them.](figure:third-party-tracker)

### Chrome

1. On a computer, select the three dots, then **Settings → Privacy and security → Third-party cookies**, and choose **Block third-party cookies**.
2. On Android, tap the three dots, then **Settings → Site settings → Third-party cookies** (on some versions it is under **Privacy and security**), and choose **Block third-party cookies**.

### Safari

1. On iPhone, open **Settings → Apps → Safari** and check that **Prevent Cross-Site Tracking** is on. It is on by default.
2. On a Mac, choose **Safari → Settings → Privacy** and check that **Prevent cross-site tracking** is selected.

### Firefox

1. **Strict** tracking protection (see the previous item) also blocks cross-site tracking cookies.

## Choose a browser that protects you by default {#choose-browser .recommended}

You don't have to switch browsers: the settings in this guide help in any of them. If you want one that blocks more tracking without extra work, Privacy Guides recommends Mullvad Browser, Firefox or Brave on computers, and Safari or Brave on phones. Chrome and Edge are not on its list. No ordinary browser makes you anonymous; only Tor Browser is built for that.

Brave is the one on both lists, and Brave says it blocks trackers from the start, without extensions. It is built on Chromium, like Chrome, so Privacy Guides expects few problems with sites.

### All devices

1. Download a browser only from its own site or your device's app store.
2. If you switch, move your saved passwords to your password manager or the new browser first. An exported password file is not protected: anyone who opens it sees all your passwords. Delete it as soon as the import is done, and empty the Trash.

### Brave

1. Brave also offers extras, such as **Brave Rewards**, which pays you in a cryptocurrency, and a crypto wallet. Privacy Guides advises against Rewards and the wallet, and suggests turning off built-in features you don't use.
2. To block trackers more strictly, see [Block trackers](/guides/browser/#content-blocker).

## Know what a private window doesn't hide {#private-window-limits .recommended}

An Incognito or Private window doesn't save your history, cookies or form entries on your device after you close it. That is all it does. The sites you visit, your employer or school network and your internet provider can still see your activity. Downloads and bookmarks stay on the device.

### Chrome

1. Select the three dots, then **New Incognito window**.
2. Close all Incognito windows to end the session. Third-party cookies are blocked in Incognito by default.

### Safari

1. On iPhone, tap the Tabs button and swipe right on the tab bar until **Private Browsing** opens.
2. To lock private tabs, open **Settings → Apps → Safari** and turn on **Require Face ID to Unlock Private Browsing** (or the passcode or Touch ID option).
3. On a Mac, choose **File → New Private Window**. Downloads stay on the Mac; delete them yourself if needed.

## Check your saved passwords {#saved-passwords .recommended}

If you save passwords in Chrome, it can warn you when one has leaked or is used on several sites. A separate password manager or your phone's built-in one does the same: see [Use a password manager](/guides/accounts/#password-manager).

### Chrome

1. On a computer, select the three dots, then **Settings → Privacy and security**, and under **Safety Check** select **Go to Safety Check**. On Android, tap the three dots, then **Settings → Safety check**.
2. Fix what it reports, starting with compromised passwords. It also checks for updates and harmful extensions.
3. For details on each password, select the three dots, then **Passwords and autofill → Google Password Manager → Checkup**.

## Change your search engine {#search-engine .advanced}

Your search engine sees everything you search for. Search suggestions send what you type to it even before you press Enter. You can choose another engine or turn suggestions off.

Some search engines say they don't keep your searches. Privacy Guides recommends three: **Brave Search**, which has its own index; **DuckDuckGo**, which takes most results from Bing; and **Startpage**, which shows results from Google and Bing and, it says, sends your search to them without saying who asked. Each says it doesn't store your searches linked to you or your IP address. Privacy Guides notes that nobody can guarantee a privacy policy is kept, and that these engines still see your IP address unless you use a VPN or Tor. If one doesn't find what you need, you can still search elsewhere for that one question.

### Chrome

1. On a computer, select the three dots, then **Settings → Search engine**, and select **Change** to choose another one.
2. If your search engine changes without you doing it, check your extensions: it can be a sign of harmful software.

### Safari

1. On iPhone, open **Settings**, search for **Search Engine** and choose one, for example **DuckDuckGo**. Depending on the iOS version, it is under **Search** or under **Apps → Safari**.
2. In the same place, you can turn off **Search Engine Suggestions**.

### Brave

1. Brave Search is Brave's default search engine. Privacy Guides suggests turning off its **Anonymous usage metrics**, which are on by default. On the Brave Search page, click the gear icon at the top right, then **All settings**, and turn it off.

## See what your browser reveals {#browser-check .advanced}

Even without cookies, a site can recognise your browser from many small details, such as your screen size, fonts and time zone. This is called a fingerprint. Trying to change single details yourself can make you stand out more, not less.

### All devices

1. Open our tool [What your browser reveals](/tools/browser-check/) to see what any site can read without asking.
2. Keep the browser updated and remove extensions you don't need. For stronger protection, use a browser with fingerprinting protection, such as Firefox with **Strict** protection, Brave, or Tor Browser.
