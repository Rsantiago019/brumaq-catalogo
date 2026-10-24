'use strict';
const expressApp = require('../server');

module.exports = (req, res) => {
  const requestUrl = new URL(req.url, 'https://vercel.local');
  const originalPath = req.query && req.query.__path;
  if (typeof originalPath === 'string' && originalPath.startsWith('/')) {
    requestUrl.pathname = originalPath;
    requestUrl.searchParams.delete('__path');
    req.url = `${requestUrl.pathname}${requestUrl.search}`;
  }
  return expressApp(req, res);
};

module.exports.config = { api: { bodyParser: false } };
