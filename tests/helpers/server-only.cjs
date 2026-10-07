// Next replaces this marker at build time. Unit tests exercise server modules
// outside Next; stub only the environment marker, never their business logic.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};
