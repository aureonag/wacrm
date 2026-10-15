"""Local tests; real Linux filesystem tests explicitly skip on Windows."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import unittest
from unittest import mock

MODULE_PATH = Path(__file__).with_name("receive-release.py")
SPEC = importlib.util.spec_from_file_location("receive_release", MODULE_PATH)
receiver = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = receiver
SPEC.loader.exec_module(receiver)

PAYLOAD = b"opaque\x00release\xffbytes"
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()
ROOT = "/fixture/incoming"


def spec(payload=PAYLOAD, target=ROOT + "/release.tar", digest=None):
    return receiver.ReleaseSpec.for_tests(ROOT, target, len(payload),
                                          digest or hashlib.sha256(payload).hexdigest())


class MemoryTarget:
    """Test double for transaction ordering; not evidence of Linux syscall behavior."""
    def __init__(self, release):
        self.spec = release
        self.temp = bytearray()
        self.published = None
        self.closed = False
        self.events = []
        self.unrelated = b"preserve"
        self.existing = None
        self.fail_write = False

    def write(self, chunk):
        self.events.append("write")
        if self.fail_write:
            raise OSError("fixture write failure")
        self.temp.extend(chunk)

    def sync(self):
        self.events.append("sync")

    def publish(self):
        self.events.append("publish")
        if self.existing is not None:
            raise FileExistsError("fixture destination exists")
        self.published = bytes(self.temp)

    def close(self):
        self.events.append("cleanup")
        self.temp.clear()
        self.closed = True


class PolicyTests(unittest.TestCase):
    def test_production_accepts_only_direct_new_name_under_literal_root(self):
        value = receiver.ReleaseSpec(receiver.PRODUCTION_ROOT + "/release-191.tar", 1, "a" * 64)
        self.assertEqual(value._root, receiver.PRODUCTION_ROOT)

    def test_rejects_target_escape_normalization_nested_prefix_and_shell_chars(self):
        targets = [
            "release.tar", "/tmp/release.tar", receiver.PRODUCTION_ROOT,
            receiver.PRODUCTION_ROOT + "evil/release.tar",
            receiver.PRODUCTION_ROOT + "/../release.tar",
            receiver.PRODUCTION_ROOT + "//release.tar",
            receiver.PRODUCTION_ROOT + "/nested/release.tar",
            receiver.PRODUCTION_ROOT + "/.hidden",
            receiver.PRODUCTION_ROOT + "/release.tar/",
            receiver.PRODUCTION_ROOT + "/release;touch.txt",
            receiver.PRODUCTION_ROOT + "/release\nx",
            receiver.PRODUCTION_ROOT + "/release\x00x",
        ]
        for target in targets:
            with self.subTest(target=repr(target)), self.assertRaises(receiver.ReceiveError):
                receiver.ReleaseSpec(target, 1, "a" * 64)

    def test_rejects_alternate_production_root(self):
        with self.assertRaises(receiver.ReceiveError):
            receiver.ReleaseSpec("/tmp/release.tar", 1, "a" * 64, "/tmp")

    def test_explicit_test_factory_does_not_change_production_default(self):
        self.assertEqual(spec()._root, ROOT)
        with self.assertRaises(receiver.ReceiveError):
            receiver.ReleaseSpec(ROOT + "/release.tar", len(PAYLOAD), DIGEST)

    def test_size_and_hash_guards(self):
        for length in (0, -1, True, 1.5, receiver.MAX_BYTES + 1):
            with self.subTest(length=length), self.assertRaises(receiver.ReceiveError):
                receiver.ReleaseSpec(receiver.PRODUCTION_ROOT + "/release.tar", length, DIGEST)
        for digest in ("", "a" * 63, "a" * 65, "A" * 64, "g" * 64, None):
            with self.subTest(digest=digest), self.assertRaises(receiver.ReceiveError):
                receiver.ReleaseSpec(receiver.PRODUCTION_ROOT + "/release.tar", 1, digest)
        maximum = receiver.ReleaseSpec(receiver.PRODUCTION_ROOT + "/release.tar", receiver.MAX_BYTES, DIGEST)
        self.assertEqual(maximum.expected_bytes, 1024 ** 3)

    def test_cli_has_no_root_or_command_override(self):
        with mock.patch("sys.stderr", io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                receiver.main(["--target", ROOT + "/release.tar", "--bytes", "1", "--sha256", DIGEST, "--test-root", ROOT])
        self.assertEqual(caught.exception.code, 2)

    def test_unsupported_platform_fails_before_any_filesystem_or_stdin(self):
        with mock.patch.object(receiver, "linux_capable", return_value=False):
            with mock.patch.object(receiver.os, "open") as opening:
                with self.assertRaises(receiver.ReceiveError):
                    receiver.PosixTarget(spec())
                with self.assertRaises(receiver.ReceiveError):
                    with receiver.transfer_deadline():
                        self.fail("unsupported deadline entered")
                opening.assert_not_called()


class StreamTests(unittest.TestCase):
    def run_transfer(self, payload, release=None, target=None):
        release = release or spec()
        target = target or MemoryTarget(release)
        receiver.receive_release(release, io.BytesIO(payload), _target_factory=lambda _spec: target)
        return target

    def test_binary_bytes_are_exact_and_only_published_after_sync(self):
        target = self.run_transfer(PAYLOAD)
        self.assertEqual(target.published, PAYLOAD)
        self.assertEqual(target.events, ["write", "sync", "publish", "cleanup"])
        self.assertEqual(target.temp, b"")
        self.assertEqual(target.unrelated, b"preserve")

    def test_multichunk_copy_stays_bounded(self):
        payload = b"\x00\xff" * receiver.CHUNK_BYTES
        target = self.run_transfer(payload, spec(payload))
        self.assertEqual(target.published, payload)
        self.assertEqual(target.events.count("write"), 2)

    def test_truncation_cleans_own_temp_and_never_publishes(self):
        target = MemoryTarget(spec())
        with self.assertRaises(receiver.ReceiveError):
            self.run_transfer(PAYLOAD[:-1], target=target)
        self.assertTrue(target.closed)
        self.assertIsNone(target.published)
        self.assertNotIn("sync", target.events)
        self.assertEqual(target.unrelated, b"preserve")

    def test_excess_data_is_rejected_without_publication(self):
        target = MemoryTarget(spec())
        with self.assertRaises(receiver.ReceiveError):
            self.run_transfer(PAYLOAD + b"extra", target=target)
        self.assertTrue(target.closed)
        self.assertNotIn("publish", target.events)

    def test_digest_mismatch_cleans_without_publication(self):
        release = spec(digest="0" * 64)
        target = MemoryTarget(release)
        with self.assertRaises(receiver.ReceiveError):
            self.run_transfer(PAYLOAD, release, target)
        self.assertTrue(target.closed)
        self.assertEqual(target.temp, b"")
        self.assertIsNone(target.published)

    def test_existing_target_wins_and_is_not_overwritten(self):
        target = MemoryTarget(spec())
        target.existing = b"original"
        with self.assertRaises(FileExistsError):
            self.run_transfer(PAYLOAD, target=target)
        self.assertEqual(target.existing, b"original")
        self.assertTrue(target.closed)
        self.assertIsNone(target.published)

    def test_write_or_source_error_cleans_without_publication(self):
        target = MemoryTarget(spec())
        target.fail_write = True
        with self.assertRaises(OSError):
            self.run_transfer(PAYLOAD, target=target)
        self.assertTrue(target.closed)
        self.assertIsNone(target.published)
        class BrokenSource:
            def read(self, _count):
                raise OSError("fixture stream failure")
        target = MemoryTarget(spec())
        with self.assertRaises(OSError):
            receiver.receive_release(spec(), BrokenSource(), _target_factory=lambda _spec: target)
        self.assertTrue(target.closed)

    def test_stream_that_ignores_read_limit_is_rejected(self):
        class OversizedRead:
            def read(self, _count):
                return PAYLOAD + b"x"
        target = MemoryTarget(spec())
        with self.assertRaises(receiver.ReceiveError):
            receiver.receive_release(spec(), OversizedRead(), _target_factory=lambda _spec: target)
        self.assertIsNone(target.published)
        self.assertTrue(target.closed)

    def test_deadline_handler_raises_and_alarm_is_disarmed(self):
        fake_sigalrm = getattr(signal, "SIGALRM", 14)
        with mock.patch.object(receiver, "linux_capable", return_value=True):
            with mock.patch.object(receiver.signal, "SIGALRM", fake_sigalrm, create=True):
                with mock.patch.object(receiver.signal, "signal", return_value="prior") as install:
                    with mock.patch.object(receiver.signal, "alarm", create=True) as alarm:
                        with self.assertRaises(receiver.ReceiveError):
                            with receiver.transfer_deadline():
                                install.call_args_list[0].args[1](fake_sigalrm, None)
                        self.assertEqual(alarm.call_args_list, [mock.call(600), mock.call(0)])
                        self.assertEqual(install.call_args_list[-1], mock.call(fake_sigalrm, "prior"))


@unittest.skipUnless(receiver.linux_capable(), "Linux dir_fd/O_NOFOLLOW/hardlink/alarm integration not available locally")
class LinuxFilesystemTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aureon-office-receive-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.incoming = self.root / "incoming"
        self.incoming.mkdir(mode=0o700)

    def release(self, target=None, digest=DIGEST):
        return receiver.ReleaseSpec.for_tests(str(self.incoming), str(target or self.incoming / "release.tar"),
                                              len(PAYLOAD), digest)

    def test_real_exact_file_0600_and_no_leftover(self):
        receiver.receive_release(self.release(), io.BytesIO(PAYLOAD))
        target = self.incoming / "release.tar"
        self.assertEqual(target.read_bytes(), PAYLOAD)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(list(self.incoming.iterdir()), [target])

    def test_real_existing_file_is_untouched(self):
        target = self.incoming / "release.tar"
        target.write_bytes(b"original")
        with self.assertRaises(receiver.ReceiveError):
            receiver.receive_release(self.release(), io.BytesIO(PAYLOAD))
        self.assertEqual(target.read_bytes(), b"original")
        self.assertEqual(list(self.incoming.iterdir()), [target])

    def test_real_final_symlink_is_not_followed(self):
        other = self.root / "outside"
        other.write_bytes(b"preserve")
        (self.incoming / "release.tar").symlink_to(other)
        with self.assertRaises(receiver.ReceiveError):
            receiver.receive_release(self.release(), io.BytesIO(PAYLOAD))
        self.assertEqual(other.read_bytes(), b"preserve")
        self.assertTrue((self.incoming / "release.tar").is_symlink())

    def test_real_ancestor_symlink_is_rejected(self):
        alias = self.root / "alias"
        alias.symlink_to(self.incoming, target_is_directory=True)
        release = receiver.ReleaseSpec.for_tests(str(alias), str(alias / "release.tar"), len(PAYLOAD), DIGEST)
        with self.assertRaises(OSError):
            receiver.receive_release(release, io.BytesIO(PAYLOAD))
        self.assertEqual(list(self.incoming.iterdir()), [])

    def test_real_bad_hash_cleanup_preserves_unrelated_file(self):
        other = self.incoming / "keep"
        other.write_bytes(b"preserve")
        with self.assertRaises(receiver.ReceiveError):
            receiver.receive_release(self.release(digest="0" * 64), io.BytesIO(PAYLOAD))
        self.assertEqual(other.read_bytes(), b"preserve")
        self.assertEqual(list(self.incoming.iterdir()), [other])

    def test_real_destination_created_during_transfer_cannot_be_overwritten(self):
        destination = self.incoming / "release.tar"
        class CompetingSource(io.BytesIO):
            def read(inner, count=-1):
                chunk = super().read(count)
                if not chunk and not destination.exists():
                    destination.write_bytes(b"winner")
                return chunk
        with self.assertRaises(FileExistsError):
            receiver.receive_release(self.release(), CompetingSource(PAYLOAD))
        self.assertEqual(destination.read_bytes(), b"winner")
        self.assertEqual(list(self.incoming.iterdir()), [destination])

    def test_real_cleanup_does_not_delete_a_replaced_temp_name(self):
        target = receiver.PosixTarget(self.release())
        original_name = target.temp_name
        os.unlink(original_name, dir_fd=target.directory_fd)
        replacement = self.incoming / original_name
        replacement.write_bytes(b"not-owned")
        target.close()
        self.assertEqual(replacement.read_bytes(), b"not-owned")

    def test_real_second_receiver_is_rejected_until_first_closes(self):
        first = receiver.PosixTarget(self.release())
        try:
            with self.assertRaises(BlockingIOError):
                receiver.PosixTarget(self.release())
        finally:
            first.close()
        self.assertEqual(list(self.incoming.iterdir()), [])
        after = receiver.PosixTarget(self.release())
        after.close()
        self.assertEqual(list(self.incoming.iterdir()), [])

    def test_real_alarm_terminates_blocked_read_and_cleans(self):
        # Exercise the real signal handler without waiting ten minutes.
        with mock.patch.object(receiver, "DEADLINE_SECONDS", 1):
            read_fd, write_fd = os.pipe()
            try:
                with os.fdopen(read_fd, "rb", buffering=0) as source:
                    with self.assertRaises(receiver.ReceiveError):
                        with receiver.transfer_deadline():
                            receiver.receive_release(self.release(), source)
            finally:
                os.close(write_fd)
        self.assertEqual(list(self.incoming.iterdir()), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
