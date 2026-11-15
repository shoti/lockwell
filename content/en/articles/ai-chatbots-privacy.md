---
title: What happens to what you tell an AI chatbot
description: An AI chatbot keeps what you type. People may read it, it may train the model or pick ads, and a court can demand it. What the companies say, and what has gone wrong.
summary: A chatbot feels like a private conversation. It is a company's service, and what you type is kept, read, reused and sometimes exposed. Here is what the companies themselves say.
icon: robot
published: 2026-11-14
status: published
---

In July 2025, people searching Google started to find other people's conversations with ChatGPT among the results. Nobody had broken in. ChatGPT's share button had an option that made a shared chat discoverable by search engines, and some people had turned it on without realising what it meant. OpenAI removed the option on 31 July and said it had "introduced too many opportunities for folks to accidentally share things they didn't intend to".

The episode showed how people use these tools. They ask a chatbot things they would not ask a search engine, and sometimes things they would not tell a friend. In [a study of ChatGPT's consumer product](https://www.nber.org/papers/w34255) that OpenAI's researchers published with the US National Bureau of Economic Research in September 2025, messages that had nothing to do with work grew from 53% to more than 70% of all use by July 2025.

A chatbot answers like a person, so it is easy to treat it like one. But it is a service run by a company, and what you type is sent to that company's computers. This article describes what happens to it there, using the companies' own documents, and what has already gone wrong.

## It is not a private conversation {#not-private}

When you send a message to a chatbot, it travels to the company's servers, where the model produces the answer. The conversation is then saved to your account. OpenAI's help pages say that chats "remain saved to your account until you delete them". The other large services also keep chats by default. As of November 2026, [Google's Gemini privacy hub](https://support.google.com/gemini/answer/13594961?hl=en) says Gemini deletes your activity after 18 months by default, unless you change the setting.

From there, four things can happen to it.

![What you type does not stay between you and the chatbot.](figure:ai-prompt-journey)

### People may read it

Google says so plainly in its privacy notice for Gemini: "A subset of chats are reviewed by human reviewers (including Google's trained service providers) to help improve Google services." The same page adds: "Please don't enter confidential information that you wouldn't want a reviewer to see or Google to use to improve our services, including machine-learning technologies."

OpenAI says that authorised staff and outside contractors may access conversations to investigate abuse, give support, handle legal matters and improve the models. Its advice: "Please do not enter sensitive information that you would not want reviewed or used." xAI, the company behind Grok (its own pages now call it SpaceXSI), describes similar access. Anthropic says staff can see chats that you have allowed it to use for training, and chats flagged for breaking its rules.

The companies publish no figures on how many conversations people read. You have no way of knowing whether yours is among them.

### It may be used to train the model

The companies improve their models with the conversations people have with them. The rules differ:

- **ChatGPT**: on free and paid personal accounts, this is on by default. You can turn off **Improve the model for everyone**.
- **Claude**: Anthropic asks each user to choose. If you allow it, [Anthropic says](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data) your chats can be kept, de-identified, for training for up to five years (as of November 2026).
- **Gemini**: Google uses chats to improve its services, with the help of human reviewers, unless you turn off **Keep Activity**.
- **Grok**: X says it may share your interactions with Grok to train the model, unless you switch this off in the settings.
- **Meta AI**: [Meta's AI terms](https://www.facebook.com/policies/other-policies/ais-terms) say it uses your interactions with its AI to improve it. As of November 2026, we found no setting that turns this off in those terms, in Meta's Privacy Center page on generative AI or in the Meta AI app's help page on managing your information.

One detail is easy to miss. OpenAI, Google and xAI each say that feedback you send on an answer, for example with the thumbs-up or thumbs-down button, may be used for training or reviewed even if you have turned training off. OpenAI says this covers the whole conversation; Google says it can include your chats from the last 24 hours. Anthropic says it keeps the whole conversation behind a thumbs rating for five years and may use it to train its models.

Why does training matter? Because a model can repeat what it was trained on. In 2023, a group of researchers asked ChatGPT to repeat one word forever. After a while the model stopped repeating and began to print pieces of text it had been trained on. For about two hundred dollars they extracted several megabytes of it. The text they recovered came from the public web, and the authors said the trick itself was easy to block. But the experiment showed that what goes into a model during training can come out again, word for word.

### It may be used to choose ads

This is new. OpenAI began testing advertisements in ChatGPT in the United States in February 2026, on its Free and Go plans, and has since extended them to dozens of other countries. The ads are chosen from the conversation you are having and, if ad personalisation is on, from your past chats and memory. If you turn ad personalisation off, OpenAI says, you "will still see ads based on the context of your current chat thread". It also says that advertisers don't get access to your chats, and that ads don't appear near sensitive topics such as health or politics.

Meta announced in October 2025 that, from 16 December 2025, it would use people's interactions with its AI to personalise content and ads in most regions. Microsoft's Copilot shows ads based on the current conversation, and its personalised ads may also use your chat history. Google says Gemini chats are not used to show ads. Anthropic says Claude remains ad-free.

### A court can demand it

What you tell a doctor or a lawyer is protected by law in many countries. What you tell a chatbot may not be. OpenAI's chief executive, Sam Altman, said it himself in July 2025: for a therapist, a lawyer or a doctor "there's legal privilege", and "we haven't figured that out yet for when you talk to ChatGPT".

One US court has already said so. In February 2026, in [United States v. Heppner](https://storage.courtlistener.com/recap/gov.uscourts.nysd.652138/gov.uscourts.nysd.652138.27.0.pdf), Judge Jed Rakoff of the federal court in Manhattan ruled that a defendant's written exchanges with the chatbot Claude were not protected by attorney-client privilege or the work-product doctrine. Other US courts have since protected some AI chats that were prepared for a lawsuit, so the law is not settled.

A court can also reach chats that you thought were gone. In a copyright case brought by The New York Times, a court ordered OpenAI in May 2025 to preserve conversations it would otherwise have deleted, including ones that users had deleted themselves. OpenAI says its obligations under that order ended on 26 September 2025. In October 2025 it said it would keep storing a limited set of chats from April to September 2025, because The New York Times still demanded them; as of November 2026, [OpenAI's page](https://openai.com/index/response-to-nyt-data-demands/) shows no later update. In January 2026, a judge confirmed that OpenAI must hand 20 million chat logs, stripped of identifying details, to the other side.

## What the settings do, and what they don't {#settings}

Every large chatbot has privacy settings, and they are worth using. But their names promise more than they deliver.

![Each setting closes one door. None of them means that nothing is kept.](figure:ai-settings-limits)

- **Turning training off** stops your chats from being used to improve the model. They are still stored in your account, and staff may still access them for safety and legal reasons.
- **A temporary chat** doesn't appear in your history and isn't used for training. It is not gone when you close it. OpenAI may keep a copy for up to 30 days. Google keeps temporary Gemini chats for 72 hours, and says it may still review them with human reviewers to protect its services.
- **Deleting a chat** removes it from your account. OpenAI says deletion from its systems can take up to 30 days, and that it may keep a chat longer for legal or security reasons. At Google, chats that a reviewer has already seen are kept for up to three years, separately from your account, and deleting your activity doesn't remove them.

## Things go wrong {#incidents}

Stored conversations can also leak, like any other data a company holds.

- **March 2023.** A software bug in ChatGPT let some users see the titles of other users' conversations.
- **January 2025.** Researchers at the security company Wiz found a database belonging to the Chinese chatbot DeepSeek open to the whole internet, with no password. It held more than a million lines of logs, including chat history.
- **Summer 2025.** Shared conversations with ChatGPT turned up in Google's results, as described above. In August, Forbes reported the same for hundreds of thousands of conversations with Grok. In June, the technology site TechCrunch had found people posting what looked like private questions to a public feed in the Meta AI app, apparently without realising it.
- **February 2026.** A researcher reported that an app called Chat & Ask AI, which resells access to well-known chatbots, had left its database exposed, with what he said were 300 million messages from 25 million users.

The last case is a reminder that many "AI apps" are a layer on top of someone else's chatbot. Your words then pass through two companies, not one.

## It can work out what you didn't say {#inference}

There is a quieter risk. A language model is very good at reading between the lines.

In a [study presented at the ICLR 2024 conference](https://arxiv.org/abs/2310.07298), researchers gave nine language models the public posts of 520 Reddit users and asked them to guess facts about the authors: where they live, how much they earn, their sex. The best model, GPT-4, got its first guess right in about 85% of cases, at a fraction of the cost and time a person would need. These were models from 2023.

So leaving out your name doesn't make a conversation anonymous. A description of your street, your job and your family can be enough to point to you.

## When the assistant can act for you {#agents}

The newest assistants do more than talk. They read your email, open web pages, fill in forms and use your accounts. That adds a risk that settings can't remove.

A language model receives everything as text: your request, and also the web page, email or document it reads on your behalf. It has no reliable way to tell the two apart. If the page contains a sentence written as an instruction, the model may follow it. This is called **prompt injection**.

![An assistant can't reliably tell your instructions from text it reads along the way.](figure:prompt-injection)

In August 2025, researchers at the browser company Brave showed it with Comet, an AI browser made by Perplexity. They hid instructions in a comment on Reddit. When a user asked the browser to summarise that page, the assistant followed the hidden text instead: it fetched the user's email address and a one-time login code and posted them where the attacker could read them. In June 2025, Microsoft disclosed a critical flaw in Microsoft 365 Copilot, its assistant for workplaces: a single crafted email could make the assistant leak data, with no click from the user at all. Microsoft fixed it. In January 2026, researchers showed that a calendar invitation could make Google's Gemini write a summary of a user's private meetings where the sender could see it. Google fixed it.

Most cases so far are demonstrations by researchers, not attacks on ordinary people. But nobody claims the problem is solved. The UK's National Cyber Security Centre wrote in December 2025 that it is "very possible that prompt injection attacks may never be totally mitigated". OpenAI says of its own AI browser that prompt injection "is unlikely to ever be fully 'solved'".

The practical conclusion: the more an assistant is allowed to touch, the more a single poisoned page or email can reach.

## Services that promise more {#private-options}

Some companies now build AI services designed so that even the company can't read what you send. Apple says this of its Private Cloud Compute, and WhatsApp of a system it calls Private Processing. The mail provider Proton says its assistant Lumo stores chat history so that Proton can't read it.

These are promises about engineering, and they should be read as such. One of them has been tested in public. In April 2026, the security firm Trail of Bits wrote about its 2025 audit of WhatsApp's system: it found 28 problems, eight of them rated high severity because an attacker could have used them to get round the privacy guarantees. [According to the audit report](https://github.com/trailofbits/publications/blob/master/reviews/2025-08-meta-whatsapp-privateprocessing-securityreview.pdf), Meta fully fixed six of the eight and partly fixed the other two, and chose to leave eight low-severity or informational ones unfixed. That is how such claims become trustworthy, and it is also a measure of how hard they are to get right.

The [AI chatbots guide](/guides/ai-chatbots/#private-options) lists the options, including models that run entirely on your own computer and send nothing anywhere.

## What to do {#what-to-do}

1. Before you type, ask one question: would I be comfortable if a stranger at the company read this? If not, [leave it out](/guides/ai-chatbots/#never-paste). That goes for passwords, identity documents, health details and other people's secrets.
2. [Turn off training on your chats](/guides/ai-chatbots/#training-setting) where the service lets you, and don't rate answers in chats you want kept out of training.
3. Use [temporary chats](/guides/ai-chatbots/#temporary-chat) for one-off questions, and [delete old conversations](/guides/ai-chatbots/#history-and-memory).
4. [Check which chats you have shared](/guides/ai-chatbots/#account-security), and protect the account itself. Your chat history is now worth stealing.
5. Give an assistant access to your email, files or accounts only when you need it, and take it away afterwards.
6. Don't treat a chatbot as a doctor, a lawyer or a therapist when it comes to confidentiality. The law may not.

## Sources {#sources}

All sources were read on 14 November 2026. Those for retention, training, feedback, ads, the court cases, the Grok report, the inference study and the audit were read again on 15 November 2026.

- TechCrunch: [public ChatGPT chats indexed by search engines, July 2025](https://techcrunch.com/2025/07/31/your-public-chatgpt-queries-are-getting-indexed-by-google-and-other-search-engines/), [Forbes' report on Grok chats searchable on Google, August 2025](https://techcrunch.com/2025/08/20/thousands-of-grok-chats-are-now-searchable-on-google/) and [the Meta AI app, June 2025](https://techcrunch.com/2025/06/12/the-meta-ai-app-is-a-privacy-disaster/)
- OpenAI and NBER: [How people use ChatGPT, September 2025](https://www.nber.org/papers/w34255)
- OpenAI: [chat and file retention](https://help.openai.com/en/articles/8983778), [data controls in ChatGPT](https://help.openai.com/en/articles/7730893-data-controls-faq), [how OpenAI handles data in consumer services](https://help.openai.com/en/articles/7039943-data-usage-for-consumer-services-faq), [temporary chat in ChatGPT](https://help.openai.com/en/articles/8914046-temporary-chat-faq), [ads in ChatGPT](https://help.openai.com/en/articles/20001047), [expanding ChatGPT ads, August 2026](https://openai.com/index/expanding-access-to-ai-with-chatgpt-ads/), [the March 2023 outage](https://openai.com/index/march-20-chatgpt-outage/), [response to the New York Times data demands](https://openai.com/index/response-to-nyt-data-demands/) and [hardening Atlas against prompt injection, December 2025](https://openai.com/index/hardening-atlas-against-prompt-injection/)
- Google: [Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961?hl=en)
- Anthropic: [updates to consumer terms, August 2025](https://www.anthropic.com/news/updates-to-our-consumer-terms), [how long data is stored](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data), [is my data used for model training](https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training), [who can view conversations](https://support.claude.com/en/articles/8325621-i-would-like-to-input-sensitive-data-into-my-chats-with-claude-who-can-view-my-conversations) and [updates to the privacy policy](https://privacy.claude.com/en/articles/10301952-updates-to-our-privacy-policy)
- X: [About Grok](https://help.x.com/en/using-x/about-grok); xAI, whose pages now use the name SpaceXSI (SpaceX Super Intelligence): [consumer FAQ](https://x.ai/legal/faq)
- Meta: [AI terms](https://www.facebook.com/policies/other-policies/ais-terms), [Privacy Center: generative AI](https://www.facebook.com/privacy/genai/), [Meta AI help: manage your information](https://www.meta.com/help/artificial-intelligence/1771195753735844/) and [using AI interactions for content and ads, announced October 2025](https://about.fb.com/news/2025/10/improving-your-recommendations-apps-ai-meta/)
- Microsoft: [Copilot privacy controls](https://support.microsoft.com/en-us/privacy/microsoft-copilot/privacy-controls)
- Nasr and others: [Extracting training data from ChatGPT, November 2023](https://not-just-memorization.github.io/extracting-training-data-from-chatgpt.html)
- TechCrunch: [Sam Altman on legal confidentiality, July 2025](https://techcrunch.com/2025/07/25/sam-altman-warns-theres-no-legal-confidentiality-when-using-chatgpt-as-a-therapist/); US District Court for the Southern District of New York: [memorandum in United States v. Heppner, 17 February 2026](https://storage.courtlistener.com/recap/gov.uscourts.nysd.652138/gov.uscourts.nysd.652138.27.0.pdf); Orrick: [United States v. Heppner, March 2026](https://www.orrick.com/en/Insights/2026/03/Court-Rules-AI-Conversations-Are-Not-Privileged-What-United-States-v-Heppner-Means-for-You)
- Duane Morris: [the preservation order of 13 May 2025](https://blogs.duanemorris.com/classactiondefense/2025/10/27/new-york-federal-courts-openai-discovery-orders-provide-key-insights-for-companies-navigating-ai-preservation-standards/); Foley: [US courts on AI chats in lawsuits, June 2026](https://www.foley.com/insights/publications/2026/06/texas-business-court-weighs-in-on-discoverability-of-ai-prompts/)
- ABA Journal: [OpenAI must turn over 20 million chat logs, January 2026](https://www.abajournal.com/news/article/chatgpt-creator-must-turn-over-20m-chat-logs-in-copyright-litigation-federal-judge-says)
- Wiz: [exposed DeepSeek database, January 2025](https://www.wiz.io/blog/wiz-research-uncovers-exposed-deepseek-database-leak)
- Malwarebytes: [AI chat app leak, February 2026](https://www.malwarebytes.com/blog/news/2026/02/ai-chat-app-leak-exposes-300-million-messages)
- Staab and others: [Beyond memorization: violating privacy via inference with large language models, ICLR 2024](https://arxiv.org/abs/2310.07298)
- Brave: [indirect prompt injection in Perplexity Comet, August 2025](https://brave.com/blog/comet-prompt-injection/)
- US National Vulnerability Database: [CVE-2025-32711](https://nvd.nist.gov/vuln/detail/CVE-2025-32711); The Hacker News: [zero-click flaw in Microsoft 365 Copilot, June 2025](https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html)
- Miggo: [calendar invites and Google Gemini, January 2026](https://www.miggo.io/post/weaponizing-calendar-invites-a-semantic-attack-on-google-gemini)
- UK National Cyber Security Centre: [Prompt injection is not SQL injection, December 2025](https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection)
- Apple: [Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/); WhatsApp: [Private Processing](https://faq.whatsapp.com/2089630958184255); Proton: [Lumo privacy](https://proton.me/support/lumo-privacy)
- Trail of Bits: [auditing WhatsApp's private inference, April 2026](https://blog.trailofbits.com/2026/04/07/what-we-learned-about-tee-security-from-auditing-whatsapps-private-inference/) and [the audit report, August 2025](https://github.com/trailofbits/publications/blob/master/reviews/2025-08-meta-whatsapp-privateprocessing-securityreview.pdf)
