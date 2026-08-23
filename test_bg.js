import { BotGuardClient } from './node_modules/bgutils-js/dist/core/BotGuardClient.js';
import { getChallenge } from './node_modules/bgutils-js/dist/core/ChallengeFetcher.js';

async function main() {
  console.log('=== Testing BotGuard & Google Integrity Token in Node.js ===');

  const challenge = await getChallenge({
    requestKey: 'O43z0dpjhgX20SCx4KAo',
    fetchFunction: fetch,
    useYouTubeAPI: false
  });

  const vmScript = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  globalThis.document = {
    createElement: () => ({ setAttribute: () => {}, getAttribute: () => null, style: {} }),
    getElementsByTagName: () => [],
    querySelectorAll: () => [],
    querySelector: () => null,
    documentElement: { style: {} },
    body: { style: {} }
  };
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.location = {
    href: 'https://www.youtube.com',
    hostname: 'www.youtube.com',
    protocol: 'https:',
    origin: 'https://www.youtube.com'
  };
  globalThis.screen = { width: 1920, height: 1080, colorDepth: 24 };

  const fn = new Function(vmScript);
  fn();

  const botguard = await BotGuardClient.create({
    globalObject: globalThis,
    globalName: challenge.globalName,
    program: challenge.program
  });

  const botguardResponse = await botguard.snapshot({});
  console.log('BotGuard Snapshot:', botguardResponse ? botguardResponse.slice(0, 40) : null);

  const itResp = await fetch('https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT', {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
      'x-user-agent': 'grpc-web-javascript/0.1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    },
    body: JSON.stringify([challenge.messageId || 'O43z0dpjhgX20SCx4KAo', botguardResponse])
  });

  const itJson = await itResp.json();
  console.log('GenerateIT Response:', itJson);
}

main().catch(console.error);
