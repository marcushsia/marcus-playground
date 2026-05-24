const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 4317);
const SITE_DIR = __dirname;
const PROJECT_DIR = '/Users/Marcus/Library/CloudStorage/GoogleDrive-marcus.hsia@gmail.com/My Drive/Claude/Projects/Jadon - Reading Comprehension';
const PROJECT_OUTPUTS_DIR = path.join(PROJECT_DIR, 'outputs');
const BOOKS_FILE = path.join(SITE_DIR, 'books.json');
const CONTEXT_FILE = path.join(PROJECT_DIR, 'context.md');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
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

function escapeMarkdown(value) {
  return String(value || '').replace(/\|/g, '\\|').trim();
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

async function readBooks() {
  try {
    return sortBooksByDateDesc(JSON.parse(await fs.readFile(BOOKS_FILE, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeBooks(books) {
  await fs.writeFile(BOOKS_FILE, `${JSON.stringify(sortBooksByDateDesc(books), null, 2)}\n`);
}

async function savePdf(file, filename) {
  if (!file || !file.data) return '';
  const buffer = Buffer.from(file.data, 'base64');
  await fs.writeFile(path.join(SITE_DIR, filename), buffer);
  await fs.writeFile(path.join(PROJECT_OUTPUTS_DIR, filename), buffer);
  return filename;
}

async function updateContextFile(books) {
  let context = await fs.readFile(CONTEXT_FILE, 'utf8');
  const rows = books.map((book, index) => {
    const result = `${book.score}% (${book.rawScore}/${book.totalQuestions}) - ${book.grade}`;
    return `| ${index + 1} | ${escapeMarkdown(book.title)} | ${escapeMarkdown(book.series || '')} | ${escapeMarkdown(book.qPdf || book.aPdf || '')} | ${book.date} | ${result} |`;
  });
  const table = [
    '| # | Book | Series | Test File | Date Created | Result |',
    '|---|------|--------|-----------|--------------|--------|',
    ...rows,
  ].join('\n');

  const tablePattern = /(\n## Books Tested\n)([\s\S]*?)(\n\n## Tools & Stack)/;
  if (tablePattern.test(context)) {
    context = context.replace(tablePattern, `$1${table}$3`);
  } else {
    context += `\n\n## Books Tested\n${table}\n`;
  }
  await fs.writeFile(CONTEXT_FILE, context);
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleAddBook(req, res) {
  const payload = await parseJsonBody(req);
  const title = String(payload.title || '').trim();
  const series = String(payload.series || '').trim();
  const rawScore = Number(payload.rawScore);
  const totalQuestions = Number(payload.totalQuestions);
  const date = String(payload.date || new Date().toISOString().slice(0, 10)).trim();

  if (!title) return sendJson(res, 400, { error: 'Book title is required.' });
  if (!Number.isFinite(rawScore) || rawScore < 0) return sendJson(res, 400, { error: 'Raw score is required.' });
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return sendJson(res, 400, { error: 'Total questions must be greater than zero.' });
  if (rawScore > totalQuestions) return sendJson(res, 400, { error: 'Raw score cannot be higher than total questions.' });
  if (!payload.questionsPdf?.data) return sendJson(res, 400, { error: 'Questions PDF is required.' });

  const stem = sanitizeFileStem(title);
  const qPdf = await savePdf(payload.questionsPdf, `${stem}_Questions.pdf`);
  const aPdf = payload.answersPdf?.data ? await savePdf(payload.answersPdf, `${stem}_Answers.pdf`) : '';
  const score = Math.round((rawScore / totalQuestions) * 100);
  const grade = letterGrade(rawScore, totalQuestions);

  const books = await readBooks();
  const nextBook = { title, series, date, rawScore, totalQuestions, score, grade, qPdf, aPdf };
  const existingIndex = books.findIndex((book) => book.title.toLowerCase() === title.toLowerCase());
  if (existingIndex >= 0) {
    books[existingIndex] = { ...books[existingIndex], ...nextBook };
  } else {
    books.push(nextBook);
  }

  const sortedBooks = sortBooksByDateDesc(books);
  await writeBooks(sortedBooks);
  await updateContextFile(sortedBooks);
  sendJson(res, 200, { ok: true, book: nextBook, books: sortedBooks });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(SITE_DIR, requested));

  if (!filePath.startsWith(SITE_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(file);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/api/books') {
      return sendJson(res, 200, await readBooks());
    }
    if (req.method === 'POST' && req.url === '/api/books') {
      return handleAddBook(req, res);
    }
    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Jadon reading tracker is running at http://localhost:${PORT}`);
});
