/** Hands a file to the browser: an object URL on a temporary <a download>, revoked right after. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const saveBytes = (bytes: Uint8Array, name: string, type: string) => save(new Blob([bytes as BlobPart], { type }), name);
export const saveText = (text: string, name: string, type = 'text/markdown;charset=utf-8') => save(new Blob([text], { type }), name);
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** A file name that is safe on every system: no path or reserved characters. */
export const fileName = (...parts: string[]) => parts.join(' ').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
