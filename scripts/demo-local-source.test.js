import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isLocalPath, listHtmlFiles, toFileUrl } from './demo-local-source.js';

test('isLocalPath reconoce URLs http/https como NO locales', () => {
  assert.equal(isLocalPath('https://banco.example.com'), false);
  assert.equal(isLocalPath('http://banco.example.com'), false);
});

test('isLocalPath reconoce un path de carpeta como local', () => {
  assert.equal(isLocalPath('C:\\proyecto\\build'), true);
  assert.equal(isLocalPath('/home/user/proyecto/build'), true);
});

test('isLocalPath con string vacío da false (no hay nada que tratar como local)', () => {
  assert.equal(isLocalPath(''), false);
  assert.equal(isLocalPath(undefined), false);
});

test('listHtmlFiles encuentra los .html de una carpeta real, ordenados, ignora otros archivos', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'f1-local-source-'));
  await writeFile(path.join(dir, 'b-pagina.html'), '<html></html>');
  await writeFile(path.join(dir, 'a-pagina.html'), '<html></html>');
  await writeFile(path.join(dir, 'estilos.css'), 'body{}');

  const files = await listHtmlFiles(dir);

  assert.equal(files.length, 2);
  assert.ok(files[0].endsWith('a-pagina.html'));
  assert.ok(files[1].endsWith('b-pagina.html'));
});

test('listHtmlFiles no baja a subcarpetas', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'f1-local-source-'));
  await writeFile(path.join(dir, 'index.html'), '<html></html>');
  await mkdir(path.join(dir, 'subcarpeta'));
  await writeFile(path.join(dir, 'subcarpeta', 'oculta.html'), '<html></html>');

  const files = await listHtmlFiles(dir);

  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('index.html'));
});

test('listHtmlFiles tira un error claro si la carpeta no tiene ningún .html', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'f1-local-source-'));
  await writeFile(path.join(dir, 'estilos.css'), 'body{}');

  await assert.rejects(() => listHtmlFiles(dir), /No se encontraron archivos \.html/);
});

test('listHtmlFiles tira un error claro si la carpeta no existe', async () => {
  await assert.rejects(() => listHtmlFiles('C:\\esta\\carpeta\\no\\existe'), /.+/);
});

test('toFileUrl convierte un path de archivo a una URL file:// válida', () => {
  const url = toFileUrl(path.join('C:\\proyecto', 'index.html'));
  assert.match(url, /^file:\/\/\//);
  assert.match(url, /index\.html$/);
});
