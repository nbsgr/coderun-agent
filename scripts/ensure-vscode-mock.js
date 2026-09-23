import * as fs from 'fs';
import * as path from 'path';

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFileIfDifferent(sourcePath, targetPath) {
  var shouldCopy = true;
  if (fs.existsSync(targetPath)) {
    var sourceData = fs.readFileSync(sourcePath);
    var targetData = fs.readFileSync(targetPath);
    if (sourceData.equals(targetData)) {
      shouldCopy = false;
    }
  }
  if (shouldCopy) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function ensureVsCodeMock() {
  var rootDir = process.cwd();
  var mockDir = path.join(rootDir, 'test', 'mocks', 'vscode');
  var targetDir = path.join(rootDir, 'node_modules', 'vscode');

  if (!fs.existsSync(mockDir)) {
    return;
  }

  ensureDirectoryExists(targetDir);

  var mockFiles = ['package.json', 'index.js'];
  for (var i = 0; i < mockFiles.length; i++) {
    var fileName = mockFiles[i];
    var sourceFile = path.join(mockDir, fileName);
    var targetFile = path.join(targetDir, fileName);
    if (fs.existsSync(sourceFile)) {
      copyFileIfDifferent(sourceFile, targetFile);
    }
  }
}

ensureVsCodeMock();
