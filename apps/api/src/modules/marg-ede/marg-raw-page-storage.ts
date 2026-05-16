import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip, gunzipSync } from 'zlib';
import {
  MargFatalError,
  MargRawPagePayloadDescriptor,
  MargRawPageSavePayload,
  MargRetryableError,
} from './marg-sync.types';

/**
 * Persists decrypted Marg page payloads to a backing store so a staging
 * failure does not require refetching from Marg.
 *
 * Why an abstraction at all
 * -------------------------
 * A 50MB encrypted Marg page can decrypt to 200MB+ JSON. Storing that in a
 * normal Postgres column would bloat the table to the point of crashing
 * dump/restore and breaking online migrations. So the payload bytes go to a
 * separate store, addressed by a stable path that we record in
 * marg_raw_sync_pages.storage_path. The DB row carries only metadata.
 *
 * Backend selection
 * -----------------
 * Filesystem only at the moment: payloads land under MARG_RAW_PAGE_STORAGE_DIR
 * (default: ./.marg-raw-pages relative to api/). The interface is shaped so
 * an S3 / GCS implementation can drop in without touching call sites — same
 * save/load/delete signatures with the same descriptor return shape. We
 * deliberately did not add the cloud backend in this iteration; doing it
 * properly requires deciding bucket layout, retention, encryption-at-rest,
 * and IAM, which are deployment concerns the team should own.
 *
 * On-disk format
 * --------------
 * Each payload is gzip-compressed JSON. Compression typically gives 10–20×
 * reduction on Marg payloads (very repetitive Detail rows). The descriptor
 * records the SHA-256 of the *decompressed* bytes so integrity can be
 * verified on load even if the compressed file is bit-rotted on disk.
 *
 * Layout: <root>/<tenantId>/<configId>/<syncLogId>/<apiType>-<requestIndex>.json.gz
 *
 * tenantId is a path component so a misconfigured operator who points two
 * tenants at the same root still cannot cross-read; configId/syncLogId
 * cluster a sync's pages together for retention scans.
 */
@Injectable()
export class MargRawPageStorage {
  private readonly logger = new Logger(MargRawPageStorage.name);
  private readonly rootDir: string;
  /** Cached set of directories we have already mkdir-p'd this process. */
  private readonly ensuredDirs = new Set<string>();

  constructor() {
    const configured = process.env.MARG_RAW_PAGE_STORAGE_DIR;
    // path.resolve handles both absolute and relative inputs; relative paths
    // are anchored to process.cwd() which for the api service is apps/api.
    this.rootDir = path.resolve(configured && configured.trim().length > 0
      ? configured.trim()
      : '.marg-raw-pages');
  }

  /**
   * Persist a parsed payload and return a descriptor the caller writes to
   * marg_raw_sync_pages. Throws if the write fails — the caller must treat
   * a failed save as a staging-prerequisite failure (do not advance the
   * cursor).
   *
   * Memory profile
   * --------------
   * Streams the JSON-encode → SHA-256 → gzip → file write so the full
   * serialized form is never materialized in memory at once. The old
   * implementation did `JSON.stringify(parsedPayload)` on the entire page
   * (200–500MB string for a 50MB encrypted Marg page) which reliably
   * triggered V8 OOM inside `JsonStringifier::Serialize_` on the million-
   * record client.
   *
   * The streamed form serializes the payload object top-level key by
   * top-level key, and for array sections (Details, Stock, etc.) row by
   * row. Peak resident allocation is therefore bounded by the largest
   * single row's JSON.stringify (~KB-MB) rather than the whole page.
   *
   * Determinism: emitted bytes are identical to what a single
   * `JSON.stringify(payload.parsedPayload)` would have produced (same
   * key insertion order, same number encoding), so the SHA-256 we record
   * here matches the hash you would have got from the previous
   * implementation byte-for-byte. Existing on-disk pages remain valid.
   */
  async save(payload: MargRawPageSavePayload): Promise<MargRawPagePayloadDescriptor> {
    const relPath = this.buildRelativePath(payload);
    const absPath = path.join(this.rootDir, relPath);
    await this.ensureDir(path.dirname(absPath));

    const hash = createHash('sha256');
    let decryptedSize = 0;

    const obj = (payload.parsedPayload ?? {}) as Record<string, unknown>;

    // Generator that yields buffer chunks of the JSON encoding. Each chunk
    // is at most one row's worth of bytes, so V8 never needs to allocate a
    // string the size of the whole payload.
    async function* encodeChunks(): AsyncGenerator<Buffer> {
      yield Buffer.from('{', 'utf8');
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = obj[key];
        if (i > 0) yield Buffer.from(',', 'utf8');
        yield Buffer.from(JSON.stringify(key) + ':', 'utf8');
        if (Array.isArray(value)) {
          yield Buffer.from('[', 'utf8');
          for (let j = 0; j < value.length; j++) {
            if (j > 0) yield Buffer.from(',', 'utf8');
            // Per-element JSON.stringify. A single Marg row is tiny;
            // peak alloc bounded here.
            yield Buffer.from(JSON.stringify(value[j]), 'utf8');
          }
          yield Buffer.from(']', 'utf8');
        } else {
          yield Buffer.from(JSON.stringify(value), 'utf8');
        }
      }
      yield Buffer.from('}', 'utf8');
    }

    // Tap transform: capture hash + byte count of the pre-gzip stream.
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        try {
          hash.update(chunk);
          decryptedSize += chunk.length;
          cb(null, chunk);
        } catch (e) {
          cb(e as Error);
        }
      },
    });

    try {
      await pipeline(
        Readable.from(encodeChunks(), { objectMode: false }),
        tap,
        createGzip(),
        createWriteStream(absPath),
      );
    } catch (err) {
      throw this.translateStorageError(err, 'save', relPath);
    }

    return {
      storagePath: relPath,
      payloadHash: hash.digest('hex'),
      decryptedSize,
    };
  }

  /**
   * Translate a Node fs error into a Marg sync classification so the resume /
   * stale-recovery layer knows whether to retry or escalate.
   *
   *   ENOSPC (disk full)         → RETRYABLE (operator clears space, retry)
   *   EACCES / EPERM             → RETRYABLE (operator fixes permissions)
   *   EROFS                      → FATAL    (disk is read-only; needs intervention)
   *   ENOENT on save             → RETRYABLE (parent dir vanished; mkdir on retry)
   *   ENOENT on load             → FATAL    (page is gone; cannot resume; refetch)
   *   EISDIR / ENOTDIR / EMFILE  → RETRYABLE (transient FS state)
   *   anything else              → RETRYABLE (default — operator can retry)
   *
   * The error message includes the relative storage path (never the absolute
   * path with home-directory leak; never any secrets) so logs are diagnostic
   * without exposing tenant-sensitive metadata.
   */
  private translateStorageError(err: unknown, op: 'save' | 'load' | 'delete', relPath: string): Error {
    const code = ((err as { code?: unknown })?.code != null && typeof (err as { code?: unknown }).code === 'string')
      ? ((err as { code: string }).code).toUpperCase()
      : '';
    const baseMsg = `Marg raw-page ${op} failed (${code || 'UNKNOWN'}) at ${relPath}`;
    if (code === 'EROFS') {
      return new MargFatalError(baseMsg, 'STORAGE_READONLY', err);
    }
    if (code === 'ENOENT' && op === 'load') {
      return new MargFatalError(`${baseMsg} — raw page file missing; cannot resume without refetch`, 'STORAGE_MISSING', err);
    }
    if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EISDIR' || code === 'ENOTDIR' || code === 'EMFILE' || code === 'EBUSY' || code === 'ENOENT') {
      return new MargRetryableError(baseMsg, `STORAGE_${code}`, err);
    }
    return new MargRetryableError(baseMsg, 'STORAGE_UNKNOWN', err);
  }

  /**
   * Read back a previously-saved payload and verify its hash. Throws if the
   * file is missing or the recomputed hash does not match the supplied one
   * (bit rot / accidental external mutation). Callers should treat a hash
   * mismatch as fatal for the affected raw page — re-staging from corrupt
   * data is worse than refetching.
   */
  async load(descriptor: { storagePath: string; payloadHash?: string | null }): Promise<unknown> {
    const absPath = path.join(this.rootDir, descriptor.storagePath);
    let compressed: Buffer;
    try {
      compressed = await readFile(absPath);
    } catch (err) {
      throw this.translateStorageError(err, 'load', descriptor.storagePath);
    }
    const json = gunzipSync(compressed).toString('utf8');

    if (descriptor.payloadHash) {
      const actual = createHash('sha256').update(json, 'utf8').digest('hex');
      if (actual !== descriptor.payloadHash) {
        // Hash mismatch is FATAL: the on-disk page is corrupt and cannot be
        // trusted for staging. Operator must start a fresh sync to refetch.
        throw new MargFatalError(
          `Marg raw page payload hash mismatch at ${descriptor.storagePath}: ` +
          `expected ${descriptor.payloadHash}, got ${actual}. Treat as corrupt and refetch.`,
          'STORAGE_HASH_MISMATCH',
        );
      }
    }

    return JSON.parse(json) as unknown;
  }

  /**
   * Best-effort delete. Used by the optional retention sweep — a missing
   * file is not an error (the sweep may run after a partial deletion).
   */
  async delete(descriptor: { storagePath: string }): Promise<void> {
    const absPath = path.join(this.rootDir, descriptor.storagePath);
    await rm(absPath, { force: true });
  }

  /**
   * Best-effort directory cleanup for a completed sync. Removes the
   * <syncLogId> directory if it exists. Safe to call multiple times.
   */
  async deleteSyncDirectory(tenantId: string, configId: string, syncLogId: string): Promise<void> {
    const dir = path.join(this.rootDir, tenantId, configId, syncLogId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      // Best effort — log but do not throw; retention failures must not
      // break the sync result.
      this.logger.warn(`Failed to clean Marg raw page directory ${dir}: ${(err as Error).message}`);
    }
  }

  /**
   * Returns the resolved root directory. Useful for ops/debug logging and
   * tests so they can reason about where payloads land.
   */
  getRootDir(): string {
    return this.rootDir;
  }

  /**
   * Walk the storage tree and delete sync directories whose `mtime` is older
   * than the supplied age. Returns the number of sync-log directories
   * removed and the total bytes freed (best-effort accounting; may be
   * undercounted if a file disappeared mid-walk).
   *
   * Intended for an operator-triggered retention sweep. We deliberately do
   * NOT auto-delete — the operator owns the policy. The directory layout is
   * <root>/<tenantId>/<configId>/<syncLogId>/<files>, so we delete at the
   * <syncLogId> level: a sync's files are kept together so resume always
   * sees the full set or nothing.
   */
  async cleanupOldSyncDirectories(maxAgeMs: number): Promise<{ syncDirsRemoved: number; bytesFreed: number; errors: string[] }> {
    const cutoff = Date.now() - Math.max(0, maxAgeMs);
    let syncDirsRemoved = 0;
    let bytesFreed = 0;
    const errors: string[] = [];

    let tenantDirs: string[];
    try {
      tenantDirs = await readdir(this.rootDir);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        return { syncDirsRemoved: 0, bytesFreed: 0, errors: [] };
      }
      throw this.translateStorageError(err, 'load', this.rootDir);
    }

    for (const tenantDir of tenantDirs) {
      const tenantPath = path.join(this.rootDir, tenantDir);
      let configDirs: string[];
      try {
        configDirs = await readdir(tenantPath);
      } catch {
        continue;
      }
      for (const configDir of configDirs) {
        const configPath = path.join(tenantPath, configDir);
        let syncDirs: string[];
        try {
          syncDirs = await readdir(configPath);
        } catch {
          continue;
        }
        for (const syncDir of syncDirs) {
          const syncPath = path.join(configPath, syncDir);
          try {
            const s = await stat(syncPath);
            if (!s.isDirectory()) continue;
            if (s.mtimeMs > cutoff) continue;
            const dirSize = await this.directorySize(syncPath);
            await rm(syncPath, { recursive: true, force: true });
            syncDirsRemoved += 1;
            bytesFreed += dirSize;
            // Drop our cached mkdir set entry; it may be stale.
            this.ensuredDirs.delete(syncPath);
          } catch (err) {
            errors.push(`${syncPath}: ${(err as Error).message}`);
          }
        }
      }
    }

    return { syncDirsRemoved, bytesFreed, errors };
  }

  private async directorySize(dir: string): Promise<number> {
    let total = 0;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry);
      try {
        const s = await stat(p);
        if (s.isFile()) total += s.size;
        else if (s.isDirectory()) total += await this.directorySize(p);
      } catch {
        // skip vanishing/unreadable entries
      }
    }
    return total;
  }

  /**
   * Returns true if a payload exists on disk (without reading or hashing it).
   * Used by resume to short-circuit when the file is already gone — operator
   * presumably purged the storage area, so the page must be refetched.
   */
  async exists(descriptor: { storagePath: string }): Promise<boolean> {
    const absPath = path.join(this.rootDir, descriptor.storagePath);
    try {
      const s = await stat(absPath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  private buildRelativePath(payload: MargRawPageSavePayload): string {
    // sanitize: tenantId/configId/syncLogId are UUIDs in our domain; reject
    // any path-traversal attempts even though the inputs come from our own
    // DB. Defense-in-depth.
    const safe = (s: string, label: string) => {
      if (!/^[A-Za-z0-9._-]+$/.test(s)) {
        throw new Error(`Invalid ${label} for raw-page path: ${s}`);
      }
      return s;
    };
    return path.join(
      safe(payload.tenantId, 'tenantId'),
      safe(payload.configId, 'configId'),
      safe(payload.syncLogId, 'syncLogId'),
      `api${payload.apiType}-req${payload.requestIndex}.json.gz`,
    );
  }

  private async ensureDir(dir: string): Promise<void> {
    if (this.ensuredDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    this.ensuredDirs.add(dir);
  }
}
