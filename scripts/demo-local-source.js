import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Distingue si lo que el presentador tipeó en la opción 3 es una URL de internet o el path
 * de una carpeta local con código fuente. No valida que el path exista - eso lo hace
 * listHtmlFiles con un error claro si la carpeta no está o no tiene .html.
 */
export function isLocalPath(input) {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return false;
  return !/^https?:\/\//i.test(trimmed);
}

/**
 * Lista los .html de primer nivel de una carpeta local, ordenados alfabéticamente (mismo rol
 * que crawlSite para el modo "sitio en internet" - le da a la demo una lista real para que el
 * presentador elija cuántas auditar). No baja a subcarpetas.
 */
export async function listHtmlFiles(folderPath) {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => path.join(folderPath, entry.name))
    .sort();

  if (htmlFiles.length === 0) {
    throw new Error(`No se encontraron archivos .html en "${folderPath}".`);
  }
  return htmlFiles;
}

/** scanUrl/Playwright navegan file:// URLs igual que http(s) - esto arma esa URL a partir del path. */
export function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}
