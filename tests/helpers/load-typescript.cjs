const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(relativePath, { mocks = {}, globals = {} } = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: filename,
  });
  const module = { exports: {} };
  let definition;
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(specifier) {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      return require(specifier);
    },
    Page(value) { definition = value; },
    Component(value) { definition = value; },
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  }, { filename });
  return { exports: module.exports, definition };
}

module.exports = { loadModule };
