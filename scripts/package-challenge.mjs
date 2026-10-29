/** Package tracked source after CI verification. Never copies local secrets or untracked data. */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'evidence/challenge');
mkdirSync(output, {recursive: true});
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
const commit = git(['rev-parse', 'HEAD']).trim();
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean);
for (const path of paths) {
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example')) throw new Error('Tracked environment file must be removed before packaging.');
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const files = paths.map(path => {const data = execFileSync('git', ['show', `${commit}:${path}`], {cwd: root, maxBuffer: 16 * 1024 * 1024}); return {path, bytes: data.length, sha256: sha256(data)};});
const archive = resolve(output, 'seogu-on-source.zip');
git(['archive', '--format=zip', '--prefix=seogu-on/', `--output=${archive}`, commit]);
const archiveSha256 = sha256(readFileSync(archive));
writeFileSync(resolve(output, 'source-manifest.json'), JSON.stringify({schema: 'seoguon-submission-source-v1',
  commit, version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  generatedAt: new Date().toISOString(), nodeVersion: process.version,
  workflowRun: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  sourceArchive: 'seogu-on-source.zip', archiveSha256,
  scope: 'Exact tracked source. CI verify.log and region-replay.json are execution evidence. No real-model or employee outcome claim.', files}, null, 2) + '\n');
writeFileSync(resolve(output, 'SHA256SUMS.txt'), `${archiveSha256}  seogu-on-source.zip\n`);
console.log(JSON.stringify({commit, archive, archiveSha256, files: files.length}));
