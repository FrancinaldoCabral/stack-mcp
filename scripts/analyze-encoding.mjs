import 'dotenv/config';

const AUDIO_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// Simulate what N8N does: httpRequest returns UTF-8 decoded string
// (N8N receives bytes, decodes as UTF-8, gives us a string)
const r = await fetch(AUDIO_URL);
const ab = await r.arrayBuffer();
const correctBuf = Buffer.from(ab);
console.log('Correct buffer len:', correctBuf.length, 'b64 len:', correctBuf.toString('base64').length);
console.log('Correct b64 start:', correctBuf.toString('base64').slice(0, 30));

// Simulate N8N's UTF-8 decoding
const utf8Str = correctBuf.toString('utf8');
console.log('UTF-8 str len:', utf8Str.length);

// Try to recover from UTF-8 string
const tryBinary = Buffer.from(utf8Str, 'binary');
const tryUtf8 = Buffer.from(utf8Str, 'utf8');
const tryLatin1 = Buffer.from(utf8Str, 'latin1');
console.log('\nbinary len:', tryBinary.length, 'matches?', tryBinary.length === correctBuf.length);
console.log('utf8 len:', tryUtf8.length, 'matches?', tryUtf8.equals(correctBuf));
console.log('latin1 len:', tryLatin1.length, 'matches?', tryLatin1.length === correctBuf.length);

// N8N returns str of len 100044 - let's simulate that
// If N8N returns str.length=100044, it must have decoded as latin1 (not utf8, which would be shorter)
// Let's simulate latin1 decoding
const latin1Str = correctBuf.toString('latin1');
console.log('\nlatin1 str len:', latin1Str.length, '(matches 100044?', latin1Str.length === 100044, ')');
const recoveredFromLatin1 = Buffer.from(latin1Str, 'binary');
console.log('recovered from latin1 str via binary:', recoveredFromLatin1.length, 'matches?', recoveredFromLatin1.equals(correctBuf));
console.log('b64 start:', recoveredFromLatin1.toString('base64').slice(0, 30));
