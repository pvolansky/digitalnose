import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from build_release import build,FILES

class ReleaseTest(unittest.TestCase):
    def test_reproducible_allowlisted_artifact(self):
        import tarfile
        with tempfile.TemporaryDirectory() as directory:
            a=Path(directory)/'a.tar';b=Path(directory)/'b.tar'
            def git(args,**kwargs):
                if args[1]=='rev-parse': return 'a'*40+'\n'
                self.assertTrue(args[2].split('/')[-1] in FILES)
                return args[2].encode()
            with patch('build_release.subprocess.check_output',side_effect=git):
                build('reviewed',a);build('reviewed',b)
            self.assertEqual(a.read_bytes(),b.read_bytes())
            with tarfile.open(a) as archive:
                names=archive.getnames()
                self.assertFalse(any('phase2' in name or '.env' in name for name in names))
                self.assertEqual(len(names),len(FILES)+2)
