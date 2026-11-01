// E2E testleri için GitHub REST API'sinin kullandığımız kısmının bellek içi taklidi.
// Gerçek API'nin davranışları (boş repoda 409, olmayan dosyayı silmede 422, fast-forward olmayan
// ref güncellemesinde 422, CORS başlık listesi) bilerek aynı tutuldu.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4599);
const OWNER = 'test';
const REPO = 'test-data';

const state = {
  token: 'good-token',
  branchHead: null,
  blobs: new Map(),
  trees: new Map(),
  commits: new Map(),
  commitCount: 0,
  /** Testler "tam bu anda başkası commit attı" durumunu buradan tetikler. */
  raceNextRef: false,
};

const sha = (kind, data) => createHash('sha1').update(kind).update(data).digest('hex');

function storeBlob(buffer) {
  const id = sha('blob', buffer);
  state.blobs.set(id, buffer);
  return id;
}

function storeTree(entries) {
  const id = sha('tree', JSON.stringify([...entries.entries()].sort()));
  state.trees.set(id, entries);
  return id;
}

function storeCommit(tree, parents, message) {
  const id = sha('commit', JSON.stringify({ tree, parents, message, n: state.commitCount++ }));
  state.commits.set(id, { tree, parents, message });
  return id;
}

function treeOf(ref) {
  const commit = state.commits.get(ref);
  return state.trees.get(commit ? commit.tree : ref);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, User-Agent, X-GitHub-Api-Version',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body) {
  const isBuffer = Buffer.isBuffer(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json',
    // Gerçek API gibi: tarayıcı önbelleği 60 sn eski yanıt verebilir.
    'Cache-Control': 'private, max-age=60',
  });
  res.end(isBuffer ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

function snapshot() {
  const files = {};
  if (state.branchHead) {
    for (const [path, blob] of treeOf(state.branchHead)) {
      const buffer = state.blobs.get(blob);
      files[path] = path.endsWith('.json') ? JSON.parse(buffer.toString()) : buffer.length;
    }
  }
  const messages = [];
  for (let c = state.branchHead; c; c = state.commits.get(c).parents[0]) messages.push(state.commits.get(c).message);
  return { files, messages };
}

function foreignCommit() {
  const entries = new Map(treeOf(state.branchHead));
  entries.set('baskasi.txt', storeBlob(Buffer.from('araya giren commit')));
  state.branchHead = storeCommit(storeTree(entries), [state.branchHead], 'Araya giren commit');
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (path.startsWith('/__test/')) {
    const action = path.slice(8);
    if (action === 'state') return send(res, 200, snapshot());
    if (action === 'race') state.raceNextRef = true;
    if (action === 'foreign') foreignCommit();
    if (action === 'revoke') state.token = 'revoked';
    if (action === 'restore') state.token = 'good-token';
    if (action === 'reset') {
      state.branchHead = null;
      state.blobs.clear();
      state.trees.clear();
      state.commits.clear();
      state.token = 'good-token';
      state.raceNextRef = false;
    }
    return send(res, 200, { ok: true });
  }

  if (req.headers.authorization !== `Bearer ${state.token}`) {
    return send(res, 401, { message: 'Bad credentials' });
  }

  const prefix = `/repos/${OWNER}/${REPO}`;
  if (!path.startsWith(prefix)) return send(res, 404, { message: 'Not Found' });
  const route = path.slice(prefix.length);

  if (req.method === 'GET' && route === '') {
    return send(res, 200, { default_branch: 'main', private: true });
  }

  if (req.method === 'GET' && route === '/git/ref/heads/main') {
    if (!state.branchHead) return send(res, 409, { message: 'Git Repository is empty.' });
    return send(res, 200, { object: { sha: state.branchHead } });
  }

  if (req.method === 'PUT' && route === '/contents/README.md') {
    const { content, message } = await readBody(req);
    const tree = storeTree(new Map([['README.md', storeBlob(Buffer.from(content, 'base64'))]]));
    state.branchHead = storeCommit(tree, [], message);
    return send(res, 201, { commit: { sha: state.branchHead } });
  }

  let match = route.match(/^\/git\/trees\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const entries = treeOf(match[1]);
    if (!entries) return send(res, 404, { message: 'Not Found' });
    return send(res, 200, {
      truncated: false,
      tree: [...entries].map(([p, blob]) => ({ path: p, sha: blob, type: 'blob' })),
    });
  }

  match = route.match(/^\/git\/blobs\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const blob = state.blobs.get(match[1]);
    if (!blob) return send(res, 404, { message: 'Not Found' });
    if (req.headers.accept !== 'application/vnd.github.raw+json') {
      return send(res, 200, { content: blob.toString('base64'), encoding: 'base64' });
    }
    return send(res, 200, blob);
  }

  if (req.method === 'POST' && route === '/git/blobs') {
    const { content, encoding } = await readBody(req);
    if (encoding !== 'base64') return send(res, 422, { message: 'encoding' });
    return send(res, 201, { sha: storeBlob(Buffer.from(content, 'base64')) });
  }

  if (req.method === 'POST' && route === '/git/trees') {
    const { base_tree: base, tree } = await readBody(req);
    const entries = new Map(treeOf(base));
    for (const item of tree) {
      if (item.mode !== '100644' || item.type !== 'blob') return send(res, 422, { message: 'bad entry' });
      if (item.sha === null) {
        if (!entries.has(item.path)) return send(res, 422, { message: 'GitRPC::BadObjectState' });
        entries.delete(item.path);
      } else {
        if (!state.blobs.has(item.sha)) return send(res, 422, { message: 'tree.sha wrong' });
        entries.set(item.path, item.sha);
      }
    }
    return send(res, 201, { sha: storeTree(entries) });
  }

  if (req.method === 'POST' && route === '/git/commits') {
    const { message, tree, parents } = await readBody(req);
    return send(res, 201, { sha: storeCommit(tree, parents, message) });
  }

  if (req.method === 'PATCH' && route === '/git/refs/heads/main') {
    const { sha: target } = await readBody(req);
    if (state.raceNextRef) {
      state.raceNextRef = false;
      foreignCommit();
    }
    const commit = state.commits.get(target);
    if (!commit || commit.parents[0] !== state.branchHead) {
      return send(res, 422, { message: 'Update is not a fast forward' });
    }
    state.branchHead = target;
    return send(res, 200, { object: { sha: target } });
  }

  return send(res, 404, { message: 'Not Found' });
}).listen(PORT, () => console.log(`mock github :${PORT}`));
