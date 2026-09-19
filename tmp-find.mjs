import fs from 'node:fs';
const REF = 'C:/Users/med-a/Music/Real_Claude_Code_VSCODE_extension_files';
const args = process.argv.slice(2);
const web = args[0] === '--web';
const rest = web ? args.slice(1) : args;
const src = fs.readFileSync(web ? `${REF}/webview/index.js` : `${REF}/extension.js`, 'utf8');
let before = 100, after = 1500, max = 6;
const needles = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '-b') { before = Number(rest[++i]); continue; }
  if (rest[i] === '-a') { after = Number(rest[++i]); continue; }
  if (rest[i] === '-n') { max = Number(rest[++i]); continue; }
  needles.push(rest[i]);
}
for (const needle of needles) {
  let i = -1, n = 0;
  console.log(`\n########## ${JSON.stringify(needle)} ##########`);
  while ((i = src.indexOf(needle, i + 1)) !== -1) {
    n++;
    if (n > max) { console.log('...more'); break; }
    console.log(`--- @${i} ---`);
    console.log(src.slice(Math.max(0, i - before), i + after));
    console.log();
  }
  if (n === 0) console.log('(no hits)');
}
