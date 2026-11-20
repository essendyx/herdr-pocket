// Angehängte Bilder wieder anzeigen: nur Bilddateien direkt im Bilderordner, keine Umwege über .. oder Symlinks.
import { realpathSync, statSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";

const EXT = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

export function imagePath(dir: string, p: string): string | null {
  if (!p || !isAbsolute(p) || !EXT.test(p)) return null;
  try {
    const real = realpathSync(resolve(p));
    if (dirname(real) !== realpathSync(dir) || !EXT.test(real) || !statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}
