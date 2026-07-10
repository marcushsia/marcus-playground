const { Buffer } = require('buffer');

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeRepo(value) {
  const cleaned = cleanText(value || 'marcushsia/marcus-playground')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : cleaned;
}

function normalizeRepoPath(value, fallback) {
  return cleanText(value || fallback).replace(/^\/+/, '');
}

function normalizeBooksPath(value) {
  const path = normalizeRepoPath(value, 'jadon-reading-comprehension/books.json');
  return path.endsWith('books.json') ? path : 'jadon-reading-comprehension/books.json';
}

function normalizeAssetPathPrefix(value) {
  const path = normalizeRepoPath(value, 'jadon-reading-comprehension');
  return /^[\w./-]+$/.test(path) ? path : 'jadon-reading-comprehension';
}

function sanitizeFileStem(value) {
  return String(value || 'reading-test')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'reading_test';
}

function letterGrade(rawScore, totalQuestions) {
  if (!totalQuestions) return '';
  const ratio = rawScore / totalQuestions;
  if (totalQuestions === 30) {
    if (rawScore >= 27) return 'A+';
    if (rawScore >= 24) return 'A';
    if (rawScore >= 20) return 'B';
    if (rawScore >= 15) return 'C';
    return 'Try Again';
  }
  if (ratio >= 0.9) return 'A+';
  if (ratio >= 0.8) return 'A';
  if (ratio >= 0.67) return 'B';
  if (ratio >= 0.5) return 'C';
  return 'Try Again';
}

function sortBooksByDateDesc(books) {
  return [...books].sort((a, b) => {
    const dateDiff = new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`);
    if (dateDiff) return dateDiff;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function getConfig() {
  return {
    token: cleanText(process.env.TRACKER_GITHUB_TOKEN),
    repo: normalizeRepo(process.env.TRACKER_GITHUB_REPOSITORY),
    branch: cleanText(process.env.TRACKER_GITHUB_BRANCH || 'main'),
    booksPath: normalizeBooksPath(process.env.TRACKER_GITHUB_BOOKS_PATH),
    assetPathPrefix: normalizeAssetPathPrefix(process.env.TRACKER_GITHUB_ASSET_PATH_PREFIX),
    adminPassword: cleanText(process.env.TRACKER_ADMIN_PASSWORD),
  };
}

function assertConfigured(config) {
  if (!config.token) {
    throw new Error('GitHub token is not configured in Vercel.');
  }
}

async function githubRequest(config, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${config.repo}/${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const target = `${config.repo}/${path}`;
    throw new Error(`${data?.message || `GitHub request failed with status ${response.status}.`} (${target})`);
  }
  return data;
}

function contentPath(path) {
  return `contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
}

function decodeContent(value) {
  return Buffer.from(String(value || '').replace(/\n/g, ''), 'base64').toString('utf8');
}

function encodeContent(value) {
  return Buffer.from(value).toString('base64');
}

async function readBooksFile(config) {
  const file = await githubRequest(
    config,
    `${contentPath(config.booksPath)}?ref=${encodeURIComponent(config.branch)}`,
  );
  return {
    sha: file.sha,
    books: sortBooksByDateDesc(JSON.parse(decodeContent(file.content))),
  };
}

async function getExistingSha(config, path) {
  try {
    const file = await githubRequest(config, `${contentPath(path)}?ref=${encodeURIComponent(config.branch)}`);
    return file.sha;
  } catch (error) {
    if (error.message === 'Not Found') return undefined;
    throw error;
  }
}

async function writeGitHubFile(config, path, content, message, sha) {
  await githubRequest(config, contentPath(path), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encodeContent(content),
      branch: config.branch,
      sha,
    }),
  });
}

async function savePdf(config, file, filename, title) {
  if (!file || !file.data) return '';
  const path = [config.assetPathPrefix, filename].filter(Boolean).join('/');
  const sha = await getExistingSha(config, path);
  await writeGitHubFile(
    config,
    path,
    Buffer.from(file.data, 'base64'),
    `Upload ${title} PDF`,
    sha,
  );
  return filename;
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handlePost(req, res, config) {
  const payload = await parseBody(req);
  if (config.adminPassword && payload.adminPassword !== config.adminPassword) {
    return sendJson(res, 401, { error: 'Admin password is incorrect.' });
  }

  const title = cleanText(payload.title);
  const series = cleanText(payload.series);
  const date = cleanText(payload.date || new Date().toISOString().slice(0, 10));
  const rawScore = Number(payload.rawScore);
  const totalQuestions = Number(payload.totalQuestions);

  if (!title) return sendJson(res, 400, { error: 'Book title is required.' });
  if (!date) return sendJson(res, 400, { error: 'Test date is required.' });
  if (!Number.isInteger(rawScore) || rawScore < 0) return sendJson(res, 400, { error: 'Raw score must be a whole number.' });
  if (!Number.isInteger(totalQuestions) || totalQuestions <= 0) return sendJson(res, 400, { error: 'Total possible must be greater than zero.' });
  if (rawScore > totalQuestions) return sendJson(res, 400, { error: 'Raw score cannot be higher than total possible.' });

  const stem = sanitizeFileStem(title);
  const qPdf = payload.questionsPdf?.data
    ? await savePdf(config, payload.questionsPdf, `${stem}_Questions.pdf`, title)
    : cleanText(payload.qPdf);
  const aPdf = payload.answersPdf?.data
    ? await savePdf(config, payload.answersPdf, `${stem}_Answers.pdf`, title)
    : cleanText(payload.aPdf);

  const { books, sha } = await readBooksFile(config);
  const score = Math.round((rawScore / totalQuestions) * 100);
  const grade = letterGrade(rawScore, totalQuestions);
  const nextBook = { title, series, date, rawScore, totalQuestions, score, grade, qPdf, aPdf };
  const existingIndex = books.findIndex((book) => String(book.title).toLowerCase() === title.toLowerCase());

  if (existingIndex >= 0) {
    books[existingIndex] = {
      ...books[existingIndex],
      ...nextBook,
      qPdf: qPdf || books[existingIndex].qPdf || '',
      aPdf: aPdf || books[existingIndex].aPdf || '',
    };
  } else {
    books.push(nextBook);
  }

  const sortedBooks = sortBooksByDateDesc(books);
  await writeGitHubFile(
    config,
    config.booksPath,
    `${JSON.stringify(sortedBooks, null, 2)}\n`,
    `${existingIndex >= 0 ? 'Update' : 'Add'} ${title} reading result`,
    sha,
  );

  return sendJson(res, 200, { ok: true, book: nextBook, books: sortedBooks });
}

module.exports = async function handler(req, res) {
  const config = getConfig();

  try {
    assertConfigured(config);
    if (req.method === 'GET') {
      const { books } = await readBooksFile(config);
      return sendJson(res, 200, books);
    }
    if (req.method === 'POST') return handlePost(req, res, config);
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
