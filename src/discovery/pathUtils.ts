import * as path from "path";

export function isPathWithin(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = normalizeFsPath(candidatePath);
  const normalizedRoot = normalizeFsPath(rootPath);

  if (normalizedCandidate === normalizedRoot) {
    return true;
  }

  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export function normalizeFsPath(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isNormalizedPathWithin(normalizedCandidate: string, normalizedRoot: string): boolean {
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

/**
 * Number of path segments the candidate lies below the root.
 * candidate === root -> 0; a direct child -> 1; grandchild -> 2; etc.
 * Returns -1 when the candidate is not within the root.
 * Inputs must already be normalized (see normalizeFsPath).
 */
export function normalizedDepthBelow(normalizedCandidate: string, normalizedRoot: string): number {
  if (normalizedCandidate === normalizedRoot) {
    return 0;
  }
  const prefix = `${normalizedRoot}${path.sep}`;
  if (!normalizedCandidate.startsWith(prefix)) {
    return -1;
  }
  const remainder = normalizedCandidate.slice(prefix.length);
  if (remainder === "") {
    return 0;
  }
  return remainder.split(path.sep).filter((seg) => seg.length > 0).length;
}
