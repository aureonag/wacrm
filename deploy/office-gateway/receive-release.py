#!/usr/bin/env python3
"""Receive exactly one opaque release file; never execute or extract its bytes.

Linux-only production CLI, intended for a dedicated unprivileged SSH account.
An administrator must own this script/its ancestors and the authorized_keys rule;
only that account may write incoming, and no untrusted process may share its UID.
A nonblocking advisory lock on incoming serializes this receiver across sessions;
a second upload is rejected before a temporary file is created. This does not
configure SSH connection limits or constrain unrelated programs using that UID.
No directory is created by this program. Production targets are DIRECT children
of /srv/aureon-office/incoming; there is no CLI switch to change that root.

Illustrative authorized_keys options, NOT installed or generated here:
restrict,expiry-time="YYYYMMDDHHMMSSZ",command="/usr/bin/python3 -I /usr/local/libexec/aureon/receive-release.py --target /srv/aureon-office/incoming/RELEASE.tar --bytes EXPECTED_INTEGER --sha256 EXPECTED_LOWERCASE_HEX" ssh-ed25519 PUBLIC_KEY

Replace placeholders with the reviewed artifact's exact metadata, a short UTC
expiry and a dedicated upload-only public key. Use no PTY, verify the SSH host
fingerprint, and revoke the key after acceptance. Never use a broad root key.
The helper ignores SSH_ORIGINAL_COMMAND and reads no environment or private key.
A future single deployment approval must cover the restricted upload key, HMAC
configuration, RPC migrations and publication together. None is performed here.
OpenSSH reference: https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT

Publication is an atomic hard link of the complete fsynced temporary file into a
NEW name, followed by removal of this process's own temporary name. No rename
that could replace an existing destination is used. A lost acknowledgement/fsync
failure may leave a valid published file: an operator must inspect it; never
blindly remove/retry an existing target. Restart/install/extraction are separate,
explicitly authorized actions. SIGKILL/power loss can leave a private temporary
file; this helper never scans or deletes leftovers from other invocations.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import PurePosixPath
import re
import secrets
import signal
import stat
import sys
from typing import BinaryIO, Callable, Iterator

PRODUCTION_ROOT = "/srv/aureon-office/incoming"
MAX_BYTES = 1024 * 1024 * 1024
DEADLINE_SECONDS = 600
CHUNK_BYTES = 64 * 1024


class ReceiveError(Exception):
    """Only static rejection reasons; no payload, environment or secret values."""


@dataclass(frozen=True)
class ReleaseSpec:
    target: str
    expected_bytes: int
    sha256: str
    _root: str = PRODUCTION_ROOT
    _test_policy: bool = False

    def __post_init__(self) -> None:
        root = PurePosixPath(self._root)
        path = PurePosixPath(self.target)
        if (not root.is_absolute() or str(root) != self._root or ".." in root.parts
                or not path.is_absolute() or str(path) != self.target
                or path.parent != root
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", path.name)):
            raise ReceiveError("invalid target")
        if not self._test_policy and self._root != PRODUCTION_ROOT:
            raise ReceiveError("invalid root")
        if (type(self.expected_bytes) is not int
                or not 1 <= self.expected_bytes <= MAX_BYTES):
            raise ReceiveError("invalid length")
        if not isinstance(self.sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", self.sha256):
            raise ReceiveError("invalid digest")

    @classmethod
    def for_tests(cls, root: str, target: str, expected_bytes: int, sha256: str) -> ReleaseSpec:
        """Explicit in-process fixture policy; never exposed by the CLI."""
        return cls(target, expected_bytes, sha256, root, True)


def linux_capable() -> bool:
    return (
        sys.platform.startswith("linux")
        and all(hasattr(os, name) for name in ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC"))
        and all(fn in os.supports_dir_fd for fn in (os.open, os.stat, os.link, os.unlink))
        and os.stat in os.supports_follow_symlinks
        and os.link in os.supports_follow_symlinks
        and hasattr(signal, "SIGALRM") and hasattr(signal, "alarm")
    )


class PosixTarget:
    """Descriptor-anchored filesystem operations; production has no path fallback."""

    def __init__(self, spec: ReleaseSpec) -> None:
        if not linux_capable():
            raise ReceiveError("unsupported platform")
        self.spec = spec
        self.directory_fd = -1
        self.file_fd = -1
        self.temp_name: str | None = None
        self.identity: tuple[int, int] | None = None
        try:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            directory_fd = os.open("/", flags)
            try:
                for part in PurePosixPath(spec._root).parts[1:]:
                    next_fd = os.open(part, flags, dir_fd=directory_fd)
                    try:
                        metadata = os.fstat(next_fd)
                        if (not stat.S_ISDIR(metadata.st_mode)
                                or (not spec._test_policy and (
                                    metadata.st_mode & 0o022
                                    or metadata.st_uid not in (0, os.geteuid())))):
                            raise ReceiveError("unsafe directory")
                    except BaseException:
                        os.close(next_fd)
                        raise
                    os.close(directory_fd)
                    directory_fd = next_fd
                self.directory_fd = directory_fd
                directory_fd = -1
            finally:
                if directory_fd >= 0:
                    os.close(directory_fd)
            # Kernel releases this lock when the directory descriptor closes.
            # All invocations share the same trusted incoming directory inode.
            import fcntl
            fcntl.flock(self.directory_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                os.stat(PurePosixPath(spec.target).name, dir_fd=self.directory_fd,
                        follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise ReceiveError("destination exists")
            for _attempt in range(10):
                name = ".receive-" + secrets.token_hex(16)
                try:
                    file_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                      | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600,
                                      dir_fd=self.directory_fd)
                except FileExistsError:
                    continue
                self.file_fd = file_fd
                self.temp_name = name
                metadata = os.fstat(file_fd)
                self.identity = (metadata.st_dev, metadata.st_ino)
                os.fchmod(file_fd, 0o600)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise ReceiveError("unsafe temporary file")
                break
            else:
                raise ReceiveError("temporary collision")
        except BaseException:
            self.close()
            raise

    def write(self, data: bytes) -> None:
        remaining = memoryview(data)
        while remaining:
            written = os.write(self.file_fd, remaining)
            if written <= 0:
                raise ReceiveError("write failed")
            remaining = remaining[written:]

    def sync(self) -> None:
        os.fsync(self.file_fd)
        if os.fstat(self.file_fd).st_size != self.spec.expected_bytes:
            raise ReceiveError("file size changed")

    def _owns_temp(self) -> bool:
        if self.temp_name is None or self.directory_fd < 0:
            return False
        try:
            metadata = os.stat(self.temp_name, dir_fd=self.directory_fd,
                               follow_symlinks=False)
        except FileNotFoundError:
            return False
        return (stat.S_ISREG(metadata.st_mode)
                and (metadata.st_dev, metadata.st_ino) == self.identity)

    def publish(self) -> None:
        if not self._owns_temp():
            raise ReceiveError("temporary file changed")
        # linkat fails with EEXIST atomically, including an existing symlink.
        os.link(self.temp_name, PurePosixPath(self.spec.target).name,
                src_dir_fd=self.directory_fd, dst_dir_fd=self.directory_fd,
                follow_symlinks=False)
        os.fsync(self.directory_fd)

    def close(self) -> None:
        try:
            if self._owns_temp():
                os.unlink(self.temp_name, dir_fd=self.directory_fd)
                os.fsync(self.directory_fd)
        finally:
            if self.file_fd >= 0:
                os.close(self.file_fd)
                self.file_fd = -1
            if self.directory_fd >= 0:
                os.close(self.directory_fd)
                self.directory_fd = -1


def receive_release(spec: ReleaseSpec, source: BinaryIO, *,
                    _target_factory: Callable[[ReleaseSpec], PosixTarget] = PosixTarget) -> None:
    """Copy bounded opaque bytes. The private hook permits explicit local fixtures only."""
    target = _target_factory(spec)
    try:
        digest = hashlib.sha256()
        remaining = spec.expected_bytes
        while remaining:
            requested = min(CHUNK_BYTES, remaining)
            chunk = source.read(requested)
            if not isinstance(chunk, bytes) or not chunk or len(chunk) > requested:
                raise ReceiveError("truncated or invalid stream")
            target.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
        tail = source.read(1)
        if not isinstance(tail, bytes) or tail != b"":
            raise ReceiveError("excess data")
        if digest.hexdigest() != spec.sha256:
            raise ReceiveError("digest mismatch")
        target.sync()
        target.publish()
    finally:
        target.close()


@contextmanager
def transfer_deadline() -> Iterator[None]:
    if not linux_capable():
        raise ReceiveError("unsupported platform")

    def expired(_number: int, _frame: object) -> None:
        raise ReceiveError("deadline")

    previous = signal.signal(signal.SIGALRM, expired)
    signal.alarm(DEADLINE_SECONDS)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Receive one fixed release file; never execute it.", allow_abbrev=False)
    parser.add_argument("--target", required=True)
    parser.add_argument("--bytes", required=True, dest="byte_count")
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args(argv)
    try:
        if not re.fullmatch(r"[1-9][0-9]{0,9}", args.byte_count):
            raise ReceiveError("invalid length")
        spec = ReleaseSpec(args.target, int(args.byte_count), args.sha256)
        with transfer_deadline():
            receive_release(spec, sys.stdin.buffer)
    except (ReceiveError, OSError):
        sys.stderr.write("Release rejected.\n")
        return 1
    sys.stdout.write("Release received.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
