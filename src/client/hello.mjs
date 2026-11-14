// @ts-check
/**
 * @file A greeting for whoever opens the browser console. It only prints: nothing is read, stored or sent.
 */

const GREETING = String.raw`
    .::::::::.
  .::::::::::::  o\__
  '::::::::::::_____•>
     ""      ""
Lockwell: აქ დასამალი არაფერია. არც ტრეკერები, არც ანალიტიკა; კოდი ღიაა.
Lockwell: nothing to hide here. No trackers, no analytics; the code is open.`;

/** @param {(message: string) => void} [log] */
export function initHello(log = console.info) {
  log(GREETING);
}
