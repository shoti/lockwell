# The Lockwell encrypted-file format, version 1

Lockwell's file encryption tool (`/tools/file-encryption/`) locks a file, several files or a text with a password,
in the browser. This document describes the files it writes, so anyone can check the design or write their own
decryptor. The site's own implementation is [`src/client/lockbox.mjs`](../src/client/lockbox.mjs); a reference
decryptor for Node 22 that uses it is [`scripts/lockbox-open.mjs`](../scripts/lockbox-open.mjs):

```sh
node scripts/lockbox-open.mjs <file> [output]
```

It reads the password from the terminal without echo (or from the first line of standard input), never from an
argument. A locked file can therefore be opened without the site being online.

## Design in one paragraph

Only primitives that browsers provide through Web Crypto are used: PBKDF2-HMAC-SHA-256 ([RFC 8018], §5.2),
HKDF-SHA-256 ([RFC 5869]), HMAC-SHA-256 ([RFC 2104]) and AES-256-GCM ([NIST SP 800-38D]). Nothing is hand-written.
The payload copies the chunked layout of [age]: 64 KiB chunks, each with its own 16-byte tag, and a nonce made of a
chunk counter and a last-chunk flag. age describes this as "a STREAM variant from [Online Authenticated-Encryption
and its Nonce-Reuse Misuse-Resistance][STREAM]". The counter stops chunks from being reordered, repeated or dropped;
the flag stops a file from being cut off at a chunk boundary. AES-256-GCM takes the place of age's
ChaCha20-Poly1305, which Web Crypto does not yet offer in every browser. A MAC over the header lets a wrong password be
reported before any content is read, and authenticates the version and the key-derivation parameters.

## Layout

All integers are big-endian.

```
Header (62 bytes)
  offset  length  field
  0       8       magic        "LOCKWELL" (4C 4F 43 4B 57 45 4C 4C)
  8       1       version      1
  9       1       kdf          1 = PBKDF2-HMAC-SHA-256
  10      4       iterations   unsigned 32-bit
  14      16      salt         random, from a cryptographic random source
  30      32      header MAC   HMAC-SHA-256(macKey, bytes 0 to 29)
Payload
  chunks of AES-256-GCM output: up to 65,536 bytes of ciphertext, then a 16-byte tag
```

The file extension is `.lockwell`. The magic and the extension are a format name: they don't change if the site is
renamed.

## Keys

```
password bytes = UTF-8(NFC(password))          no trimming, no change of case
master   = PBKDF2-HMAC-SHA-256(password bytes, salt, iterations, 32 bytes)
macKey   = HKDF-SHA-256(ikm = master, salt = salt, info = "lockwell/v1/header",  32 bytes)
dataKey  = HKDF-SHA-256(ikm = master, salt = salt, info = "lockwell/v1/payload", 32 bytes)
```

`macKey` is the HMAC-SHA-256 key for the header MAC, `dataKey` the AES-256-GCM key for every chunk. The site writes
1,000,000 iterations. A reader accepts 100,000 to 10,000,000 and treats anything outside that range as a damaged
file (this also stops a file that would ask for an hour of work).

PBKDF2 is not memory-hard: a graphics card can try many passwords a second against a stolen file. The protection
comes from the password. The tool's default is six random words from EFF's long word list (about 77 bits).

## Payload

The plaintext is one stream, cut into chunks of exactly 65,536 bytes; the last chunk has 1 to 65,536 bytes. The
stream is:

1. the **metadata block**,
2. the **content**,
3. optional **padding** of zero bytes, so the file's size doesn't give away the content's exact size. A reader
   doesn't need to know how much there is: it checks that every byte after the content is zero.

The site adds padding only when the visitor chooses "Hide the exact size". It then rounds the length of metadata +
content up with Padmé ([PURBs], Algorithm 1): with E = ⌊log₂ L⌋ and S = ⌊log₂ E⌋ + 1, the lowest E − S bits of the
length are set to zero by rounding up. That adds at most 12%, less as files grow (about 1% at a few gigabytes).

Metadata block:

```
  offset   length  field
  0        1       kind          0 = text (UTF-8), 1 = one file, 2 = several files as one ZIP archive
  1        8       content size  unsigned 64-bit, bytes of content
  9        2       name length   n, at most 1,024
  11       n       name          UTF-8; empty for text
  11+n     2       type length   m, at most 255
  13+n     m       media type    printable ASCII (0x20 to 0x7E), e.g. "application/pdf"; may be empty
```

The block is at most 1,292 bytes, so it always lies whole in the first chunk.

Chunk `i` (counting from 0) is sealed with AES-256-GCM under `dataKey`, with a 128-bit tag, no additional data, and
this 12-byte nonce:

```
  bytes 0 to 10   i, as an 11-byte big-endian counter
  byte  11        0x01 for the last chunk, 0x00 for every other
```

Each file has its own salt, so its own `dataKey`, and the counter never repeats within a file: no nonce is used
twice under one key.

A locked file's size is 62 + (metadata + content + padding) + 16 × (number of chunks). The number of chunks follows
from the file's size: every chunk but the last is 65,552 bytes.

## Reading

A reader **must**, in this order:

1. Refuse a file that doesn't start with the magic (not a Lockwell file).
2. Refuse a version above 1 or a kdf id above 1 as made by a newer version; refuse version 0, kdf 0, a header
   shorter than 62 bytes or an iteration count outside 100,000 to 10,000,000 as damaged.
3. Derive the keys and verify the header MAC (in constant time). If it fails, the password is wrong or the header
   was changed; the two can't be told apart.
4. Open the chunks in order, treating the last one present as the last chunk. Fail if a tag doesn't verify, if the
   file has no chunk, or if the last chunk is empty (the stream is never empty, so a valid file never ends so).
   Bytes appended to the file, a chunk removed, repeated or moved, or a file cut off at a chunk boundary all make a
   tag fail.
5. Parse the metadata block from the start of the first chunk's plaintext. Fail if it's cut off, its lengths are
   over the limits, the name isn't valid UTF-8 or the type isn't printable ASCII. A kind above 2 was made by a newer
   version.
6. Fail if the stream holds less content than `content size` says, or if any byte after the content isn't zero.
7. Release nothing as a result until the last chunk verified. A reader that writes to disk as it goes must delete or
   empty its output when it fails.

## Locked text

For chats and mail, a locked file can be written as text: standard base64 ([RFC 4648], §4) of the whole file, 64
characters a line, between two marker lines:

```
-----BEGIN LOCKWELL MESSAGE-----
TE9DS1dFTEwBAQABhqAAAQIDBAUGBwgJCgsMDQ4P01cpPbXmktuNcdZ9CS/QWpyr
aKEzx+7Iulolx86Qd23NnbQ1LO/mBQmAc0Niji3mWZcx1PTOGoXF/DXuQL1d6MHU
QEi4aaobDz5hKIq+HPRNg+5HN7WitvtVaEbGzscUihVcZHM=
-----END LOCKWELL MESSAGE-----
```

(This is the test vector below, as text.)

The binary file and the text are the same format: decoding the text gives the file's bytes. Because chats and mail
clients change text, the site's reader is tolerant. It removes invisible and control characters, takes what lies
between the markers (or the whole text when they're missing), removes `>` quote marks at line starts and all spaces
and line breaks, accepts the URL-safe alphabet ([RFC 4648], §5) and missing `=` padding, and then requires the magic.

## Test vector

Password `tidal-mammal-spoon-uncover-gravy-pebble`, salt `00 01 02 … 0f` (16 bytes counting up from 0), 100,000
iterations, kind 0 (text), no name, no type, content `Lockwell format test vector, version 1.` followed by a line
feed (40 bytes). The file, 131 bytes, in hex:

```
4c4f434b57454c4c0101000186a0000102030405060708090a0b0c0d0e0f
d357293db5e692db8d71d67d092fd05a9cab68a133c7eec8ba5a25c7ce90776d
cd9db4352cefe60509807343628e2de6599731d4f4ce1a85c5fc35ee40bd5de8
c1d44048b869aa1b0f3e61288abe1cf44d83ee4737b5a2b6fb556846c6cec714
8a155c6473
```

The site's tests check that the tool writes exactly these bytes from these inputs, and that a second
implementation written with Node's own `node:crypto` makes and reads the same file.

## What the format hides and what it doesn't

Hidden: the content, the file's name and its media type, and with padding the exact size. Not hidden: that the file
is a Lockwell file, its approximate size, and anything the channel it travels through records (when it was sent, and
between whom).

## Versions

A change that would make version 1 readers misread a file gets a new version number or a new kdf id; version 1
readers refuse both as "made with a newer version". The test vector above opens forever.

[RFC 8018]: https://www.rfc-editor.org/rfc/rfc8018
[RFC 5869]: https://www.rfc-editor.org/rfc/rfc5869
[RFC 2104]: https://www.rfc-editor.org/rfc/rfc2104
[RFC 4648]: https://www.rfc-editor.org/rfc/rfc4648
[NIST SP 800-38D]: https://csrc.nist.gov/pubs/sp/800/38/d/final
[age]: https://c2sp.org/age
[STREAM]: https://eprint.iacr.org/2015/189
[PURBs]: https://arxiv.org/abs/1806.03160
